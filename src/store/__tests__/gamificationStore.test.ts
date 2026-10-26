import { useGamificationStore } from '../gamificationStore';
import { AchievementTrigger } from '../../types/gamification';
import { presentLocalNotification } from '../../services/notificationService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/notificationService', () => ({
  presentLocalNotification: jest.fn(() => Promise.resolve()),
}));

describe('GamificationStore', () => {
  beforeEach(() => {
    useGamificationStore.getState().resetProgress();
    jest.clearAllMocks();
  });

  it('should initialize with level 1 and 0 points', () => {
    const state = useGamificationStore.getState();
    expect(state.level).toBe(1);
    expect(state.points).toBe(0);
    expect(state.earnedRewards).toEqual([]);
    expect(state.config.notificationsEnabled).toBe(true);
  });

  it('should add points and record transaction history', () => {
    useGamificationStore.getState().addPoints(50, 'Test XP');
    const state = useGamificationStore.getState();
    expect(state.points).toBe(50);
    expect(state.pointsHistory.length).toBe(1);
    expect(state.pointsHistory[0].amount).toBe(50);
    expect(state.pointsHistory[0].reason).toBe('Test XP');
  });

  it('should level up when enough points are added and send notification', () => {
    useGamificationStore.getState().addPoints(100);
    const state = useGamificationStore.getState();
    expect(state.level).toBe(2);
    expect(presentLocalNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Level Up! 🎉' })
    );
  });

  it('should suppress notification on level up if notificationsEnabled is false', () => {
    useGamificationStore.getState().updateConfig({ notificationsEnabled: false });
    useGamificationStore.getState().addPoints(100);
    const state = useGamificationStore.getState();
    expect(state.level).toBe(2);
    expect(presentLocalNotification).not.toHaveBeenCalled();
  });

  it('should unlock achievement and generate reward item', () => {
    useGamificationStore.getState().checkAchievements(AchievementTrigger.SUBSCRIPTION_ADDED, {
      totalSubscriptions: 5,
      price: 10,
    });

    const state = useGamificationStore.getState();
    expect(state.earnedAchievements).toContain('tracker_pro');
    expect(state.earnedBadges).toContain('professional_tracker');

    // Check reward item generation
    const reward = state.earnedRewards.find((r) => r.rewardId === 'rew_tracker_pro');
    expect(reward).toBeDefined();
    expect(reward?.title).toBe('Tracker Pro');
    expect(reward?.type).toBe('discount');
    expect(reward?.isClaimed).toBe(false);
  });

  it('should claim and redeem rewards correctly', () => {
    useGamificationStore.getState().checkAchievements(AchievementTrigger.SUBSCRIPTION_ADDED, {
      totalSubscriptions: 5,
      price: 10,
    });

    let state = useGamificationStore.getState();
    const rewardId = state.earnedRewards[0].id;

    useGamificationStore.getState().claimReward(rewardId);
    state = useGamificationStore.getState();
    expect(state.earnedRewards[0].isClaimed).toBe(true);
    expect(state.earnedRewards[0].isRedeemed).toBe(false);

    useGamificationStore.getState().redeemReward(rewardId);
    state = useGamificationStore.getState();
    expect(state.earnedRewards[0].isRedeemed).toBe(true);
    expect(state.earnedRewards[0].redeemedAt).toBeDefined();
  });

  it('should compute gamification analytics accurately', () => {
    useGamificationStore.getState().addPoints(150);
    useGamificationStore.getState().checkAchievements(AchievementTrigger.SUBSCRIPTION_ADDED, {
      totalSubscriptions: 1,
      price: 10,
    });

    const analytics = useGamificationStore.getState().getAnalytics();
    expect(analytics.totalPointsEarned).toBeGreaterThanOrEqual(150);
    expect(analytics.totalAchievementsUnlocked).toBeGreaterThanOrEqual(1);
    expect(analytics.completionRate).toBeGreaterThan(0);
    expect(
      analytics.achievementsByCategory[AchievementTrigger.SUBSCRIPTION_ADDED]
    ).toBeGreaterThanOrEqual(1);
  });

  it('should return zero completion rate before anything is unlocked', () => {
    const analytics = useGamificationStore.getState().getAnalytics();
    expect(analytics.completionRate).toBe(0);
    expect(analytics.totalAchievementsUnlocked).toBe(0);
    expect(analytics.totalRewardsClaimed).toBe(0);
    expect(analytics.pointsHistory).toEqual([]);
  });

  it('should reset all progress back to defaults', () => {
    useGamificationStore.getState().addPoints(250);
    useGamificationStore.getState().checkAchievements(AchievementTrigger.SUBSCRIPTION_ADDED, {
      totalSubscriptions: 1,
      price: 60,
    });
    useGamificationStore.getState().updateConfig({ notificationsEnabled: false });

    useGamificationStore.getState().resetProgress();

    const state = useGamificationStore.getState();
    expect(state.points).toBe(0);
    expect(state.level).toBe(1);
    expect(state.earnedAchievements).toEqual([]);
    expect(state.earnedBadges).toEqual([]);
    expect(state.earnedRewards).toEqual([]);
    expect(state.pointsHistory).toEqual([]);
    expect(state.config.notificationsEnabled).toBe(true);
  });

  it('should keep at most 100 entries in points history', () => {
    for (let i = 0; i < 120; i += 1) {
      useGamificationStore.getState().addPoints(1, `XP ${i}`);
    }
    expect(useGamificationStore.getState().pointsHistory).toHaveLength(100);
    expect(useGamificationStore.getState().pointsHistory[0].reason).toBe('XP 119');
  });
});

