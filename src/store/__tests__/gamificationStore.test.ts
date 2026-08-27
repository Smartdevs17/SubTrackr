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
    expect(analytics.achievementsByCategory[AchievementTrigger.SUBSCRIPTION_ADDED]).toBeGreaterThanOrEqual(1);
  });
});
