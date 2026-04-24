import { gamificationService } from '../gamificationService';

describe('GamificationService', () => {
  it('should return all achievements', () => {
    const achievements = gamificationService.getAchievements();
    expect(achievements.length).toBeGreaterThan(0);
  });

  it('should return all badges', () => {
    const badges = gamificationService.getBadges();
    expect(badges.length).toBeGreaterThan(0);
  });

  it('should generate leaderboard with current user', () => {
    const leaderboard = gamificationService.getLeaderboard(500, 'Test User');
    expect(leaderboard.some(entry => entry.name === 'Test User')).toBe(true);
    expect(leaderboard[0].rank).toBe(1);
  });
});
