/**
 * Engagement Slice – webhooks, gamification, loyalty, and affiliate programs.
 */
import type { StateCreator } from 'zustand';
import { WebhookConfig, WebhookDelivery, WebhookAnalytics, WebhookEventType } from '../../types/webhook';
import { LoyaltyStatus, LoyaltyTier, PointsTransaction, Reward, RewardType, TierBenefits, LoyaltyProgram } from '../../types/loyalty';
import { Affiliate, AffiliateProgram, AffiliateMetrics, Commission, CommissionConfig, AffiliateStatus, CommissionType } from '../../types/affiliate';
import { UserProgress, AchievementTrigger } from '../../types/gamification';

// ── Interfaces ──────────────────────────────────────────────────────────

export interface WebhookSlice {
  webhooks: WebhookConfig[];
  webhookDeliveries: WebhookDelivery[];
  webhookAnalytics: Record<string, WebhookAnalytics>;
  webhookLoading: boolean;
  webhookError: string | null;
  registerWebhook: (input: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt' | 'successCount' | 'failureCount'>) => Promise<WebhookConfig>;
  updateWebhook: (id: string, patch: Partial<WebhookConfig>) => Promise<WebhookConfig>;
  deleteWebhookConfig: (id: string) => Promise<void>;
  pauseWebhook: (id: string) => Promise<WebhookConfig>;
  resumeWebhook: (id: string) => Promise<WebhookConfig>;
  recordDelivery: (delivery: Omit<WebhookDelivery, 'id' | 'createdAt' | 'updatedAt'>) => Promise<WebhookDelivery>;
  retryWebhookDelivery: (deliveryId: string) => Promise<WebhookDelivery>;
  sendTestEvent: (webhookId: string, eventType?: WebhookEventType) => Promise<WebhookDelivery>;
  getWebhookDeliveries: (webhookId: string, limit?: number) => WebhookDelivery[];
  getWebhookAnalytics: (webhookId: string) => WebhookAnalytics;
  refreshWebhookAnalytics: (webhookId?: string) => void;
  setWebhookState: (webhooks: WebhookConfig[]) => void;
}

export interface GamificationSlice {
  gamificationPoints: number;
  gamificationLevel: number;
  earnedAchievements: string[];
  earnedBadges: string[];
  streak: number;
  lastActionAt: string | undefined;
  addPoints: (amount: number) => void;
  checkAchievements: (trigger: AchievementTrigger, metadata: any) => void;
  resetGamification: () => void;
}

export interface LoyaltySlice {
  loyaltyStatus: LoyaltyStatus | null;
  loyaltyTransactions: PointsTransaction[];
  loyaltyRewards: Reward[];
  loyaltyProgram: LoyaltyProgram | null;
  loyaltyLoading: boolean;
  loyaltyError: string | null;
  initializeLoyaltyProgram: () => Promise<void>;
  accumulateLoyaltyPoints: (subscriberId: string, subscriptionId: string, amount: number) => Promise<void>;
  redeemLoyaltyPoints: (rewardId: string) => Promise<boolean>;
  checkTierUpgrade: () => void;
  expireLoyaltyPoints: () => void;
}

export interface AffiliateSlice {
  affiliates: Affiliate[];
  affiliatePrograms: AffiliateProgram[];
  affiliateCommissions: Commission[];
  affiliateMetrics: AffiliateMetrics;
  affiliateLoading: boolean;
  affiliateError: string | null;
  registerAffiliate: (referrerAddress: string, programId: string) => Promise<void>;
  trackReferral: (affiliateId: string, subscriptionId: string) => Promise<void>;
  calculateCommission: (affiliateId: string, subscriptionAmount: number) => Promise<number>;
  approveCommission: (commissionId: string) => Promise<void>;
  payoutCommission: (affiliateId: string) => Promise<void>;
  updateAffiliateStatus: (affiliateId: string, status: AffiliateStatus) => Promise<void>;
  getAffiliateMetrics: () => AffiliateMetrics;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const generateUniqueId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
const now = (): number => Date.now();

const calculateWebhookAnalytics = (webhookId: string, deliveries: WebhookDelivery[]): WebhookAnalytics => {
  const scoped = deliveries.filter((d) => d.webhookId === webhookId);
  const total = scoped.length;
  const successful = scoped.filter((d) => d.status === 'delivered').length;
  const failed = scoped.filter((d) => d.status === 'failed').length;
  return { webhookId, totalDeliveries: total, successfulDeliveries: successful, failedDeliveries: failed, retryCount: 0, pendingDeliveries: 0, successRate: total ? successful / total : 0, avgAttempts: 0, avgLatencyMs: 0 };
};

const defaultTierBenefits: TierBenefits[] = [
  { tier: LoyaltyTier.BRONZE, benefits: [{ type: 'base', description: 'Base rewards', value: 1 }], pointsThreshold: 0, discountRate: 0, prioritySupport: false, reducedFees: 0 },
  { tier: LoyaltyTier.SILVER, benefits: [{ type: 'base', description: 'Base rewards', value: 1 }, { type: 'discount', description: '5% discount', value: 5 }], pointsThreshold: 1000, discountRate: 5, prioritySupport: false, reducedFees: 2 },
  { tier: LoyaltyTier.GOLD, benefits: [{ type: 'base', description: 'Base rewards', value: 1 }, { type: 'discount', description: '10% discount', value: 10 }, { type: 'priority', description: 'Priority support', value: 1 }], pointsThreshold: 5000, discountRate: 10, prioritySupport: true, reducedFees: 5 },
  { tier: LoyaltyTier.PLATINUM, benefits: [{ type: 'base', description: 'Base rewards', value: 1 }, { type: 'discount', description: '15% discount', value: 15 }, { type: 'priority', description: 'Priority support', value: 1 }, { type: 'exclusive', description: 'Exclusive offers', value: 1 }], pointsThreshold: 15000, discountRate: 15, prioritySupport: true, reducedFees: 10 },
];

const defaultRewards: Reward[] = [
  { id: 'reward-1', name: '$5 Discount', type: RewardType.DISCOUNT, pointsCost: 500, value: 5, description: '$5 off your next billing', isActive: true },
  { id: 'reward-2', name: '$10 Discount', type: RewardType.DISCOUNT, pointsCost: 900, value: 10, description: '$10 off your next billing', isActive: true },
  { id: 'reward-3', name: 'Free Month', type: RewardType.FREE_MONTH, pointsCost: 2000, value: 0, description: 'Get one month free', isActive: true },
  { id: 'reward-4', name: 'T-Shirt', type: RewardType.MERCHANDISE, pointsCost: 5000, value: 25, description: 'Exclusive SubTrackr t-shirt', isActive: true },
];

const defaultPrograms: AffiliateProgram[] = [
  { id: 'default-basic', name: 'Basic Affiliate Program', description: 'Earn 5% commission on all referrals', commissionConfig: { type: CommissionType.PERCENTAGE, rate: 5 }, attributionWindowDays: 30, isActive: true },
  { id: 'default-tiered', name: 'Tiered Affiliate Program', description: 'Earn up to 15% with tiered rates', commissionConfig: { type: CommissionType.TIERED, rate: 10, tierThresholds: [1000, 5000, 10000], tierRates: [10, 12, 15] }, attributionWindowDays: 60, isActive: true },
];

const getTierFromPoints = (points: number): LoyaltyTier => {
  if (points >= 15000) return LoyaltyTier.PLATINUM;
  if (points >= 5000) return LoyaltyTier.GOLD;
  if (points >= 1000) return LoyaltyTier.SILVER;
  return LoyaltyTier.BRONZE;
};

type EngagementStore = WebhookSlice & GamificationSlice & LoyaltySlice & AffiliateSlice;
type EngagementCreator = StateCreator<EngagementStore & any, [], [], EngagementStore>;

// ═══════════════════════════════════════════════════════════════════════════
// Slice Factory
// ═══════════════════════════════════════════════════════════════════════════

export const createEngagementSlice: EngagementCreator = (set, get) => ({
  // ── Webhook state ────────────────────────────────────────────────
  webhooks: [],
  webhookDeliveries: [],
  webhookAnalytics: {},
  webhookLoading: false,
  webhookError: null,

  registerWebhook: async (input) => {
    const webhook: WebhookConfig = { ...input, id: `whk_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, createdAt: now(), updatedAt: now(), successCount: 0, failureCount: 0 } as WebhookConfig;
    set((s) => ({ webhooks: [...s.webhooks, webhook], webhookAnalytics: { ...s.webhookAnalytics, [webhook.id]: calculateWebhookAnalytics(webhook.id, s.webhookDeliveries) } }));
    return webhook;
  },

  updateWebhook: async (id, patch) => {
    const current = get().webhooks.find((w) => w.id === id);
    if (!current) throw new Error(`Webhook ${id} not found`);
    const next: WebhookConfig = { ...current, ...patch, id, updatedAt: now() };
    set((s) => ({ webhooks: s.webhooks.map((w) => (w.id === id ? next : w)), webhookAnalytics: { ...s.webhookAnalytics, [id]: calculateWebhookAnalytics(id, s.webhookDeliveries) } }));
    return next;
  },

  deleteWebhookConfig: async (id) => {
    set((s) => ({ webhooks: s.webhooks.filter((w) => w.id !== id), webhookDeliveries: s.webhookDeliveries.filter((d) => d.webhookId !== id) }));
  },

  pauseWebhook: async (id) => get().updateWebhook(id, { isPaused: true } as Partial<WebhookConfig>),
  resumeWebhook: async (id) => get().updateWebhook(id, { isPaused: false } as Partial<WebhookConfig>),

  recordDelivery: async (delivery) => {
    const record: WebhookDelivery = { ...delivery, id: `del_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, createdAt: now(), updatedAt: now() } as WebhookDelivery;
    set((s) => {
      const nextDeliveries = [...s.webhookDeliveries, record];
      return { webhookDeliveries: nextDeliveries, webhookAnalytics: { ...s.webhookAnalytics, [record.webhookId]: calculateWebhookAnalytics(record.webhookId, nextDeliveries) } };
    });
    return record;
  },

  retryWebhookDelivery: async (deliveryId) => {
    const current = get().webhookDeliveries.find((d) => d.id === deliveryId);
    if (!current) throw new Error(`Delivery ${deliveryId} not found`);
    const next: WebhookDelivery = { ...current, status: 'retrying', attempts: current.attempts + 1, lastAttemptAt: now(), nextRetryAt: now(), updatedAt: now() };
    set((s) => {
      const nextDeliveries = s.webhookDeliveries.map((d) => d.id === deliveryId ? next : d);
      return { webhookDeliveries: nextDeliveries, webhookAnalytics: { ...s.webhookAnalytics, [next.webhookId]: calculateWebhookAnalytics(next.webhookId, nextDeliveries) } };
    });
    return next;
  },

  sendTestEvent: async (webhookId, eventType = 'subscription.created') => {
    const webhook = get().webhooks.find((w) => w.id === webhookId);
    if (!webhook) throw new Error(`Webhook ${webhookId} not found`);
    return get().recordDelivery({ webhookId, eventId: `evt_${now()}`, eventType, url: webhook.url, payload: { id: webhookId }, status: 'delivered', attempts: 1, maxAttempts: 5, deliveredAt: now(), responseCode: 200, signature: 'test', idempotencyKey: `idem_${now()}`, latencyMs: 120 } as any);
  },

  getWebhookDeliveries: (webhookId, limit = 25) => get().webhookDeliveries.filter((d) => d.webhookId === webhookId).slice(-Math.max(0, limit)),
  getWebhookAnalytics: (webhookId) => calculateWebhookAnalytics(webhookId, get().webhookDeliveries),
  refreshWebhookAnalytics: (webhookId) => { if (webhookId) { get().getWebhookAnalytics(webhookId); } },
  setWebhookState: (webhooks) => set({ webhooks }),

  // ── Gamification state ───────────────────────────────────────────
  gamificationPoints: 0,
  gamificationLevel: 1,
  earnedAchievements: [],
  earnedBadges: [],
  streak: 0,
  lastActionAt: undefined,

  addPoints: (amount) => {
    const { gamificationPoints, gamificationLevel } = get();
    const newPoints = gamificationPoints + amount;
    const nextLevelPoints = Math.floor(100 * Math.pow(gamificationLevel, 1.5));
    if (newPoints >= nextLevelPoints) {
      set({ gamificationPoints: newPoints, gamificationLevel: gamificationLevel + 1 });
    } else {
      set({ gamificationPoints: newPoints });
    }
  },

  checkAchievements: (_trigger, _metadata) => {},
  resetGamification: () => set({ gamificationPoints: 0, gamificationLevel: 1, earnedAchievements: [], earnedBadges: [], streak: 0, lastActionAt: undefined }),

  // ── Loyalty state ────────────────────────────────────────────────
  loyaltyStatus: null,
  loyaltyTransactions: [],
  loyaltyRewards: defaultRewards,
  loyaltyProgram: null,
  loyaltyLoading: false,
  loyaltyError: null,

  initializeLoyaltyProgram: async () => {
    const program: LoyaltyProgram = { id: generateUniqueId(), name: 'SubTrackr Rewards', tiers: defaultTierBenefits, pointsPerDollar: 10, pointsExpirationDays: 365, isActive: true };
    set({ loyaltyProgram: program });
  },

  accumulateLoyaltyPoints: async (subscriberId, subscriptionId, amount) => {
    const program = get().loyaltyProgram;
    if (!program) return;
    const pointsEarned = Math.floor(amount * program.pointsPerDollar);
    const transaction: PointsTransaction = { id: generateUniqueId(), subscriberId, amount: pointsEarned, type: 'earn', subscriptionId, description: 'Points earned', createdAt: new Date() };
    const currentPoints = get().loyaltyStatus?.points || 0;
    const newStatus: LoyaltyStatus = { subscriberId, tier: getTierFromPoints(currentPoints + pointsEarned), points: currentPoints + pointsEarned, lifetimePoints: (get().loyaltyStatus?.lifetimePoints || 0) + pointsEarned, totalSpent: (get().loyaltyStatus?.totalSpent || 0) + amount, memberSince: get().loyaltyStatus?.memberSince || new Date() } as LoyaltyStatus;
    set({ loyaltyTransactions: [...get().loyaltyTransactions, transaction], loyaltyStatus: newStatus });
  },

  redeemLoyaltyPoints: async (rewardId) => {
    const reward = get().loyaltyRewards.find((r) => r.id === rewardId);
    const status = get().loyaltyStatus;
    if (!reward || !status || !reward.isActive || status.points < reward.pointsCost) return false;
    const tx: PointsTransaction = { id: generateUniqueId(), subscriberId: status.subscriberId, amount: -reward.pointsCost, type: 'redeem', description: `Redeemed: ${reward.name}`, createdAt: new Date() };
    set({ loyaltyTransactions: [...get().loyaltyTransactions, tx], loyaltyStatus: { ...status, points: status.points - reward.pointsCost } });
    return true;
  },

  checkTierUpgrade: () => {
    const status = get().loyaltyStatus;
    if (!status) return;
    const newTier = getTierFromPoints(status.lifetimePoints);
    if (newTier !== status.tier) set({ loyaltyStatus: { ...status, tier: newTier } });
  },

  expireLoyaltyPoints: () => {},

  // ── Affiliate state ─────────────────────────────────────────────
  affiliates: [],
  affiliatePrograms: defaultPrograms,
  affiliateCommissions: [],
  affiliateMetrics: { totalReferrals: 0, activeReferrals: 0, totalEarnings: 0, pendingPayout: 0, conversionRate: 0 },
  affiliateLoading: false,
  affiliateError: null,

  registerAffiliate: async (referrerAddress, programId) => {
    set({ affiliateLoading: true, affiliateError: null });
    try {
      const program = get().affiliatePrograms.find((p) => p.id === programId);
      if (!program) throw new Error('Program not found');
      const newAffiliate: Affiliate = { id: generateUniqueId(), referrerAddress, programId, commissionRate: program.commissionConfig.rate, paymentThreshold: 100, status: AffiliateStatus.ACTIVE, totalReferrals: 0, totalEarnings: 0, pendingPayout: 0, createdAt: new Date() };
      set((s) => ({ affiliates: [...s.affiliates, newAffiliate], affiliateLoading: false }));
    } catch (error) {
      set({ affiliateError: error instanceof Error ? error.message : 'Failed to register', affiliateLoading: false });
    }
  },

  trackReferral: async (affiliateId, subscriptionId) => {
    set({ affiliateLoading: true, affiliateError: null });
    try {
      set((s) => ({ affiliates: s.affiliates.map((a) => a.id === affiliateId ? { ...a, totalReferrals: a.totalReferrals + 1 } : a), affiliateCommissions: [...s.affiliateCommissions, { id: generateUniqueId(), affiliateId, subscriptionId, amount: 0, currency: 'USD', status: 'pending', createdAt: new Date() } as Commission], affiliateLoading: false }));
    } catch (error) {
      set({ affiliateError: error instanceof Error ? error.message : 'Failed to track referral', affiliateLoading: false });
    }
  },

  calculateCommission: async (affiliateId, subscriptionAmount) => {
    const affiliate = get().affiliates.find((a) => a.id === affiliateId);
    const program = affiliate ? get().affiliatePrograms.find((p) => p.id === affiliate.programId) : undefined;
    if (!affiliate || !program) return 0;
    const amount = subscriptionAmount * (program.commissionConfig.rate / 100);
    return Math.round(amount * 100) / 100;
  },

  approveCommission: async (commissionId) => set((s) => ({ affiliateCommissions: s.affiliateCommissions.map((c) => c.id === commissionId ? { ...c, status: 'approved' as const } : c) })),
  payoutCommission: async (affiliateId) => set((s) => ({ affiliateCommissions: s.affiliateCommissions.map((c) => c.affiliateId === affiliateId && c.status === 'approved' ? { ...c, status: 'paid' as const, paidAt: new Date() } : c) })),

  updateAffiliateStatus: async (affiliateId, status) => set((s) => ({ affiliates: s.affiliates.map((a) => a.id === affiliateId ? { ...a, status } : a) })),

  getAffiliateMetrics: () => {
    const { affiliates, affiliateCommissions } = get();
    const totalEarnings = affiliates.reduce((sum, a) => sum + a.totalEarnings, 0);
    const pendingPayout = affiliates.reduce((sum, a) => sum + a.pendingPayout, 0);
    const totalReferrals = affiliates.reduce((sum, a) => sum + a.totalReferrals, 0);
    const activeReferrals = affiliates.filter((a) => a.status === AffiliateStatus.ACTIVE).length;
    return { totalReferrals, activeReferrals, totalEarnings, pendingPayout, conversionRate: totalReferrals > 0 ? (activeReferrals / totalReferrals) * 100 : 0 };
  },
});
