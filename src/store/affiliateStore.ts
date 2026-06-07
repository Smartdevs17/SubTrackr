import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Affiliate,
  AffiliateProgram,
  AffiliateMetrics,
  Commission,
  CommissionConfig,
  AffiliateStatus,
  CommissionType,
} from '../types/affiliate';

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
  trackReferral: (affiliateId: string, subscriptionId: string) => Promise<void>;
  calculateCommission: (affiliateId: string, subscriptionAmount: number) => Promise<number>;
  approveCommission: (commissionId: string) => Promise<void>;
  payoutCommission: (affiliateId: string) => Promise<void>;
  updateAffiliateStatus: (affiliateId: string, status: AffiliateStatus) => Promise<void>;
  getMetrics: () => AffiliateMetrics;
}

const generateUniqueId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomComponent}`;
};

const defaultPrograms: AffiliateProgram[] = [
  {
    id: 'default-basic',
    name: 'Basic Affiliate Program',
    description: 'Earn 5% commission on all referrals',
    commissionConfig: {
      type: CommissionType.PERCENTAGE,
      rate: 5,
    },
    attributionWindowDays: 30,
    isActive: true,
  },
  {
    id: 'default-tiered',
    name: 'Tiered Affiliate Program',
    description: 'Earn up to 15% with tiered rates',
    commissionConfig: {
      type: CommissionType.TIERED,
      rate: 10,
      tierThresholds: [1000, 5000, 10000],
      tierRates: [10, 12, 15],
    },
    attributionWindowDays: 60,
    isActive: true,
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
      },
      isLoading: false,
      error: null,

      registerAffiliate: async (referrerAddress: string, programId: string) => {
        set({ isLoading: true, error: null });
        try {
          const program = get().programs.find((p) => p.id === programId);
          if (!program) throw new Error('Program not found');

          const newAffiliate: Affiliate = {
            id: generateUniqueId(),
            referrerAddress,
            programId,
            commissionRate: program.commissionConfig.rate,
            paymentThreshold: 100,
            status: AffiliateStatus.ACTIVE,
            totalReferrals: 0,
            totalEarnings: 0,
            pendingPayout: 0,
            createdAt: new Date(),
          };

          set((state) => ({
            affiliates: [...state.affiliates, newAffiliate],
            isLoading: false,
          }));
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to register affiliate',
            isLoading: false,
          });
        }
      },

      trackReferral: async (affiliateId: string, subscriptionId: string) => {
        set({ isLoading: true, error: null });
        try {
          const { affiliates } = get();
          const affiliate = affiliates.find((a) => a.id === affiliateId);
          if (!affiliate) throw new Error('Affiliate not found');

          set({
            affiliates: affiliates.map((a) =>
              a.id === affiliateId ? { ...a, totalReferrals: a.totalReferrals + 1 } : a
            ),
            commissions: [
              ...get().commissions,
              {
                id: generateUniqueId(),
                affiliateId,
                subscriptionId,
                amount: 0,
                currency: 'USD',
                status: 'pending',
                createdAt: new Date(),
              },
            ],
            isLoading: false,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to track referral',
            isLoading: false,
          });
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
        const { commissions, affiliates } = get();
        const affiliate = affiliates.find((a) => a.id === affiliateId);
        if (!affiliate) return;

        const pendingComms = commissions.filter(
          (c) => c.affiliateId === affiliateId && c.status === 'approved'
        );

        const totalPayout = pendingComms.reduce((sum, c) => sum + c.amount, 0);

        set({
          commissions: commissions.map((c) =>
            c.affiliateId === affiliateId && c.status === 'approved'
              ? { ...c, status: 'paid' as const, paidAt: new Date() }
              : c
          ),
          affiliates: affiliates.map((a) =>
            a.id === affiliateId
              ? {
                  ...a,
                  totalEarnings: a.totalEarnings + totalPayout,
                  pendingPayout: Math.max(0, a.pendingPayout - totalPayout),
                }
              : a
          ),
        });
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
        const activeReferrals = affiliates.filter(
          (a) => a.status === AffiliateStatus.ACTIVE
        ).length;

        return {
          totalReferrals,
          activeReferrals,
          totalEarnings,
          pendingPayout,
          conversionRate: totalReferrals > 0 ? (activeReferrals / totalReferrals) * 100 : 0,
        };
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        affiliates: state.affiliates,
        programs: state.programs,
        commissions: state.commissions,
      }),
    }
  )
);
