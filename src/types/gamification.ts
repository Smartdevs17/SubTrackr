export enum AchievementTrigger {
  SUBSCRIPTION_ADDED = 'SUBSCRIPTION_ADDED',
  BILLING_SUCCESS = 'BILLING_SUCCESS',
  BILLING_FAILED = 'BILLING_FAILED',
  CRYPTO_PAYMENT = 'CRYPTO_PAYMENT',
  STREAK_MAINTAINED = 'STREAK_MAINTAINED',
  SEGMENT_CREATED = 'SEGMENT_CREATED',
  POINTS_MILESTONE = 'POINTS_MILESTONE',
  STREAK_MILESTONE = 'STREAK_MILESTONE',
  REFERRAL_MADE = 'REFERRAL_MADE',
}

export interface RewardDefinition {
  id: string;
  type: 'discount' | 'credit' | 'badge';
  value: number | string; // e.g., "10%" or 500
  description: string;
  code?: string; // default coupon prefix if discount
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  trigger: AchievementTrigger;
  criteria: (metadata: any) => boolean;
  points: number;
  badgeId?: string;
  reward?: RewardDefinition;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  unlockedAt?: Date;
}

export interface RewardItem {
  id: string;
  rewardId: string;
  title: string;
  description: string;
  type: 'discount' | 'credit' | 'badge';
  value: number | string;
  code?: string;
  isClaimed: boolean;
  isRedeemed: boolean;
  earnedAt: string;
  redeemedAt?: string;
}

export interface UserProgress {
  points: number;
  level: number;
  earnedAchievements: string[]; // IDs
  earnedBadges: string[]; // IDs
  streak: number;
  lastActionAt?: Date;
}

export interface GamificationConfig {
  soundEffectsEnabled: boolean;
  notificationsEnabled: boolean;
  showOnLeaderboard: boolean;
  shareProfilePublicly: boolean;
  dailyReminderEnabled: boolean;
}

export interface GamificationAnalytics {
  totalPointsEarned: number;
  totalAchievementsUnlocked: number;
  totalRewardsClaimed: number;
  currentLevel: number;
  longestStreak: number;
  completionRate: number; // percentage 0-100
  achievementsByCategory: Record<string, number>;
  pointsHistory: Array<{ timestamp: string; amount: number; reason: string }>;
}

export type LeaderboardCategory = 'all_time' | 'weekly' | 'streaks';

export interface LeaderboardEntry {
  rank: number;
  name: string;
  points: number;
  level: number;
  avatar?: string;
  streak?: number;
  isCurrentUser?: boolean;
}
