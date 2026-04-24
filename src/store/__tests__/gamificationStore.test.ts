import { useGamificationStore } from '../gamificationStore';
import { AchievementTrigger } from '../../types/gamification';

// Mocking dependencies if necessary
// In this case, we just test the store logic directly

describe('GamificationStore', () => {
  beforeEach(() => {
    useGamificationStore.getState().resetProgress();
  });

  it('should initialize with level 1 and 0 points', () => {
    const state = useGamificationStore.getState();
    expect(state.level).toBe(1);
    expect(state.points).toBe(0);
  });

  it('should add points correctly', () => {
    useGamificationStore.getState().addPoints(50);
    const state = useGamificationStore.getState();
    expect(state.points).toBe(50);
  });

  it('should level up when enough points are added', () => {
    // Level 2 requires Math.floor(100 * Math.pow(1, 1.5)) = 100 XP
    useGamificationStore.getState().addPoints(100);
    const state = useGamificationStore.getState();
    expect(state.level).toBe(2);
  });

  it('should unlock achievement when criteria are met', () => {
    // Trigger first_sub achievement
    useGamificationStore.getState().checkAchievements(AchievementTrigger.SUBSCRIPTION_ADDED, {
      totalSubscriptions: 1,
      price: 10,
    });
    
    const state = useGamificationStore.getState();
    expect(state.earnedAchievements).toContain('first_sub');
    expect(state.earnedBadges).toContain('novice_tracker');
    // points should increase by 50 (from achievement)
    expect(state.points).toBe(50);
  });
});
