export interface LoyaltyPointsRule {
  id: string;
  name: string;
  trigger: 'subscription_charge' | 'referral' | 'tenure_milestone' | 'usage_threshold' | 'manual';
  pointsMultiplier: number;
  basePoints: number;
  conditions?: {
    minChargeAmount?: number;
    tenureDays?: number;
    usageThreshold?: number;
  };
  isActive: boolean;
}

export interface LoyaltyAnalyticsData {
  totalPointsEarned: number;
  totalPointsRedeemed: number;
  totalPointsExpired: number;
  activePointsBalance: number;
  totalMembers: number;
  tierBreakdown: Record<string, number>;
  topRewards: Array<{ rewardId: string; rewardName: string; redemptionCount: number }>;
  pointsTrend: Array<{ date: string; earned: number; redeemed: number }>;
  averagePointsPerMember: number;
  redemptionRate: number;
  churnImpact: {
    membersWithRedemptions: number;
    averageRetentionDays: number;
    churnRate: number;
  };
}

export interface LoyaltyNotification {
  id: string;
  type: 'points_earned' | 'tier_upgraded' | 'reward_available' | 'points_expiring' | 'streak_bonus';
  subscriberId: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sentAt?: number;
  isRead: boolean;
  createdAt: number;
}

export interface LoyaltyApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  timestamp: number;
}

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_POINTS_RULES: LoyaltyPointsRule[] = [
  {
    id: 'charge_1x',
    name: 'Standard Charge',
    trigger: 'subscription_charge',
    pointsMultiplier: 10,
    basePoints: 0,
    conditions: {},
    isActive: true,
  },
  {
    id: 'charge_2x',
    name: 'High-Value Charge',
    trigger: 'subscription_charge',
    pointsMultiplier: 20,
    basePoints: 0,
    conditions: { minChargeAmount: 100 },
    isActive: true,
  },
  {
    id: 'referral_bonus',
    name: 'Referral Bonus',
    trigger: 'referral',
    pointsMultiplier: 1,
    basePoints: 500,
    conditions: {},
    isActive: true,
  },
  {
    id: 'tenure_30d',
    name: '30-Day Member',
    trigger: 'tenure_milestone',
    pointsMultiplier: 1,
    basePoints: 200,
    conditions: { tenureDays: 30 },
    isActive: true,
  },
  {
    id: 'tenure_365d',
    name: '1-Year Member',
    trigger: 'tenure_milestone',
    pointsMultiplier: 1,
    basePoints: 2000,
    conditions: { tenureDays: 365 },
    isActive: true,
  },
  {
    id: 'usage_high',
    name: 'High Usage',
    trigger: 'usage_threshold',
    pointsMultiplier: 1,
    basePoints: 100,
    conditions: { usageThreshold: 1000 },
    isActive: true,
  },
];

export class LoyaltyService {
  private pointsRules: LoyaltyPointsRule[] = [...DEFAULT_POINTS_RULES];
  private notifications: LoyaltyNotification[] = [];
  private pointsHistory: Array<{
    subscriberId: string;
    points: number;
    type: 'earn' | 'redeem' | 'expire';
    trigger: string;
    timestamp: number;
  }> = [];

  // ── Points Rules Management ─────────────────────────────────────────────

  addPointsRule(rule: Omit<LoyaltyPointsRule, 'id'>): LoyaltyPointsRule {
    const newRule: LoyaltyPointsRule = {
      ...rule,
      id: createId('rule'),
    };
    this.pointsRules.push(newRule);
    return newRule;
  }

  updatePointsRule(id: string, updates: Partial<LoyaltyPointsRule>): LoyaltyPointsRule | null {
    const idx = this.pointsRules.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    this.pointsRules[idx] = { ...this.pointsRules[idx], ...updates };
    return this.pointsRules[idx];
  }

  removePointsRule(id: string): void {
    this.pointsRules = this.pointsRules.filter((r) => r.id !== id);
  }

  getPointsRules(trigger?: LoyaltyPointsRule['trigger']): LoyaltyPointsRule[] {
    const active = this.pointsRules.filter((r) => r.isActive);
    return trigger ? active.filter((r) => r.trigger === trigger) : active;
  }

  // ── Points Calculation ──────────────────────────────────────────────────

  calculatePoints(
    trigger: LoyaltyPointsRule['trigger'],
    context: {
      chargeAmount?: number;
      tenureDays?: number;
      usageUnits?: number;
    } = {}
  ): { points: number; ruleId: string } | null {
    const applicableRules = this.pointsRules.filter(
      (r) => r.trigger === trigger && r.isActive
    );

    if (applicableRules.length === 0) return null;

    let bestRule: LoyaltyPointsRule | null = null;
    let bestPoints = 0;

    for (const rule of applicableRules) {
      let points = rule.basePoints;

      if (trigger === 'subscription_charge' && context.chargeAmount !== undefined) {
        if (rule.conditions?.minChargeAmount && context.chargeAmount < rule.conditions.minChargeAmount) {
          continue;
        }
        points += context.chargeAmount * rule.pointsMultiplier;
      } else if (trigger === 'tenure_milestone' && context.tenureDays !== undefined) {
        if (rule.conditions?.tenureDays && context.tenureDays < rule.conditions.tenureDays) {
          continue;
        }
        points += rule.basePoints;
      } else if (trigger === 'usage_threshold' && context.usageUnits !== undefined) {
        if (rule.conditions?.usageThreshold && context.usageUnits < rule.conditions.usageThreshold) {
          continue;
        }
        points += rule.basePoints;
      } else {
        points += rule.basePoints;
      }

      if (points > bestPoints) {
        bestPoints = points;
        bestRule = rule;
      }
    }

    if (!bestRule || bestPoints === 0) return null;

    return { points: bestPoints, ruleId: bestRule.id };
  }

