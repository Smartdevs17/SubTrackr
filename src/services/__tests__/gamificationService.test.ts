import { Share } from 'react-native';
import { gamificationService } from '../gamificationService';

jest.mock('react-native', () => ({
  Share: {
    share: jest.fn(() => Promise.resolve({ action: 'sharedAction' })),
  },
}));

describe('GamificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return all achievements including those with rewards', () => {
    const achievements = gamificationService.getAchievements();
    expect(achievements.length).toBeGreaterThan(0);
    const withReward = achievements.find((a) => a.reward !== undefined);
    expect(withReward).toBeDefined();
    expect(withReward?.reward?.type).toMatch(/discount|credit|badge/);
  });

  it('should return all badges and lookup by id', () => {
    const badges = gamificationService.getBadges();
    expect(badges.length).toBeGreaterThan(0);
    const badge = gamificationService.getBadgeById('novice_tracker');
    expect(badge).toBeDefined();
    expect(badge?.name).toBe('Novice Tracker');
  });

  it('should generate all_time leaderboard with current user', () => {
    const leaderboard = gamificationService.getLeaderboard(500, 'Test User', 'all_time');
    expect(leaderboard.some((entry) => entry.name === 'Test User' || entry.isCurrentUser)).toBe(true);
  });

  it('should generate weekly leaderboard scaling points appropriately', () => {
    const leaderboard = gamificationService.getLeaderboard(1000, 'Test User', 'weekly');
    const userEntry = leaderboard.find((entry) => entry.isCurrentUser);
    expect(userEntry?.points).toBe(300); // Math.floor(1000 * 0.3)
  });

  it('should generate streaks leaderboard sorted by streak count', () => {
    const leaderboard = gamificationService.getLeaderboard(500, 'Test User', 'streaks', 25);
    const userEntry = leaderboard.find((entry) => entry.isCurrentUser);
    expect(userEntry?.streak).toBe(25);
    expect(leaderboard[0].streak).toBeGreaterThanOrEqual(leaderboard[1].streak || 0);
  });

  it('should share achievement using native Share API', async () => {
    const ach = gamificationService.getAchievements()[0];
    await gamificationService.shareAchievement(ach, { points: 50, level: 1, earnedAchievements: [], earnedBadges: [], streak: 1 });
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining(ach.name) })
    );
  });

  it('should share badge using native Share API', async () => {
    const badge = gamificationService.getBadges()[0];
    await gamificationService.shareBadge(badge, { points: 50, level: 1, earnedAchievements: [], earnedBadges: [], streak: 1 });
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining(badge.name) })
    );
  });

  it('should share level using native Share API', async () => {
    await gamificationService.shareLevel({ points: 500, level: 3, earnedAchievements: [], earnedBadges: [], streak: 5 });
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Level 3') })
    );
  });
});
