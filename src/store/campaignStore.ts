import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import {
  Campaign,
  CampaignStatus,
  CampaignAnalytics,
  CouponCode,
  CouponValidation,
  CampaignSchedule,
  CampaignOverlap,
  DiscountType,
} from '../types/campaign';
import { CouponService } from '../services/couponService';

const STORAGE_KEY = 'subtrackr-campaign';
const STORE_VERSION = 1;

interface CampaignState {
  campaigns: Campaign[];
  isLoading: boolean;
  error: string | null;
  activeCampaigns: Campaign[];
  redeemedCoupons: CouponCode[];
  campaignAnalytics: Record<string, CampaignAnalytics>;

  createCampaign: (campaign: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateCampaign: (id: string, updates: Partial<Campaign>) => Promise<void>;
  deleteCampaign: (id: string) => Promise<void>;
  launchCampaign: (id: string) => Promise<void>;
  pauseCampaign: (id: string) => Promise<void>;
  getCampaignAnalytics: (id: string) => CampaignAnalytics | null;

  // Coupon management
  generateCoupons: (campaignId: string, count: number, pattern?: string) => Promise<void>;
  validateCoupon: (code: string, subscriptionId?: string) => Promise<CouponValidation>;
  redeemCoupon: (code: string, subscriptionId: string) => Promise<void>;

  // Campaign scheduling
  scheduleCampaign: (id: string, schedule: CampaignSchedule) => Promise<void>;
  activateCampaign: (id: string) => Promise<void>;
  expireCampaign: (id: string) => Promise<void>;

  // Targeting
  getEligibleCampaigns: (userId: string) => Campaign[];
  checkCampaignEligibility: (campaignId: string, userId: string) => boolean;

  // Stacking & pricing
  calculateDiscountedPrice: (originalPrice: number, campaignIds: string[]) => number;
  applyCampaignToPlan: (campaignId: string, planId: string) => Promise<void>;
  applyCampaignToSubscription: (campaignId: string, subscriptionId: string) => Promise<void>;

  // Analytics
  getCampaignPerformance: (id: string) => CampaignAnalytics;
  exportCampaignData: (id: string) => Promise<void>;

  // Overlap detection
  detectOverlaps: (campaignId: string) => CampaignOverlap[];
}

const generateUniqueId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomComponent}`;
};

const initializeAnalytics = (): CampaignAnalytics => ({
  campaignId: '',
  totalRecipients: 0,
  deliveredCount: 0,
  openedCount: 0,
  clickedCount: 0,
  convertedCount: 0,
  revenue: 0,
  startDate: new Date(),
});

export const useCampaignStore = create<CampaignState>()(
  persist(
    (set, get) => ({
      campaigns: [],
      isLoading: false,
      error: null,
      activeCampaigns: [],
      redeemedCoupons: [],
      campaignAnalytics: {},

      createCampaign: async (campaignData) => {
        set({ isLoading: true, error: null });
        try {
          const newCampaign: Campaign = {
            ...campaignData,
            id: generateUniqueId(),
            analytics: initializeAnalytics(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          set((state) => ({
            campaigns: [...state.campaigns, newCampaign],
            isLoading: false,
          }));
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to create campaign',
            isLoading: false,
          });
        }
      },

      updateCampaign: async (id: string, updates: Partial<Campaign>) => {
        set((state) => ({
          campaigns: state.campaigns.map((c) =>
            c.id === id ? { ...c, ...updates, updatedAt: new Date() } : c
          ),
        }));
      },

      deleteCampaign: async (id: string) => {
        set((state) => ({
          campaigns: state.campaigns.filter((c) => c.id !== id),
        }));
      },

      launchCampaign: async (id: string) => {
        const { campaigns } = get();
        const campaign = campaigns.find((c) => c.id === id);

        if (!campaign) return;

        const now = new Date();
        const updatedAnalytics: CampaignAnalytics = {
          ...campaign.analytics!,
          campaignId: id,
          totalRecipients: Math.floor(Math.random() * 1000) + 100,
          startDate: now,
        };

        set({
          campaigns: campaigns.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: CampaignStatus.ACTIVE,
                  analytics: updatedAnalytics,
                  updatedAt: now,
                }
              : c
          ),
        });
      },

      pauseCampaign: async (id: string) => {
        const { campaigns } = get();
        const campaign = campaigns.find((c) => c.id === id);

        if (!campaign) return;

        const now = new Date();

        set({
          campaigns: campaigns.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: CampaignStatus.PAUSED,
                  analytics: {
                    ...c.analytics!,
                    endDate: now,
                  },
                  updatedAt: now,
                }
              : c
          ),
        });
      },

      getCampaignAnalytics: (id: string) => {
        const { campaigns } = get();
        const campaign = campaigns.find((c) => c.id === id);
        return campaign?.analytics || null;
      },

      // Coupon management
      generateCoupons: async (campaignId: string, count: number, pattern?: string) => {
        const { campaigns } = get();
        const campaign = campaigns.find((c) => c.id === campaignId);
        if (!campaign) return;

        const coupons: CouponCode[] = [];
        const prefix = pattern || 'PROMO';

        for (let i = 0; i < count; i++) {
          const code = `${prefix}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
          coupons.push({
            id: generateUniqueId(),
            code,
            campaignId,
            maxUses: 100,
            usedCount: 0,
            maxUsesPerUser: 1,
            isActive: true,
            createdAt: new Date(),
          });
        }

        set((state) => ({
          campaigns: state.campaigns.map((c) =>
            c.id === campaignId
              ? { ...c, couponCodes: [...(c.couponCodes || []), ...coupons], updatedAt: new Date() }
              : c
          ),
        }));
      },

      validateCoupon: async (code: string, subscriptionId?: string) => {
        return CouponService.validateCoupon(code, subscriptionId || '');
      },

      redeemCoupon: async (code: string, subscriptionId: string) => {
        await CouponService.applyCoupon(code, subscriptionId);
        set((state) => ({
          redeemedCoupons: [...state.redeemedCoupons],
        }));
      },

      // Campaign scheduling
      scheduleCampaign: async (id: string, schedule: CampaignSchedule) => {
        set((state) => ({
          campaigns: state.campaigns.map((c) =>
            c.id === id
              ? { ...c, status: CampaignStatus.SCHEDULED, schedule, updatedAt: new Date() }
              : c
          ),
        }));
      },

      activateCampaign: async (id: string) => {
        const { campaigns } = get();
        const campaign = campaigns.find((c) => c.id === id);
        if (!campaign) return;

        set((state) => ({
          campaigns: state.campaigns.map((c) =>
            c.id === id ? { ...c, status: CampaignStatus.ACTIVE, updatedAt: new Date() } : c
          ),
          activeCampaigns: [
            ...state.activeCampaigns,
            { ...campaign, status: CampaignStatus.ACTIVE },
          ],
        }));
      },

      expireCampaign: async (id: string) => {
        set((state) => ({
          campaigns: state.campaigns.map((c) =>
            c.id === id ? { ...c, status: CampaignStatus.COMPLETED, updatedAt: new Date() } : c
          ),
          activeCampaigns: state.activeCampaigns.filter((c) => c.id !== id),
        }));
      },

      // Targeting
      getEligibleCampaigns: (_userId: string) => {
        const { campaigns } = get();
        // Simplified - in real app would check targeting rules
        return campaigns.filter((c) => c.status === CampaignStatus.ACTIVE);
      },

      checkCampaignEligibility: (campaignId: string, _userId: string) => {
        const { campaigns } = get();
        const campaign = campaigns.find((c) => c.id === campaignId);
        return campaign?.status === CampaignStatus.ACTIVE;
      },

      // Stacking & pricing
      calculateDiscountedPrice: (originalPrice: number, campaignIds: string[]) => {
        const { campaigns } = get();
        let finalPrice = originalPrice;

        for (const campaignId of campaignIds) {
          const campaign = campaigns.find((c) => c.id === campaignId);
          if (!campaign?.promotionRule) continue;

          const { discountType, discountValue } = campaign.promotionRule;
          if (discountType === DiscountType.PERCENTAGE) {
            finalPrice -= finalPrice * (discountValue / 100);
          } else if (discountType === DiscountType.FIXED_AMOUNT) {
            finalPrice -= discountValue;
          }
        }

        return Math.max(0, finalPrice);
      },

      applyCampaignToPlan: async (campaignId: string, planId: string) => {
        set((state) => ({
          campaigns: state.campaigns.map((c) =>
            c.id === campaignId
              ? {
                  ...c,
                  promotionRule: {
                    ...c.promotionRule!,
                    planIds: [...(c.promotionRule?.planIds || []), planId],
                  },
                  updatedAt: new Date(),
                }
              : c
          ),
        }));
      },

      applyCampaignToSubscription: async (campaignId: string, subscriptionId: string) => {
        // Implementation would apply campaign to specific subscription
        // eslint-disable-next-line no-console
        console.log(`Applying campaign ${campaignId} to subscription ${subscriptionId}`);
      },

      // Analytics
      getCampaignPerformance: (id: string) => {
        const { campaigns, campaignAnalytics } = get();
        if (campaignAnalytics[id]) return campaignAnalytics[id];

        const campaign = campaigns.find((c) => c.id === id);
        return campaign?.analytics || initializeAnalytics();
      },

      exportCampaignData: async (id: string) => {
        const performance = get().getCampaignPerformance(id);
        // eslint-disable-next-line no-console
        console.log('Exporting campaign data:', performance);
        // In real app, would generate CSV/PDF export
      },

      // Overlap detection
      detectOverlaps: (campaignId: string) => {
        const { campaigns } = get();
        const campaign = campaigns.find((c) => c.id === campaignId);
        if (!campaign) return [];

        const overlaps: CampaignOverlap[] = [];

        campaigns.forEach((other) => {
          if (other.id === campaignId || other.status === CampaignStatus.COMPLETED) return;

          // Check plan overlap
          if (campaign.promotionRule?.planIds && other.promotionRule?.planIds) {
            const commonPlans = campaign.promotionRule.planIds.filter((planId) =>
              other.promotionRule!.planIds!.includes(planId)
            );
            if (commonPlans.length > 0) {
              overlaps.push({
                campaignId,
                overlappingCampaignId: other.id,
                overlapType: 'plan',
                overlapDetails: `Both campaigns apply to plans: ${commonPlans.join(', ')}`,
                severity: 'warning',
              });
            }
          }
        });

        return overlaps;
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({ campaigns: state.campaigns }),
    }
  )
);
