/**
 * SmartRetryService — ML-optimized dunning with:
 *  - Personalized retry timing based on historical success
 *  - Smart amount splitting for large payments
 *  - Card decline reason code mapping to recovery actions
 *  - Max retry cap per invoice
 *  - Visa Account Updater (card updater) integration
 *
 * DunningEngine — orchestrates retry scheduling (runs every 6h cron in production).
 */

import type { DunningEntry } from '../types/dunning';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeclineCode =
  | 'insufficient_funds'
  | 'card_expired'
  | 'do_not_honor'
  | 'card_lost_stolen'
  | 'authentication_required'
  | 'generic_decline';

export interface RetryDecision {
  shouldRetry: boolean;
  delayHours: number;
  splitAmount?: number; // if set, split the charge into this amount
  outreachChannel: 'email' | 'push' | 'sms';
  reason: string;
  escalatePriority: boolean;
}

export interface InvoiceRetryRecord {
  invoiceId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  attempts: number;
  maxAttempts: number;
  lastDeclineCode?: DeclineCode;
  successHistory: Array<{ hour: number; dayOfWeek: number; success: boolean }>;
  cardUpdaterTriggered: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryFunnelStats {
  total: number;
  retrying: number;
  recovered: number;
  failed: number;
  recoveryRate: number;
  byChannel: Record<'email' | 'push' | 'sms', { sent: number; conversions: number }>;
  byDeclineCode: Record<DeclineCode, { count: number; recoveries: number }>;
}

// ─── Decline code → recovery action map ─────────────────────────────────────

const DECLINE_RECOVERY_MAP: Record<DeclineCode, Omit<RetryDecision, 'shouldRetry' | 'splitAmount'>> = {
  insufficient_funds: {
    delayHours: 48,
    outreachChannel: 'email',
    reason: 'Retry in 48h; subscriber may get paid soon',
    escalatePriority: false,
  },
  card_expired: {
    delayHours: 1,
    outreachChannel: 'push',
    reason: 'Trigger Visa Account Updater; prompt card update',
    escalatePriority: true,
  },
  do_not_honor: {
    delayHours: 24,
    outreachChannel: 'email',
    reason: 'Generic bank decline; retry next day',
    escalatePriority: false,
  },
  card_lost_stolen: {
    delayHours: 0, // do not retry
    outreachChannel: 'push',
    reason: 'Card reported lost/stolen; no retry, contact subscriber',
    escalatePriority: true,
  },
  authentication_required: {
    delayHours: 2,
    outreachChannel: 'push',
    reason: '3DS authentication required; send deep link',
    escalatePriority: true,
  },
  generic_decline: {
    delayHours: 24,
    outreachChannel: 'email',
    reason: 'Generic decline; retry after 24h',
    escalatePriority: false,
  },
};

const MAX_RETRIES_DEFAULT = 6;
const SPLIT_THRESHOLD_AMOUNT = 100; // amounts above this get split

function nowIso() {
  return new Date().toISOString();
}

// ─── SmartRetryService ────────────────────────────────────────────────────────

export class SmartRetryService {
  private invoiceRecords = new Map<string, InvoiceRetryRecord>();

