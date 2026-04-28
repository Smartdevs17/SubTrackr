import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LoyaltyStatus,
  LoyaltyTier,
  PointsTransaction,
  Reward,
  RewardType,
  TierBenefits,
  LoyaltyProgram,
} from '../types/loyalty';

const STORAGE_KEY = 'subtrackr-loyalty';
const STORE_VERSION = 1;

interface LoyaltyState {
  loyaltyStatus: LoyaltyStatus | null;
  transactions: PointsTransaction[];
  rewards: Reward[];
  program: LoyaltyProgram | null;
  isLoading: boolean;
  error: string | null;

  initializeProgram: () => Promise<void>;
  accumulatePoints: (subscriberId: string, subscriptionId: string, amount: number) => Promise<void>;
  redeemPoints: (rewardId: string) => Promise<boolean>;
  checkTierUpgrade: () => void;
  expirePoints: () => void;
}

const generateUniqueId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomComponent}`;
};

const defaultTierBenefits: TierBenefits[] = [
  {
    tier: LoyaltyTier.BRONZE,
    benefits: [{ type: 'base', description: 'Base rewards', value: 1 }],
    pointsThreshold: 0,
    discountRate: 0,
    prioritySupport: false,
    reducedFees: 0,
  },
  {
    tier: LoyaltyTier.SILVER,
    benefits: [
      { type: 'base', description: 'Base rewards', value: 1 },
      { type: 'discount', description: '5% discount', value: 5 },
    ],
    pointsThreshold: 1000,
    discountRate: 5,
    prioritySupport: false,
    reducedFees: 2,
  },
  {
    tier: LoyaltyTier.GOLD,
    benefits: [
      { type: 'base', description: 'Base rewards', value: 1 },
      { type: 'discount', description: '10% discount', value: 10 },
      { type: 'priority', description: 'Priority support', value: 1 },
    ],
    pointsThreshold: 5000,
    discountRate: 10,
    prioritySupport: true,
    reducedFees: 5,
  },
  {
    tier: LoyaltyTier.PLATINUM,
    benefits: [
      { type: 'base', description: 'Base rewards', value: 1 },
      { type: 'discount', description: '15% discount', value: 15 },
      { type: 'priority', description: 'Priority support', value: 1 },
      { type: 'exclusive', description: 'Exclusive offers', value: 1 },
    ],
    pointsThreshold: 15000,
    discountRate: 15,
    prioritySupport: true,
    reducedFees: 10,
  },
];

const defaultRewards: Reward[] = [
  {
    id: 'reward-1',
    name: '$5 Discount',
    type: RewardType.DISCOUNT,
    pointsCost: 500,
    value: 5,
    description: '$5 off your next billing cycle',
    isActive: true,
  },
  {
    id: 'reward-2',
    name: '$10 Discount',
    type: RewardType.DISCOUNT,
    pointsCost: 900,
    value: 10,
    description: '$10 off your next billing cycle',
    isActive: true,
  },
  {
    id: 'reward-3',
    name: 'Free Month',
    type: RewardType.FREE_MONTH,
    pointsCost: 2000,
    value: 0,
    description: 'Get one month free',
    isActive: true,
  },
  {
    id: 'reward-4',
    name: 'T-Shirt',
    type: RewardType.MERCHANDISE,
    pointsCost: 5000,
    value: 25,
    description: 'Exclusive SubTrackr t-shirt',
    isActive: true,
  },
];

const getTierFromPoints = (points: number): LoyaltyTier => {
  if (points >= 15000) return LoyaltyTier.PLATINUM;
  if (points >= 5000) return LoyaltyTier.GOLD;
  if (points >= 1000) return LoyaltyTier.SILVER;
  return LoyaltyTier.BRONZE;
};

const calculatePointsExpiration = (pointsExpirationDays: number, memberSince: Date): Date => {
  const expirationDate = new Date(memberSince);
  expirationDate.setDate(expirationDate.getDate() + pointsExpirationDays);
  return expirationDate;
};

export const useLoyaltyStore = create<LoyaltyState>()(
  persist(
    (set, get) => ({
      loyaltyStatus: null,
      transactions: [],
      rewards: defaultRewards,
      program: null,
      isLoading: false,
      error: null,

      initializeProgram: async () => {
        const program: LoyaltyProgram = {
          id: generateUniqueId(),
          name: 'SubTrackr Rewards',
          tiers: defaultTierBenefits,
          pointsPerDollar: 10,
          pointsExpirationDays: 365,
          isActive: true,
        };
        set({ program });
      },

      accumulatePoints: async (subscriberId: string, subscriptionId: string, amount: number) => {
        const { program, transactions, loyaltyStatus } = get();
        if (!program) return;

        const pointsEarned = Math.floor(amount * program.pointsPerDollar);

        const transaction: PointsTransaction = {
          id: generateUniqueId(),
          subscriberId,
          amount: pointsEarned,
          type: 'earn',
          subscriptionId,
          description: `Points earned from subscription`,
          createdAt: new Date(),
        };

        const currentPoints = loyaltyStatus?.points || 0;
        const lifetimePoints = loyaltyStatus?.lifetimePoints || 0;
        const totalSpent = loyaltyStatus?.totalSpent || 0;

        const newStatus: LoyaltyStatus = {
          subscriberId,
          tier: getTierFromPoints(currentPoints + pointsEarned),
          points: currentPoints + pointsEarned,
          lifetimePoints: lifetimePoints + pointsEarned,
          totalSpent: totalSpent + amount,
          memberSince: loyaltyStatus?.memberSince || new Date(),
          pointsExpirationDate: calculatePointsExpiration(
            program.pointsExpirationDays,
            loyaltyStatus?.memberSince || new Date()
          ),
        };

        set({
          transactions: [...transactions, transaction],
          loyaltyStatus: newStatus,
        });
      },

      redeemPoints: async (rewardId: string) => {
        const { rewards, loyaltyStatus } = get();
        const reward = rewards.find((r) => r.id === rewardId);

        if (!reward || !loyaltyStatus) return false;
        if (!reward.isActive) return false;
        if (loyaltyStatus.points < reward.pointsCost) return false;

        const transaction: PointsTransaction = {
          id: generateUniqueId(),
          subscriberId: loyaltyStatus.subscriberId,
          amount: -reward.pointsCost,
          type: 'redeem',
          description: `Redeemed: ${reward.name}`,
          createdAt: new Date(),
        };

        set({
          transactions: [...get().transactions, transaction],
          loyaltyStatus: {
            ...loyaltyStatus,
            points: loyaltyStatus.points - reward.pointsCost,
          },
        });

        return true;
      },

      checkTierUpgrade: () => {
        const { loyaltyStatus } = get();
        if (!loyaltyStatus) return;

        const newTier = getTierFromPoints(loyaltyStatus.lifetimePoints);
        if (newTier !== loyaltyStatus.tier) {
          set({
            loyaltyStatus: {
              ...loyaltyStatus,
              tier: newTier,
            },
          });
        }
      },

      expirePoints: () => {
        const { loyaltyStatus, transactions } = get();
        if (!loyaltyStatus?.pointsExpirationDate) return;

        const now = new Date();
        if (now > loyaltyStatus.pointsExpirationDate) {
          const expiredTransaction: PointsTransaction = {
            id: generateUniqueId(),
            subscriberId: loyaltyStatus.subscriberId,
            amount: -loyaltyStatus.points,
            type: 'expire',
            description: 'Points expired',
            createdAt: new Date(),
          };

          set({
            transactions: [...transactions, expiredTransaction],
            loyaltyStatus: {
              ...loyaltyStatus,
              points: 0,
              pointsExpirationDate: undefined,
            },
          });
        }
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        loyaltyStatus: state.loyaltyStatus,
        transactions: state.transactions,
        rewards: state.rewards,
        program: state.program,
      }),
    }
  )
);