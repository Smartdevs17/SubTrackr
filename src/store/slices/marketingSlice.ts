/**
 * Marketing Slice – campaigns, segments, and group management.
 */
import type { StateCreator } from 'zustand';
import { Campaign, CampaignStatus, CampaignAnalytics, CouponCode, CouponValidation, CampaignSchedule, CampaignOverlap, DiscountType } from '../../types/campaign';
import { Segment } from '../../types/segment';
import { SubscriptionGroup, GroupConfig, GroupId, GroupMemberRole, GroupAnalytics } from '../../types/group';

// ── Interfaces ──────────────────────────────────────────────────────────

export interface CampaignSlice {
  campaigns: Campaign[];
  campaignLoading: boolean;
  campaignError: string | null;
  activeCampaigns: Campaign[];
  redeemedCoupons: CouponCode[];
  campaignAnalytics: Record<string, CampaignAnalytics>;
  createCampaign: (data: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateCampaign: (id: string, updates: Partial<Campaign>) => Promise<void>;
  deleteCampaign: (id: string) => Promise<void>;
  launchCampaign: (id: string) => Promise<void>;
  pauseCampaign: (id: string) => Promise<void>;
  getCampaignAnalytics: (id: string) => CampaignAnalytics | null;
  generateCoupons: (campaignId: string, count: number, pattern?: string) => Promise<void>;
  validateCoupon: (code: string, subscriptionId?: string) => Promise<CouponValidation>;
  redeemCoupon: (code: string, subscriptionId: string) => Promise<void>;
  scheduleCampaign: (id: string, schedule: CampaignSchedule) => Promise<void>;
  activateCampaign: (id: string) => Promise<void>;
  expireCampaign: (id: string) => Promise<void>;
  getEligibleCampaigns: (userId: string) => Campaign[];
  checkCampaignEligibility: (campaignId: string, userId: string) => boolean;
  calculateDiscountedPrice: (originalPrice: number, campaignIds: string[]) => number;
  applyCampaignToPlan: (campaignId: string, planId: string) => Promise<void>;
  applyCampaignToSubscription: (campaignId: string, subscriptionId: string) => Promise<void>;
  getCampaignPerformance: (id: string) => CampaignAnalytics;
  exportCampaignData: (id: string) => Promise<void>;
  detectOverlaps: (campaignId: string) => CampaignOverlap[];
}

export interface SegmentSlice {
  segments: Segment[];
  segmentLoading: boolean;
  segmentError: string | null;
  addSegment: (data: Omit<Segment, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateSegment: (id: string, data: Partial<Segment>) => void;
  deleteSegment: (id: string) => void;
  getSegmentsForUser: () => Segment[];
  getSegmentStats: (id: string) => { subscriberCount: number; totalMonthlyValue: number; averageValuePerSubscriber: number } | null;
}

export interface GroupSlice {
  groups: SubscriptionGroup[];
  selectedGroupId?: GroupId;
  groupLoading: boolean;
  groupError: string | null;
  createGroup: (owner: string, config: GroupConfig) => SubscriptionGroup;
  inviteGroupMember: (groupId: GroupId, inviteeAddress: string, invitedBy: string) => void;
  joinGroup: (groupId: GroupId, inviteId: string, displayName?: string) => void;
  removeGroupMember: (groupId: GroupId, memberAddress: string) => void;
  updateGroupMemberRole: (groupId: GroupId, memberAddress: string, role: GroupMemberRole) => void;
  chargeGroup: (groupId: GroupId, amount: number) => void;
  getGroupAnalytics: (groupId: GroupId) => GroupAnalytics | undefined;
  selectGroup: (groupId?: GroupId) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const generateUniqueId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

const initializeAnalytics = (): CampaignAnalytics => ({ campaignId: '', totalRecipients: 0, deliveredCount: 0, openedCount: 0, clickedCount: 0, convertedCount: 0, revenue: 0, startDate: new Date() });

type MarketingStore = CampaignSlice & SegmentSlice & GroupSlice;
type MarketingCreator = StateCreator<MarketingStore & any, [], [], MarketingStore>;

// ═══════════════════════════════════════════════════════════════════════════
// Slice Factory
// ═══════════════════════════════════════════════════════════════════════════

export const createMarketingSlice: MarketingCreator = (set, get) => ({
  // ── Campaign state ────────────────────────────────────────────────
  campaigns: [],
  campaignLoading: false,
  campaignError: null,
  activeCampaigns: [],
  redeemedCoupons: [],
  campaignAnalytics: {},

  createCampaign: async (data) => {
    set({ campaignLoading: true, campaignError: null });
    try {
      const newCampaign: Campaign = { ...data, id: generateUniqueId(), analytics: initializeAnalytics(), createdAt: new Date(), updatedAt: new Date() };
      set((s) => ({ campaigns: [...s.campaigns, newCampaign], campaignLoading: false }));
    } catch (error) {
      set({ campaignError: error instanceof Error ? error.message : 'Failed to create campaign', campaignLoading: false });
    }
  },

  updateCampaign: async (id, updates) => set((s) => ({ campaigns: s.campaigns.map((c) => c.id === id ? { ...c, ...updates, updatedAt: new Date() } : c) })),
  deleteCampaign: async (id) => set((s) => ({ campaigns: s.campaigns.filter((c) => c.id !== id) })),

  launchCampaign: async (id) => {
    const campaign = get().campaigns.find((c) => c.id === id);
    if (!campaign) return;
    set((s) => ({ campaigns: s.campaigns.map((c) => c.id === id ? { ...c, status: CampaignStatus.ACTIVE, analytics: { ...initializeAnalytics(), campaignId: id, totalRecipients: Math.floor(Math.random() * 1000) + 100, startDate: new Date() }, updatedAt: new Date() } : c) }));
  },

  pauseCampaign: async (id) => {
    set((s) => ({ campaigns: s.campaigns.map((c) => c.id === id ? { ...c, status: CampaignStatus.PAUSED, updatedAt: new Date() } : c) }));
  },

  getCampaignAnalytics: (id) => get().campaigns.find((c) => c.id === id)?.analytics || null,

  generateCoupons: async (campaignId, count, pattern) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId);
    if (!campaign) return;
    const coupons: CouponCode[] = Array.from({ length: count }, (_, i) => ({ id: generateUniqueId(), code: `${pattern || 'PROMO'}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`, campaignId, maxUses: 100, usedCount: 0, maxUsesPerUser: 1, isActive: true, createdAt: new Date() }));
    set((s) => ({ campaigns: s.campaigns.map((c) => c.id === campaignId ? { ...c, couponCodes: [...(c.couponCodes || []), ...coupons], updatedAt: new Date() } : c) }));
  },

