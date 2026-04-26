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
