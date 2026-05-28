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
const STORE_VERSION = 2;

// ── Gamification types ───────────────────────────────────────────────────────

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  condition: (state: Pick<LoyaltyState, 'loyaltyStatus' | 'streak' | 'transactions'>) => boolean;
  unlockedAt?: Date;
}

export interface StreakData {
  current: number;
  longest: number;
  lastPaymentDate: string | null; // ISO date string (date only)
  frozenUntil?: string | null;    // streak freeze mechanic
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const generateUniqueId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

const toDateStr = (d: Date): string => d.toISOString().slice(0, 10);

const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

const getTierFromPoints = (points: number): LoyaltyTier => {
  if (points >= 15000) return LoyaltyTier.PLATINUM;
  if (points >= 5000) return LoyaltyTier.GOLD;
  if (points >= 1000) return LoyaltyTier.SILVER;
  return LoyaltyTier.BRONZE;
};

// ── Default data ─────────────────────────────────────────────────────────────

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

/** Achievement definitions — conditions evaluated after every state change. */
export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first-payment',
    name: 'First Payment',
    description: 'Make your first on-time payment',
    icon: '🎉',
    condition: ({ transactions }) => transactions.some((t) => t.type === 'earn'),
  },
  {
    id: 'streak-7',
    name: 'Week Warrior',
    description: '7-day payment streak',
    icon: '🔥',
    condition: ({ streak }) => streak.current >= 7,
  },
  {
    id: 'streak-30',
    name: 'Monthly Master',
    description: '30-day payment streak',
    icon: '⚡',
    condition: ({ streak }) => streak.current >= 30,
  },
  {
    id: 'silver-tier',
    name: 'Silver Member',
    description: 'Reach Silver tier',
    icon: '🥈',
    condition: ({ loyaltyStatus }) =>
      loyaltyStatus !== null &&
      [LoyaltyTier.SILVER, LoyaltyTier.GOLD, LoyaltyTier.PLATINUM].includes(loyaltyStatus.tier),
  },
  {
    id: 'gold-tier',
    name: 'Gold Member',
    description: 'Reach Gold tier',
    icon: '🥇',
    condition: ({ loyaltyStatus }) =>
      loyaltyStatus !== null &&
      [LoyaltyTier.GOLD, LoyaltyTier.PLATINUM].includes(loyaltyStatus.tier),
  },
  {
    id: 'points-1000',
    name: 'Points Collector',
    description: 'Earn 1,000 lifetime points',
    icon: '💎',
    condition: ({ loyaltyStatus }) => (loyaltyStatus?.lifetimePoints ?? 0) >= 1000,
  },
  {
    id: 'first-redemption',
    name: 'Redeemer',
    description: 'Redeem a reward for the first time',
    icon: '🎁',
    condition: ({ transactions }) => transactions.some((t) => t.type === 'redeem'),
  },
];

// ── Store interface ──────────────────────────────────────────────────────────

interface LoyaltyState {
  loyaltyStatus: LoyaltyStatus | null;
  transactions: PointsTransaction[];
  rewards: Reward[];
  program: LoyaltyProgram | null;
  streak: StreakData;
  achievements: Achievement[];
  newlyUnlocked: Achievement[];   // cleared after UI reads them
  isLoading: boolean;
  error: string | null;
  /** Mutex flag to prevent concurrent points mutations */
  _pointsMutex: boolean;

  initializeProgram: () => Promise<void>;
  accumulatePoints: (subscriberId: string, subscriptionId: string, amount: number) => Promise<void>;
  redeemPoints: (rewardId: string) => Promise<boolean>;
  checkTierUpgrade: () => void;
  expirePoints: () => void;
  recordPayment: (date?: Date) => void;
  freezeStreak: (days: number) => void;
  clearNewlyUnlocked: () => void;
  /** Retroactively evaluate all achievements against current state */
  evaluateAchievements: () => Achievement[];
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useLoyaltyStore = create<LoyaltyState>()(
  persist(
    (set, get) => ({
      loyaltyStatus: null,
      transactions: [],
      rewards: defaultRewards,
      program: null,
      streak: { current: 0, longest: 0, lastPaymentDate: null, frozenUntil: null },
      achievements: ACHIEVEMENTS.map((a) => ({ ...a, unlockedAt: undefined })),
      newlyUnlocked: [],
      isLoading: false,
      error: null,
      _pointsMutex: false,

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

      accumulatePoints: async (subscriberId, subscriptionId, amount) => {
        // Race condition guard: spin-wait up to 500ms
        const deadline = Date.now() + 500;
        while (get()._pointsMutex && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 10));
        }
        set({ _pointsMutex: true });

        try {
          const { program, transactions, loyaltyStatus } = get();
          if (!program) return;

          const pointsEarned = Math.floor(amount * program.pointsPerDollar);
          const currentPoints = loyaltyStatus?.points ?? 0;
          const lifetimePoints = loyaltyStatus?.lifetimePoints ?? 0;
          const totalSpent = loyaltyStatus?.totalSpent ?? 0;

          const transaction: PointsTransaction = {
            id: generateUniqueId(),
            subscriberId,
            amount: pointsEarned,
            type: 'earn',
            subscriptionId,
            description: 'Points earned from subscription',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + program.pointsExpirationDays * 86_400_000),
          };

          const newPoints = currentPoints + pointsEarned;
          const newLifetime = lifetimePoints + pointsEarned;

          const newStatus: LoyaltyStatus = {
            subscriberId,
            tier: getTierFromPoints(newLifetime),
            points: newPoints,
            lifetimePoints: newLifetime,
            totalSpent: totalSpent + amount,
            memberSince: loyaltyStatus?.memberSince ?? new Date(),
            pointsExpirationDate: new Date(
              Date.now() + program.pointsExpirationDays * 86_400_000,
            ),
          };

          set({ transactions: [...transactions, transaction], loyaltyStatus: newStatus });
          get().evaluateAchievements();
        } finally {
          set({ _pointsMutex: false });
        }
      },

      redeemPoints: async (rewardId) => {
        const deadline = Date.now() + 500;
        while (get()._pointsMutex && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 10));
        }
        set({ _pointsMutex: true });

