export enum AchievementTrigger {
  SUBSCRIPTION_ADDED = 'SUBSCRIPTION_ADDED',
  BILLING_SUCCESS = 'BILLING_SUCCESS',
  BILLING_FAILED = 'BILLING_FAILED',
  CRYPTO_PAYMENT = 'CRYPTO_PAYMENT',
  STREAK_MAINTAINED = 'STREAK_MAINTAINED',
  SEGMENT_CREATED = 'SEGMENT_CREATED',
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  trigger: AchievementTrigger;
  criteria: (metadata: any) => boolean;
  points: number;
  badgeId?: string;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  unlockedAt?: Date;
}

export interface UserProgress {
  points: number;
  level: number;
  earnedAchievements: string[]; // IDs
  earnedBadges: string[]; // IDs
  streak: number;
  lastActionAt?: Date;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  points: number;
  level: number;
  avatar?: string;
  isCurrentUser?: boolean;
}