describe('GamificationStore achievement triggers', () => {
  beforeEach(() => {
    useGamificationStore.getState().resetProgress();
    jest.clearAllMocks();
  });

  it('should unlock crypto achievement on CRYPTO_PAYMENT with a credit reward', () => {
    useGamificationStore.getState().checkAchievements(AchievementTrigger.CRYPTO_PAYMENT, {});

    const state = useGamificationStore.getState();
    expect(state.earnedAchievements).toContain('crypto_pioneer');
    expect(state.earnedBadges).toContain('crypto_badge');
    expect(state.points).toBeGreaterThanOrEqual(150);

    const reward = state.earnedRewards.find((r) => r.rewardId === 'rew_crypto_pioneer');
    expect(reward?.type).toBe('credit');
    expect(reward?.value).toBe(500);
  });

  it('should unlock segment achievement on SEGMENT_CREATED', () => {
    useGamificationStore.getState().checkAchievements(AchievementTrigger.SEGMENT_CREATED, {});

    const state = useGamificationStore.getState();
    expect(state.earnedAchievements).toContain('segmenter');
    expect(state.earnedBadges).toContain('strategy_badge');
  });

  it('should unlock all points milestone achievements when lifetime points are high', () => {
    useGamificationStore.getState().checkAchievements(AchievementTrigger.POINTS_MILESTONE, {
      lifetimePoints: 15000,
    });

    const state = useGamificationStore.getState();
    expect(state.earnedAchievements).toEqual(
      expect.arrayContaining(['point_collector', 'point_hoarder', 'loyal_member'])
    );
    // 100 + 300 + 500 achievement XP
    expect(state.points).toBe(900);

    const vipReward = state.earnedRewards.find((r) => r.rewardId === 'rew_loyal_member');
    expect(vipReward?.type).toBe('discount');
    expect(vipReward?.code).toBe('VIP-20OFF');
  });

  it('should unlock streak achievements on STREAK_MILESTONE', () => {
    useGamificationStore.getState().checkAchievements(AchievementTrigger.STREAK_MILESTONE, {
      streak: 30,
    });

    const state = useGamificationStore.getState();
    expect(state.earnedAchievements).toEqual(
      expect.arrayContaining(['streak_starter', 'streak_master'])
    );

    const reward = state.earnedRewards.find((r) => r.rewardId === 'rew_streak_master');
    expect(reward?.code).toBe('STREAK-15OFF');
  });

  it('should unlock referral achievements on REFERRAL_MADE', () => {
    useGamificationStore.getState().checkAchievements(AchievementTrigger.REFERRAL_MADE, {
      totalReferrals: 5,
    });

    const state = useGamificationStore.getState();
    expect(state.earnedAchievements).toEqual(
      expect.arrayContaining(['referral_friend', 'referral_pro'])
    );

    const reward = state.earnedRewards.find((r) => r.rewardId === 'rew_referral_pro');
    expect(reward?.value).toBe(2500);
  });

  it('should not unlock achievements when criteria are not met', () => {
    useGamificationStore.getState().checkAchievements(AchievementTrigger.SUBSCRIPTION_ADDED, {
      totalSubscriptions: 0,
      price: 10,
    });
    useGamificationStore.getState().checkAchievements(AchievementTrigger.POINTS_MILESTONE, {
      lifetimePoints: 100,
    });
    useGamificationStore.getState().checkAchievements(AchievementTrigger.STREAK_MILESTONE, {
      streak: 2,
    });
    useGamificationStore.getState().checkAchievements(AchievementTrigger.REFERRAL_MADE, {
      totalReferrals: 0,
    });

    const state = useGamificationStore.getState();
    expect(state.earnedAchievements).toEqual([]);
    expect(state.earnedRewards).toEqual([]);
    expect(state.points).toBe(0);
    expect(presentLocalNotification).not.toHaveBeenCalled();
  });

  it('should not unlock the same achievement twice', () => {
    const trigger = AchievementTrigger.CRYPTO_PAYMENT;
    useGamificationStore.getState().checkAchievements(trigger, {});
    useGamificationStore.getState().checkAchievements(trigger, {});

    const state = useGamificationStore.getState();
    const occurrences = state.earnedAchievements.filter((id) => id === 'crypto_pioneer').length;
    expect(occurrences).toBe(1);
    expect(state.earnedBadges.filter((id) => id === 'crypto_badge')).toHaveLength(1);
    expect(state.earnedRewards).toHaveLength(1);
  });

  it('should send an achievement notification when unlocked and enabled', () => {
    useGamificationStore.getState().checkAchievements(AchievementTrigger.CRYPTO_PAYMENT, {});

    expect(presentLocalNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Achievement Unlocked! 🏆' })
    );
  });

  it('should suppress achievement notifications when disabled in config', () => {
    useGamificationStore.getState().updateConfig({ notificationsEnabled: false });
    useGamificationStore.getState().checkAchievements(AchievementTrigger.CRYPTO_PAYMENT, {});

    expect(presentLocalNotification).not.toHaveBeenCalled();
    expect(useGamificationStore.getState().earnedAchievements).toContain('crypto_pioneer');
  });

  it('should be a no-op for triggers with no defined achievements', () => {
    useGamificationStore.getState().checkAchievements(AchievementTrigger.BILLING_SUCCESS, {});
    useGamificationStore.getState().checkAchievements(AchievementTrigger.BILLING_FAILED, {});

    expect(useGamificationStore.getState().earnedAchievements).toEqual([]);
    expect(useGamificationStore.getState().points).toBe(0);
  });
});
