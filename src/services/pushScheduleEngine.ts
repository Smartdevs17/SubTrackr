/**
 * PushScheduleEngine — timezone-aware delivery scheduling with quiet hours,
 * priority tiers, and A/B test variant selection.
 *
 * DigestBuilder — batches low-priority notifications into daily/weekly digests.
 */

export type NotificationPriority = 'critical' | 'informative' | 'marketing';

export type OptInCategory = 'billing' | 'product' | 'marketing' | 'security';

export interface ScheduledNotification {
  id: string;
  userId: string;
  priority: NotificationPriority;
  category: OptInCategory;
  title: string;
  body: string;
  /** ISO-8601 — when to deliver (after quiet-hours / window optimization) */
  deliverAt: string;
  abVariant?: 'A' | 'B';
  metadata?: Record<string, string>;
}

export interface DigestEntry {
  userId: string;
  notifications: { title: string; body: string; category: OptInCategory }[];
  scheduledFor: string; // ISO-8601
  frequency: 'daily' | 'weekly';
}

export interface OpenRateRecord {
  userId: string;
  hour: number; // 0-23 UTC
  openCount: number;
  sendCount: number;
}

// ─── PushScheduleEngine ───────────────────────────────────────────────────────

export class PushScheduleEngine {
  /** In-memory open rate history — replace with DB in production */
  private openRates = new Map<string, OpenRateRecord[]>();

  /**
   * Schedule a notification, respecting quiet hours and delivery window.
   * Critical notifications bypass quiet hours.
   */
  schedule(
    userId: string,
    priority: NotificationPriority,
    category: OptInCategory,
    title: string,
    body: string,
    quietHours: { enabled: boolean; startHour: number; endHour: number; timezone: string },
    optInCategories: OptInCategory[],
    abVariant?: 'A' | 'B'
  ): ScheduledNotification | null {
    // Check opt-in for non-critical categories
    if (priority !== 'critical' && !optInCategories.includes(category)) {
      return null;
    }

    let deliverAt = new Date();

    // Critical bypasses quiet hours; others must wait
    if (priority !== 'critical' && quietHours.enabled) {
      deliverAt = this._adjustForQuietHours(deliverAt, quietHours);
    }

    // Optimize delivery window based on historical open rates (non-critical only)
    if (priority === 'informative' || priority === 'marketing') {
      const bestHour = this._getBestDeliveryHour(userId);
      if (bestHour !== null) {
        deliverAt = this._setHour(deliverAt, bestHour);
        // Re-check quiet hours after window optimization
        if (quietHours.enabled) {
          deliverAt = this._adjustForQuietHours(deliverAt, quietHours);
        }
      }
    }

    return {
      id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      userId,
      priority,
      category,
      title: abVariant === 'B' ? `${title} ✨` : title,
      body,
      deliverAt: deliverAt.toISOString(),
      abVariant,
    };
  }

  /**
   * Escalate priority for overdue payments.
   * If a billing notification has been pending >24h, escalate to critical.
   */
  escalateOverdue(
    notification: ScheduledNotification,
    overdueHours: number
  ): ScheduledNotification {
    if (notification.category === 'billing' && overdueHours >= 24) {
      return { ...notification, priority: 'critical', deliverAt: new Date().toISOString() };
    }
    return notification;
  }

  /** Record open event to improve future delivery timing */
  recordOpen(userId: string, deliveredAt: Date): void {
    const hour = deliveredAt.getUTCHours();
    const records = this.openRates.get(userId) ?? [];
    const existing = records.find((r) => r.hour === hour);
    if (existing) {
      existing.openCount += 1;
    } else {
      records.push({ userId, hour, openCount: 1, sendCount: 1 });
    }
    this.openRates.set(userId, records);
  }

  recordSend(userId: string, deliveredAt: Date): void {
    const hour = deliveredAt.getUTCHours();
    const records = this.openRates.get(userId) ?? [];
    const existing = records.find((r) => r.hour === hour);
    if (existing) {
      existing.sendCount += 1;
    } else {
      records.push({ userId, hour, openCount: 0, sendCount: 1 });
    }
    this.openRates.set(userId, records);
  }

  getOpenRates(userId: string): OpenRateRecord[] {
    return this.openRates.get(userId) ?? [];
  }

  private _getBestDeliveryHour(userId: string): number | null {
    const records = this.openRates.get(userId);
    if (!records || records.length === 0) return null;
    let best: OpenRateRecord | null = null;
    let bestRate = -1;
    for (const r of records) {
      const rate = r.sendCount > 0 ? r.openCount / r.sendCount : 0;
      if (rate > bestRate) {
        bestRate = rate;
        best = r;
      }
    }
    return best?.hour ?? null;
  }

  private _adjustForQuietHours(
    date: Date,
    qh: { startHour: number; endHour: number; timezone: string }
  ): Date {
    const result = new Date(date);
    // Simple UTC-based check (production: use Intl.DateTimeFormat with timezone)
    const hour = result.getUTCHours();
    const inQuiet =
      qh.startHour < qh.endHour
        ? hour >= qh.startHour && hour < qh.endHour
        : hour >= qh.startHour || hour < qh.endHour;

    if (inQuiet) {
      // Push to end of quiet period
      result.setUTCHours(qh.endHour, 0, 0, 0);
      if (result <= date) {
        result.setUTCDate(result.getUTCDate() + 1);
      }
    }
    return result;
  }

  private _setHour(date: Date, hour: number): Date {
    const result = new Date(date);
    result.setUTCHours(hour, 0, 0, 0);
    if (result < date) {
      result.setUTCDate(result.getUTCDate() + 1);
    }
    return result;
  }
}

// ─── DigestBuilder ────────────────────────────────────────────────────────────

export class DigestBuilder {
  private queue = new Map<string, { title: string; body: string; category: OptInCategory }[]>();

  /** Queue a notification for digest instead of immediate delivery */
  enqueue(userId: string, title: string, body: string, category: OptInCategory): void {
    const existing = this.queue.get(userId) ?? [];
    existing.push({ title, body, category });
    this.queue.set(userId, existing);
  }

  /** Build a digest for the user, scheduled at the next daily/weekly window */
  buildDigest(userId: string, frequency: 'daily' | 'weekly'): DigestEntry | null {
    const items = this.queue.get(userId);
    if (!items || items.length === 0) return null;

    const scheduledFor = new Date();
    if (frequency === 'daily') {
      scheduledFor.setUTCDate(scheduledFor.getUTCDate() + 1);
      scheduledFor.setUTCHours(9, 0, 0, 0); // 9am UTC next day
    } else {
      const daysUntilMonday = (8 - scheduledFor.getUTCDay()) % 7 || 7;
      scheduledFor.setUTCDate(scheduledFor.getUTCDate() + daysUntilMonday);
      scheduledFor.setUTCHours(9, 0, 0, 0);
    }

    this.queue.delete(userId); // consume queue
    return {
      userId,
      notifications: items,
      scheduledFor: scheduledFor.toISOString(),
      frequency,
    };
  }

  getPendingCount(userId: string): number {
    return this.queue.get(userId)?.length ?? 0;
  }
}

export const pushScheduleEngine = new PushScheduleEngine();
export const digestBuilder = new DigestBuilder();