  // ── Points History Tracking ─────────────────────────────────────────────

  recordPointsEvent(
    subscriberId: string,
    points: number,
    type: 'earn' | 'redeem' | 'expire',
    trigger: string
  ): void {
    this.pointsHistory.push({
      subscriberId,
      points,
      type,
      trigger,
      timestamp: Date.now(),
    });
  }

  getPointsHistory(subscriberId: string, limit = 50): typeof this.pointsHistory {
    return this.pointsHistory
      .filter((h) => h.subscriberId === subscriberId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // ── Loyalty Analytics ───────────────────────────────────────────────────

  getLoyaltyAnalytics(
    allSubscribers: Array<{
      subscriberId: string;
      points: number;
      lifetimePoints: number;
      tier: string;
    }>
  ): LoyaltyAnalyticsData {
    const totalPointsEarned = this.pointsHistory
      .filter((h) => h.type === 'earn')
      .reduce((sum, h) => sum + Math.max(0, h.points), 0);

    const totalPointsRedeemed = this.pointsHistory
      .filter((h) => h.type === 'redeem')
      .reduce((sum, h) => sum + Math.abs(h.points), 0);

    const totalPointsExpired = this.pointsHistory
      .filter((h) => h.type === 'expire')
      .reduce((sum, h) => sum + Math.abs(h.points), 0);

    const activePointsBalance = allSubscribers.reduce(
      (sum, s) => sum + s.points,
      0
    );

    const tierBreakdown: Record<string, number> = {};
    for (const subscriber of allSubscribers) {
      tierBreakdown[subscriber.tier] = (tierBreakdown[subscriber.tier] ?? 0) + 1;
    }

    const uniqueEarners = new Set(
      this.pointsHistory.filter((h) => h.type === 'earn').map((h) => h.subscriberId)
    ).size;

    const pointsTrend: LoyaltyAnalyticsData['pointsTrend'] = [];
    const now = Date.now();
    for (let i = 6; i >= 0; i--) {
      const dayStart = now - (i + 1) * 24 * 60 * 60 * 1000;
      const dayEnd = now - i * 24 * 60 * 60 * 1000;
      const dateStr = new Date(dayStart).toISOString().split('T')[0];

      const dayEarned = this.pointsHistory
        .filter((h) => h.type === 'earn' && h.timestamp >= dayStart && h.timestamp < dayEnd)
        .reduce((sum, h) => sum + Math.max(0, h.points), 0);
      const dayRedeemed = this.pointsHistory
        .filter((h) => h.type === 'redeem' && h.timestamp >= dayStart && h.timestamp < dayEnd)
        .reduce((sum, h) => sum + Math.abs(h.points), 0);

      pointsTrend.push({ date: dateStr, earned: dayEarned, redeemed: dayRedeemed });
    }

    return {
      totalPointsEarned,
      totalPointsRedeemed,
      totalPointsExpired,
      activePointsBalance,
      totalMembers: allSubscribers.length,
      tierBreakdown,
      topRewards: [],
      pointsTrend,
      averagePointsPerMember: allSubscribers.length > 0
        ? activePointsBalance / allSubscribers.length
        : 0,
      redemptionRate: totalPointsEarned > 0 ? totalPointsRedeemed / totalPointsEarned : 0,
      churnImpact: {
        membersWithRedemptions: 0,
        averageRetentionDays: 0,
        churnRate: 0,
      },
    };
  }

  // ── Loyalty Notifications ───────────────────────────────────────────────

  createNotification(
    type: LoyaltyNotification['type'],
    subscriberId: string,
    title: string,
    body: string,
    data: Record<string, unknown> = {}
  ): LoyaltyNotification {
    const notification: LoyaltyNotification = {
      id: createId('lnotif'),
      type,
      subscriberId,
      title,
      body,
      data,
      isRead: false,
      createdAt: Date.now(),
    };

    this.notifications.push(notification);
    return notification;
  }

  getNotifications(subscriberId: string, unreadOnly = false): LoyaltyNotification[] {
    let filtered = this.notifications.filter((n) => n.subscriberId === subscriberId);
    if (unreadOnly) {
      filtered = filtered.filter((n) => !n.isRead);
    }
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }

  markNotificationRead(notificationId: string): void {
    const notification = this.notifications.find((n) => n.id === notificationId);
    if (notification) {
      notification.isRead = true;
    }
  }

  markAllNotificationsRead(subscriberId: string): void {
    for (const notification of this.notifications) {
      if (notification.subscriberId === subscriberId) {
        notification.isRead = true;
      }
    }
  }

  getUnreadCount(subscriberId: string): number {
    return this.notifications.filter(
      (n) => n.subscriberId === subscriberId && !n.isRead
    ).length;
  }

  // ── Loyalty API Helpers ─────────────────────────────────────────────────

  createApiResponse<T>(data: T): LoyaltyApiResponse<T> {
    return {
      success: true,
      data,
      timestamp: Date.now(),
    };
  }

  createErrorResponse(error: string): LoyaltyApiResponse<null> {
    return {
      success: false,
      data: null,
      error,
      timestamp: Date.now(),
    };
  }
}

export const loyaltyService = new LoyaltyService();