  validateCoupon: async (_code, _subscriptionId) => ({ valid: true, code: _code }),
  redeemCoupon: async (_code, _subscriptionId) => {},
  scheduleCampaign: async (id, schedule) => set((s) => ({ campaigns: s.campaigns.map((c) => c.id === id ? { ...c, status: CampaignStatus.SCHEDULED, schedule, updatedAt: new Date() } : c) })),
  activateCampaign: async (id) => { const c = get().campaigns.find((x) => x.id === id); if (c) set((s) => ({ campaigns: s.campaigns.map((x) => x.id === id ? { ...x, status: CampaignStatus.ACTIVE, updatedAt: new Date() } : x), activeCampaigns: [...s.activeCampaigns, { ...c, status: CampaignStatus.ACTIVE }] })); },
  expireCampaign: async (id) => set((s) => ({ campaigns: s.campaigns.map((c) => c.id === id ? { ...c, status: CampaignStatus.COMPLETED, updatedAt: new Date() } : c), activeCampaigns: s.activeCampaigns.filter((c) => c.id !== id) })),
  getEligibleCampaigns: (_userId) => get().campaigns.filter((c) => c.status === CampaignStatus.ACTIVE),
  checkCampaignEligibility: (campaignId, _userId) => get().campaigns.find((c) => c.id === campaignId)?.status === CampaignStatus.ACTIVE,

  calculateDiscountedPrice: (originalPrice, campaignIds) => {
    let price = originalPrice;
    for (const cId of campaignIds) {
      const c = get().campaigns.find((x) => x.id === cId);
      if (c?.promotionRule?.discountType === DiscountType.PERCENTAGE) price -= price * (c.promotionRule.discountValue / 100);
      else if (c?.promotionRule?.discountType === DiscountType.FIXED_AMOUNT) price -= c.promotionRule.discountValue;
    }
    return Math.max(0, price);
  },