        try {
          const { rewards, loyaltyStatus } = get();
          const reward = rewards.find((r) => r.id === rewardId);
          if (!reward?.isActive || !loyaltyStatus) return false;
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
            loyaltyStatus: { ...loyaltyStatus, points: loyaltyStatus.points - reward.pointsCost },
          });
          get().evaluateAchievements();
          return true;
        } finally {
          set({ _pointsMutex: false });
        }
      },

      checkTierUpgrade: () => {
        const { loyaltyStatus } = get();
        if (!loyaltyStatus) return;
        const newTier = getTierFromPoints(loyaltyStatus.lifetimePoints);
        if (newTier !== loyaltyStatus.tier) {
          set({ loyaltyStatus: { ...loyaltyStatus, tier: newTier } });
          get().evaluateAchievements();
        }
      },

      expirePoints: () => {
        const { loyaltyStatus, transactions } = get();
        if (!loyaltyStatus?.pointsExpirationDate) return;
        if (new Date() <= loyaltyStatus.pointsExpirationDate) return;

        const expiredTx: PointsTransaction = {
          id: generateUniqueId(),
          subscriberId: loyaltyStatus.subscriberId,
          amount: -loyaltyStatus.points,
          type: 'expire',
          description: 'Points expired',
          createdAt: new Date(),
        };
        set({
          transactions: [...transactions, expiredTx],
          loyaltyStatus: { ...loyaltyStatus, points: 0, pointsExpirationDate: undefined },
        });
      },

      recordPayment: (date = new Date()) => {
        const { streak } = get();
        const today = toDateStr(date);
        const { lastPaymentDate, frozenUntil } = streak;

        // Streak freeze: if frozen, don't break streak
        if (frozenUntil && today <= frozenUntil) {
          set({ streak: { ...streak, lastPaymentDate: today } });
          return;
        }

        let newCurrent = streak.current;
        if (!lastPaymentDate) {
          newCurrent = 1;
        } else {
          const diff = daysBetween(lastPaymentDate, today);
          if (diff === 0) return; // same day, no change
          if (diff === 1) {
            newCurrent = streak.current + 1;
          } else {
            newCurrent = 1; // streak broken
          }
        }

        const newStreak: StreakData = {
          current: newCurrent,
          longest: Math.max(streak.longest, newCurrent),
          lastPaymentDate: today,
          frozenUntil: null,
        };
        set({ streak: newStreak });
        get().evaluateAchievements();
      },

      freezeStreak: (days) => {
        const { streak } = get();
        const until = toDateStr(new Date(Date.now() + days * 86_400_000));
        set({ streak: { ...streak, frozenUntil: until } });
      },

      clearNewlyUnlocked: () => set({ newlyUnlocked: [] }),

      evaluateAchievements: () => {
        const state = get();
        const { achievements, loyaltyStatus, streak, transactions } = state;
        const context = { loyaltyStatus, streak, transactions };
        const newlyUnlocked: Achievement[] = [];

        const updated = achievements.map((a) => {
          if (a.unlockedAt) return a; // already unlocked
          if (a.condition(context)) {
            const unlocked = { ...a, unlockedAt: new Date() };
            newlyUnlocked.push(unlocked);
            return unlocked;
          }
          return a;
        });

        set({ achievements: updated, newlyUnlocked });
        return newlyUnlocked;
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
        streak: state.streak,
        achievements: state.achievements,
      }),
    },
  ),
);