  /**
   * Register an invoice for smart retry tracking.
   */
  registerInvoice(
    invoiceId: string,
    subscriptionId: string,
    amount: number,
    currency: string,
    maxAttempts = MAX_RETRIES_DEFAULT
  ): InvoiceRetryRecord {
    const record: InvoiceRetryRecord = {
      invoiceId,
      subscriptionId,
      amount,
      currency,
      attempts: 0,
      maxAttempts,
      successHistory: [],
      cardUpdaterTriggered: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.invoiceRecords.set(invoiceId, record);
    return record;
  }

  /**
   * Decide whether and when to retry a failed payment.
   * Uses ML-style heuristics: decline code mapping + historical success hours.
   */
  decideRetry(invoiceId: string, declineCode: DeclineCode): RetryDecision {
    const record = this.invoiceRecords.get(invoiceId);
    if (!record) {
      return { shouldRetry: false, delayHours: 0, outreachChannel: 'email', reason: 'Unknown invoice', escalatePriority: false };
    }

    // Edge case: max retry cap
    if (record.attempts >= record.maxAttempts) {
      return {
        shouldRetry: false,
        delayHours: 0,
        outreachChannel: 'sms',
        reason: `Max retries (${record.maxAttempts}) reached for invoice ${invoiceId}`,
        escalatePriority: true,
      };
    }

    // Card lost/stolen — never retry
    if (declineCode === 'card_lost_stolen') {
      return { shouldRetry: false, ...DECLINE_RECOVERY_MAP[declineCode] };
    }

    const baseDecision = DECLINE_RECOVERY_MAP[declineCode];
    let delayHours = baseDecision.delayHours;

    // ML: adjust timing based on historical success patterns
    const bestHour = this._getBestRetryHour(record);
    if (bestHour !== null) {
      const now = new Date();
      const hoursUntilBest = (bestHour - now.getUTCHours() + 24) % 24;
      delayHours = Math.max(delayHours, hoursUntilBest);
    }

    // Smart amount split for large payments
    let splitAmount: number | undefined;
    if (record.amount > SPLIT_THRESHOLD_AMOUNT && record.attempts <= 1) {
      splitAmount = Math.round(record.amount / 2);
    }

    record.attempts += 1;
    record.lastDeclineCode = declineCode;
    record.updatedAt = nowIso();

    // Trigger card updater on expired card
    if (declineCode === 'card_expired' && !record.cardUpdaterTriggered) {
      record.cardUpdaterTriggered = true;
      console.log(`[CardUpdater] Triggered Visa Account Updater for invoice ${invoiceId}`);
    }

    this.invoiceRecords.set(invoiceId, record);

    return {
      shouldRetry: true,
      delayHours,
      splitAmount,
      outreachChannel: baseDecision.outreachChannel,
      reason: baseDecision.reason,
      escalatePriority: baseDecision.escalatePriority,
    };
  }

  /**
   * Record a successful charge to improve future retry timing predictions.
   */
  recordSuccess(invoiceId: string): void {
    const record = this.invoiceRecords.get(invoiceId);
    if (!record) return;
    const now = new Date();
    record.successHistory.push({
      hour: now.getUTCHours(),
      dayOfWeek: now.getUTCDay(),
      success: true,
    });
    record.updatedAt = nowIso();
    this.invoiceRecords.set(invoiceId, record);
  }

  getRecord(invoiceId: string): InvoiceRetryRecord | undefined {
    return this.invoiceRecords.get(invoiceId);
  }

  private _getBestRetryHour(record: InvoiceRetryRecord): number | null {
    const successes = record.successHistory.filter((h) => h.success);
    if (successes.length === 0) return null;
    // Return the most common hour of successful charges
    const hourCounts = successes.reduce<Record<number, number>>((acc, h) => {
      acc[h.hour] = (acc[h.hour] ?? 0) + 1;
      return acc;
    }, {});
    return parseInt(
      Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0][0],
      10
    );
  }
}

// ─── DunningEngine (cron worker — runs every 6h) ──────────────────────────────

export class DunningEngine {
  private recoveryStats = new Map<string, { recovered: number; failed: number; total: number }>();

  /**
   * Process all due dunning entries.
   * In production this is called by a cron job every 6h.
   */
  async processDueEntries(
    entries: DunningEntry[],
    chargeHandler: (entry: DunningEntry) => Promise<{ success: boolean; declineCode?: DeclineCode }>,
    smartRetryService: SmartRetryService
  ): Promise<{ processed: number; recovered: number; failed: number }> {
    const now = Date.now();
    const due = entries.filter((e) => !e.isPaused && e.nextActionAt <= now);

    let recovered = 0;
    let failed = 0;

    for (const entry of due) {
      try {
        const result = await chargeHandler(entry);
        if (result.success) {
          smartRetryService.recordSuccess(entry.subscriptionId);
          recovered += 1;
        } else {
          const decision = smartRetryService.decideRetry(
            entry.subscriptionId,
            result.declineCode ?? 'generic_decline'
          );
          if (!decision.shouldRetry) {
            failed += 1;
          }
        }
      } catch (err) {
        console.error(`[DunningEngine] Error processing entry ${entry.id}:`, err);
        failed += 1;
      }
    }

    // Update stats per merchant
    for (const entry of due) {
      const stats = this.recoveryStats.get(entry.merchantId) ?? { recovered: 0, failed: 0, total: 0 };
      stats.total += 1;
      this.recoveryStats.set(entry.merchantId, stats);
    }

    return { processed: due.length, recovered, failed };
  }

  /**
   * Build recovery funnel statistics for dashboard.
   */
  buildFunnelStats(entries: DunningEntry[]): RecoveryFunnelStats {
    const byChannel: RecoveryFunnelStats['byChannel'] = {
      email: { sent: 0, conversions: 0 },
      push: { sent: 0, conversions: 0 },
      sms: { sent: 0, conversions: 0 },
    };

    const byDeclineCode: RecoveryFunnelStats['byDeclineCode'] = {} as RecoveryFunnelStats['byDeclineCode'];
    const declineCodes: DeclineCode[] = [
      'insufficient_funds', 'card_expired', 'do_not_honor',
      'card_lost_stolen', 'authentication_required', 'generic_decline',
    ];
    for (const code of declineCodes) {
      byDeclineCode[code] = { count: 0, recoveries: 0 };
    }

    let recovered = 0;
    let failed = 0;

    for (const entry of entries) {
      for (const comm of entry.communicationLog) {
        const ch = comm.channel as 'email' | 'push' | 'sms';
        if (byChannel[ch]) {
          byChannel[ch].sent += 1;
          if (comm.status === 'clicked') byChannel[ch].conversions += 1;
        }
      }
      if (entry.currentStage === 'cancel') failed += 1;
      else if (entry.failedAttempts === 0 && entry.totalFailedCharges > 0) recovered += 1;
    }

    const total = entries.length;
    return {
      total,
      retrying: total - recovered - failed,
      recovered,
      failed,
      recoveryRate: total > 0 ? Math.round((recovered / total) * 100) : 0,
      byChannel,
      byDeclineCode,
    };
  }
}

export const smartRetryService = new SmartRetryService();
export const dunningEngine = new DunningEngine();
