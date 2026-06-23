import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import {
  Affiliate,
  AffiliateProgram,
  AffiliateMetrics,
  Commission,
  CommissionConfig,
  AffiliateStatus,
  CommissionType,
} from '../types/affiliate';
import { AffiliateService } from '../../backend/services/affiliate/AffiliateService';

const STORAGE_KEY = 'subtrackr-affiliate';
const STORE_VERSION = 1;

interface AffiliateState {
  affiliates: Affiliate[];
  programs: AffiliateProgram[];
  commissions: Commission[];
  metrics: AffiliateMetrics;
  isLoading: boolean;
  error: string | null;

  registerAffiliate: (referrerAddress: string, programId: string) => Promise<void>;
  trackReferral: (
    affiliateId: string,
    subscriptionId: string,
    subscriptionAmount: number,
    ip: string,
    userAgent: string,
    cookieReferralCode?: string,
    attributionModel?: 'first-touch' | 'last-touch' | 'linear'
  ) => Promise<void>;
  trackClick: (referralCode: string, ip: string, userAgent: string) => Promise<void>;
  calculateCommission: (affiliateId: string, subscriptionAmount: number) => Promise<number>;
  approveCommission: (commissionId: string) => Promise<void>;
  payoutCommission: (affiliateId: string) => Promise<void>;
  updateAffiliateStatus: (affiliateId: string, status: AffiliateStatus) => Promise<void>;
  triggerClawback: (subscriptionId: string) => Promise<void>;
  getMetrics: () => AffiliateMetrics;
}

const defaultPrograms: AffiliateProgram[] = [
  {
    id: 'default-basic',
    name: 'Basic Affiliate Program',
    description: 'Earn 10% commission on all referrals',
    commissionConfig: {
      type: CommissionType.PERCENTAGE,
      rate: 10,
    },
    attributionWindowDays: 30,
    isActive: true,
    attributionModel: 'last-touch',
  },
  {
    id: 'default-tiered',
    name: 'Tiered Affiliate Program',
    description: 'Earn up to 15% with tiered rates',
    commissionConfig: {
      type: CommissionType.TIERED,
      rate: 10,
      tierThresholds: [100, 500, 1000],
      tierRates: [10, 12, 15],
    },
    attributionWindowDays: 60,
    isActive: true,
    attributionModel: 'last-touch',
  },
];

const calculateTieredCommission = (amount: number, config: CommissionConfig): number => {
  if (config.type !== CommissionType.TIERED || !config.tierThresholds || !config.tierRates) {
    return amount * (config.rate / 100);
  }

  let commission = 0;
  for (let i = config.tierThresholds.length - 1; i >= 0; i--) {
    if (amount >= config.tierThresholds[i]) {
      commission = amount * (config.tierRates[i] / 100);
      break;
    }
  }
  return commission || amount * (config.rate / 100);
};

