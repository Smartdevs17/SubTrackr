import { Achievement, AchievementTrigger, Badge, LeaderboardEntry } from '../types/gamification';

export class GamificationService {
  private achievements: Achievement[] = [
    {
      id: 'first_sub',
      name: 'Getting Started',
      description: 'Add your first subscription.',
      trigger: AchievementTrigger.SUBSCRIPTION_ADDED,
      criteria: (metadata) => metadata.totalSubscriptions >= 1,
      points: 50,
      badgeId: 'novice_tracker',
    },
    {
      id: 'tracker_pro',
      name: 'Tracker Pro',
      description: 'Add 5 subscriptions.',
      trigger: AchievementTrigger.SUBSCRIPTION_ADDED,
      criteria: (metadata) => metadata.totalSubscriptions >= 5,
      points: 200,
      badgeId: 'professional_tracker',
    },
    {
      id: 'crypto_pioneer',
      name: 'Crypto Pioneer',
      description: 'Make a payment using crypto.',
      trigger: AchievementTrigger.CRYPTO_PAYMENT,
      criteria: () => true,
      points: 150,
      badgeId: 'crypto_badge',
    },
    {
      id: 'high_roller',
      name: 'High Roller',
      description: 'Add a subscription worth more than $50/month.',
      trigger: AchievementTrigger.SUBSCRIPTION_ADDED,
      criteria: (metadata) => metadata.price >= 50,
      points: 100,
      badgeId: 'money_bags',
    },
    {
      id: 'segmenter',
      name: 'Strategic Merchant',
      description: 'Create your first user segment.',
      trigger: AchievementTrigger.SEGMENT_CREATED,
      criteria: () => true,
      points: 75,
      badgeId: 'strategy_badge',
    },
    {
      id: 'point_collector',
      name: 'Point Collector',
      description: 'Earn 1,000 lifetime loyalty points.',
      trigger: AchievementTrigger.POINTS_MILESTONE,
      criteria: (metadata) => metadata.lifetimePoints >= 1000,
      points: 100,
      badgeId: 'collector_badge',
    },
    {
      id: 'point_hoarder',
      name: 'Point Hoarder',
      description: 'Earn 5,000 lifetime loyalty points.',
      trigger: AchievementTrigger.POINTS_MILESTONE,
      criteria: (metadata) => metadata.lifetimePoints >= 5000,
      points: 300,
      badgeId: 'hoarder_badge',
    },
    {
      id: 'loyal_member',
      name: 'Loyal Member',
      description: 'Earn 15,000 lifetime loyalty points.',
      trigger: AchievementTrigger.POINTS_MILESTONE,
      criteria: (metadata) => metadata.lifetimePoints >= 15000,
      points: 500,
      badgeId: 'loyal_badge',
    },
    {
      id: 'streak_starter',
      name: 'Streak Starter',
      description: 'Maintain a 5-charge streak.',
      trigger: AchievementTrigger.STREAK_MILESTONE,
      criteria: (metadata) => metadata.streak >= 5,
      points: 50,
      badgeId: 'streak_starter_badge',
    },
    {
      id: 'streak_master',
      name: 'Streak Master',
      description: 'Maintain a 30-charge streak.',
      trigger: AchievementTrigger.STREAK_MILESTONE,
      criteria: (metadata) => metadata.streak >= 30,
      points: 200,
      badgeId: 'streak_master_badge',
    },
    {
      id: 'referral_friend',
      name: 'Social Butterfly',
      description: 'Refer your first friend.',
      trigger: AchievementTrigger.REFERRAL_MADE,
      criteria: (metadata) => metadata.totalReferrals >= 1,
      points: 75,
      badgeId: 'referral_badge',
    },
    {
      id: 'referral_pro',
      name: 'Networker',
      description: 'Refer 5 friends.',
      trigger: AchievementTrigger.REFERRAL_MADE,
      criteria: (metadata) => metadata.totalReferrals >= 5,
      points: 250,
      badgeId: 'networker_badge',
    },
  ];

  private badges: Badge[] = [
    {
      id: 'novice_tracker',
      name: 'Novice Tracker',
      description: 'Welcome to the world of subscription management.',
      icon: '🌱',
      color: '#10b981',
    },
    {
      id: 'professional_tracker',
      name: 'Professional Tracker',
      description: 'You are serious about your subscriptions.',
      icon: '⚔️',
      color: '#6366f1',
    },
    {
      id: 'crypto_badge',
      name: 'Crypto Native',
      description: 'Future-proofing your payments.',
      icon: '💎',
      color: '#f59e0b',
    },
    {
      id: 'money_bags',
      name: 'Whale',
      description: 'Big spender in the house.',
      icon: '🐳',
      color: '#06b6d4',
    },
    {
      id: 'strategy_badge',
      name: 'Strategist',
      description: 'Master of segmentation.',
      icon: '🎯',
      color: '#8b5cf6',
    },
    {
      id: 'collector_badge',
      name: 'Collector',
      description: 'Earned 1,000 loyalty points.',
      icon: '⭐',
      color: '#f59e0b',
    },
    {
      id: 'hoarder_badge',
      name: 'Hoarder',
      description: 'Earned 5,000 loyalty points.',
      icon: '💎',
      color: '#06b6d4',
    },
    {
      id: 'loyal_badge',
      name: 'Loyal Legend',
      description: 'Earned 15,000 loyalty points.',
      icon: '👑',
      color: '#8b5cf6',
    },
    {
      id: 'streak_starter_badge',
      name: 'On a Roll',
      description: '5-charge streak.',
      icon: '🔥',
      color: '#f97316',
    },
    {
      id: 'streak_master_badge',
      name: 'Unstoppable',
      description: '30-charge streak.',
      icon: '🔥',
      color: '#ef4444',
    },
    {
      id: 'referral_badge',
      name: 'Social Butterfly',
      description: 'Referred first friend.',
      icon: '🦋',
      color: '#10b981',
    },
    {
      id: 'networker_badge',
      name: 'Networker',
      description: 'Referred 5 friends.',
      icon: '🌐',
      color: '#6366f1',
    },
  ];

  getAchievements(): Achievement[] {
    return this.achievements;
  }

  getBadges(): Badge[] {
    return this.badges;
  }

  getBadgeById(id: string): Badge | undefined {
    return this.badges.find((b) => b.id === id);
  }

  /**
   * Generates a mocked leaderboard.
   */
  getLeaderboard(currentUserPoints: number, currentUserName: string): LeaderboardEntry[] {
    const mockUsers = [
      { name: 'Alice', points: 1250, level: 5 },
      { name: 'Bob', points: 980, level: 4 },
      { name: 'Charlie', points: 850, level: 3 },
      { name: 'Diana', points: 600, level: 3 },
      { name: 'Ethan', points: 450, level: 2 },
    ];

    const allEntries = [
      ...mockUsers,
      {
        name: currentUserName,
        points: currentUserPoints,
        level: Math.floor(currentUserPoints / 250) + 1,
        isCurrentUser: true,
      },
    ].sort((a, b) => b.points - a.points);

    return allEntries.map((entry, index) => ({
      rank: index + 1,
      ...entry,
      level: entry.level || 1,
    }));
  }
}

export const gamificationService = new GamificationService();
