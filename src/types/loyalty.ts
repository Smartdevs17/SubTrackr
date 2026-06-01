export enum LoyaltyTier {
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
}

export enum RewardType {
  DISCOUNT = 'discount',
  FREE_MONTH = 'free_month',
  MERCHANDISE = 'merchandise',
}

export enum PointTxType {
  EARNED = 'earned',
  REDEEMED = 'redeemed',
  EXPIRED = 'expired',
  REFERRAL_BONUS = 'referral_bonus',
  STREAK_BONUS = 'streak_bonus',
  ACHIEVEMENT = 'achievement',
}

export interface LoyaltyBenefit {
  type: string;
  description: string;
  value: number;
}

export interface TierBenefits {
  tier: LoyaltyTier;
  benefits: LoyaltyBenefit[];
  pointsThreshold: number;
  discountRate: number;
  prioritySupport: boolean;
  reducedFees: number;
}

export interface PointsTransaction {
  id: string;
  subscriberId: string;
  amount: number;
  type: PointTxType;
  subscriptionId?: string;
  description: string;
  createdAt: Date;
  expiresAt?: Date;
}

export interface Reward {
  id: string;
  name: string;
  type: RewardType;
  pointsCost: number;
  value: number;
  description: string;
  isActive: boolean;
}

export interface LoyaltyStatus {
  subscriberId: string;
  tier: LoyaltyTier;
  points: number;
  lifetimePoints: number;
  totalSpent: number;
  memberSince: Date;
  pointsExpirationDate?: Date;
  streak: number;
}

export interface LoyaltyConfig {
  pointsPerDollar: number;
  expirationDays: number;
  tiers: TierBenefits[];
  streakBonusThreshold: number;
}

export interface LoyaltyProgram {
  id: string;
  name: string;
  tiers: TierBenefits[];
  pointsPerDollar: number;
  pointsExpirationDays: number;
  isActive: boolean;
}