  applyCampaignToPlan: async (campaignId, planId) => set((s) => ({ campaigns: s.campaigns.map((c) => c.id === campaignId ? { ...c, promotionRule: { ...c.promotionRule, planIds: [...(c.promotionRule?.planIds || []), planId] }, updatedAt: new Date() } : c) })),
  applyCampaignToSubscription: async (_campaignId, _subscriptionId) => {},

  getCampaignPerformance: (id) => {
    const { campaigns, campaignAnalytics } = get();
    return campaignAnalytics[id] || campaigns.find((c) => c.id === id)?.analytics || initializeAnalytics();
  },

  exportCampaignData: async (_id) => {},

  detectOverlaps: (campaignId) => {
    const campaign = get().campaigns.find((c) => c.id === campaignId);
    if (!campaign) return [];
    return [];
  },

  // ── Segment state ─────────────────────────────────────────────────
  segments: [],
  segmentLoading: false,
  segmentError: null,

  addSegment: (data) => {
    const newSegment: Segment = { ...data, id: `seg-${Date.now()}`, createdAt: new Date(), updatedAt: new Date() };
    set((s) => ({ segments: [...s.segments, newSegment] }));
  },

  updateSegment: (id, data) => set((s) => ({ segments: s.segments.map((seg) => seg.id === id ? { ...seg, ...data, updatedAt: new Date() } : seg) })),
  deleteSegment: (id) => set((s) => ({ segments: s.segments.filter((seg) => seg.id !== id) })),
  getSegmentsForUser: () => get().segments,
  getSegmentStats: (id) => {
    const segment = get().segments.find((s) => s.id === id);
    return segment ? { subscriberCount: 0, totalMonthlyValue: 0, averageValuePerSubscriber: 0 } : null;
  },

  // ── Group state ───────────────────────────────────────────────────
  groups: [],
  selectedGroupId: undefined,
  groupLoading: false,
  groupError: null,

  createGroup: (owner, config) => {
    const group: SubscriptionGroup = { groupId: generateUniqueId(), owner, config, members: [], charges: [], createdAt: new Date(), updatedAt: new Date() } as SubscriptionGroup;
    set((s) => ({ groups: [...s.groups, group], selectedGroupId: group.groupId }));
    return group;
  },

  inviteGroupMember: (groupId, inviteeAddress, invitedBy) => {
    try {
      set((s) => ({ groups: s.groups.map((g) => g.groupId === groupId ? { ...g, members: [...(g.members || []), { address: inviteeAddress, role: 'member' as GroupMemberRole, invitedBy, joinedAt: new Date() }], updatedAt: new Date() } : g) }));
    } catch (error) { set({ groupError: (error as Error).message }); }
  },

  joinGroup: (groupId, inviteId, displayName) => {
    try {
      set((s) => ({ groups: s.groups.map((g) => g.groupId === groupId ? { ...g, members: [...(g.members || []), { address: `user_${inviteId}`, role: 'member' as GroupMemberRole, invitedBy: inviteId, joinedAt: new Date(), displayName }], updatedAt: new Date() } : g) }));
    } catch (error) { set({ groupError: (error as Error).message }); }
  },

  removeGroupMember: (groupId, memberAddress) => set((s) => ({ groups: s.groups.map((g) => g.groupId === groupId ? { ...g, members: (g.members || []).filter((m: any) => m.address !== memberAddress), updatedAt: new Date() } : g) })),
  updateGroupMemberRole: (groupId, memberAddress, role) => set((s) => ({ groups: s.groups.map((g) => g.groupId === groupId ? { ...g, members: (g.members || []).map((m: any) => m.address === memberAddress ? { ...m, role } : m), updatedAt: new Date() } : g) })),

  chargeGroup: (groupId, amount) => {
    try {
      set((s) => ({ groups: s.groups.map((g) => g.groupId === groupId ? { ...g, charges: [...(g.charges || []), { id: `chg-${Date.now()}`, amount, timestamp: new Date() }], updatedAt: new Date() } : g), groupError: null }));
    } catch (error) { set({ groupError: (error as Error).message }); }
  },

  getGroupAnalytics: (groupId) => {
    const group = get().groups.find((g) => g.groupId === groupId);
    return group ? { groupId, totalMembers: (group.members || []).length, totalCharges: (group.charges || []).length, totalAmount: (group.charges || []).reduce((sum: number, c: any) => sum + c.amount, 0) } as GroupAnalytics : undefined;
  },

  selectGroup: (groupId) => set({ selectedGroupId: groupId }),
});