export const useAffiliateStore = create<AffiliateState>()(
  persist(
    (set, get) => ({
      affiliates: [],
      programs: defaultPrograms,
      commissions: [],
      metrics: {
        totalReferrals: 0,
        activeReferrals: 0,
        totalEarnings: 0,
        pendingPayout: 0,
        conversionRate: 0,
        totalClicks: 0,
      },
      isLoading: false,
      error: null,

      registerAffiliate: async (referrerAddress: string, programId: string) => {
        set({ isLoading: true, error: null });
        try {
          const program = get().programs.find((p) => p.id === programId);
          if (!program) throw new Error('Program not found');

          // Call backend service
          const backendAffiliate = await AffiliateService.registerAffiliate(
            referrerAddress,
            programId
          );

          set((state) => ({
            affiliates: [...state.affiliates, backendAffiliate],
            isLoading: false,
          }));
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to register affiliate',
            isLoading: false,
          });
        }
      },

      trackClick: async (referralCode: string, ip: string, userAgent: string) => {
        try {
          // Call backend
          await AffiliateService.trackClick(referralCode, ip, userAgent);

          // Sync frontend state
          set((state) => ({
            affiliates: state.affiliates.map((a) =>
              a.referralCode === referralCode ? { ...a, clicksCount: (a.clicksCount || 0) + 1 } : a
            ),
          }));
        } catch (error) {
          console.warn('Track click warning:', error);
        }
      },

      trackReferral: async (
        affiliateId: string,
        subscriptionId: string,
        subscriptionAmount: number,
        ip: string,
        userAgent: string,
        cookieReferralCode?: string,
        attributionModel: 'first-touch' | 'last-touch' | 'linear' = 'last-touch'
      ) => {
        set({ isLoading: true, error: null });
        try {
          const { affiliates } = get();
          const affiliate = affiliates.find((a) => a.id === affiliateId);
          if (!affiliate) throw new Error('Affiliate not found');

          // Trigger conversion on backend (IP self referral check, speed check)
          const newCommissions = await AffiliateService.convertReferral(
            subscriptionId,
            subscriptionAmount,
            ip,
            userAgent,
            cookieReferralCode || affiliate.referralCode,
            attributionModel
          );

          // Get updated backend affiliate data for fraud status sync
          const updatedBackend = AffiliateService.getAffiliate(affiliateId);

          set((state) => ({
            affiliates: state.affiliates.map((a) =>
              a.id === affiliateId
                ? {
                    ...a,
                    totalReferrals: updatedBackend
                      ? updatedBackend.totalReferrals
                      : a.totalReferrals + 1,
                    pendingPayout: updatedBackend
                      ? updatedBackend.pendingPayout
                      : a.pendingPayout + (newCommissions[0]?.amount || 0),
                    fraudRiskScore: updatedBackend
                      ? updatedBackend.fraudRiskScore
                      : a.fraudRiskScore,
                    fraudStatus: updatedBackend ? updatedBackend.fraudStatus : a.fraudStatus,
                    status: updatedBackend ? updatedBackend.status : a.status,
                  }
                : a
            ),
            commissions: [...state.commissions, ...newCommissions],
            isLoading: false,
          }));
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to track referral',
            isLoading: false,
          });
          throw error;
        }
      },

      calculateCommission: async (affiliateId: string, subscriptionAmount: number) => {
        const { affiliates, programs } = get();
        const affiliate = affiliates.find((a) => a.id === affiliateId);
        if (!affiliate) return 0;

        const program = programs.find((p) => p.id === affiliate.programId);
        if (!program) return 0;

        let commissionAmount = 0;
        if (program.commissionConfig.type === CommissionType.FLAT) {
          commissionAmount = program.commissionConfig.rate;
        } else if (program.commissionConfig.type === CommissionType.TIERED) {
          commissionAmount = calculateTieredCommission(
            subscriptionAmount,
            program.commissionConfig
          );
        } else {
          commissionAmount = subscriptionAmount * (program.commissionConfig.rate / 100);
        }

        return Math.round(commissionAmount * 100) / 100;
      },

      approveCommission: async (commissionId: string) => {
        set((state) => ({
          commissions: state.commissions.map((c) =>
            c.id === commissionId ? { ...c, status: 'approved' as const } : c
          ),
        }));
      },

      payoutCommission: async (affiliateId: string) => {
        set({ isLoading: true, error: null });
        try {
          // Request from backend service
          const payoutRecord = await AffiliateService.requestPayout(affiliateId);
          const updatedBackend = AffiliateService.getAffiliate(affiliateId);

          set((state) => ({
            commissions: state.commissions.map((c) =>
              c.affiliateId === affiliateId && c.status === 'pending'
                ? { ...c, status: 'paid' as const, paidAt: new Date() }
                : c
            ),
            affiliates: state.affiliates.map((a) =>
              a.id === affiliateId
                ? {
                    ...a,
                    totalEarnings: updatedBackend
                      ? updatedBackend.totalEarnings
                      : a.totalEarnings + payoutRecord.amount,
                    pendingPayout: updatedBackend ? updatedBackend.pendingPayout : 0,
                    payoutHistory: [...(a.payoutHistory || []), payoutRecord],
                  }
                : a
            ),
            isLoading: false,
          }));
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Payout failed',
            isLoading: false,
          });
          throw error;
        }
      },

      triggerClawback: async (subscriptionId: string) => {
        try {
          const clawbackAmount = await AffiliateService.processClawback(subscriptionId);
          if (clawbackAmount > 0) {
            // Update frontend store to reflect clawback
            set((state) => ({
              commissions: state.commissions.map((c) =>
                c.subscriptionId === subscriptionId ? { ...c, isClawbacked: true } : c
              ),
              affiliates: state.affiliates.map((a) => {
                const affectedComms = state.commissions.filter(
                  (c) => c.subscriptionId === subscriptionId && c.affiliateId === a.id
                );
                const totalAffAmt = affectedComms.reduce((sum, c) => sum + c.amount, 0);
                return {
                  ...a,
                  pendingPayout: Math.max(0, a.pendingPayout - totalAffAmt),
                };
              }),
            }));
          }
        } catch (error) {
          console.error('Clawback failed:', error);
        }
      },

      updateAffiliateStatus: async (affiliateId: string, status: AffiliateStatus) => {
        set((state) => ({
          affiliates: state.affiliates.map((a) => (a.id === affiliateId ? { ...a, status } : a)),
        }));
      },

      getMetrics: () => {
        const { affiliates } = get();
        const totalEarnings = affiliates.reduce((sum, a) => sum + a.totalEarnings, 0);
        const pendingPayout = affiliates.reduce((sum, a) => sum + a.pendingPayout, 0);
        const totalReferrals = affiliates.reduce((sum, a) => sum + a.totalReferrals, 0);
        const totalClicks = affiliates.reduce((sum, a) => sum + (a.clicksCount || 0), 0);
        const activeReferrals = affiliates.filter(
          (a) => a.status === AffiliateStatus.ACTIVE
        ).length;

        return {
          totalReferrals,
          activeReferrals,
          totalEarnings,
          pendingPayout,
          conversionRate: totalClicks > 0 ? (totalReferrals / totalClicks) * 100 : 0,
          totalClicks,
        };
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        affiliates: state.affiliates,
        programs: state.programs,
        commissions: state.commissions,
      }),
    }
  )
);
