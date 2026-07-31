import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import {
  UserProgress,
  AchievementTrigger,
  GamificationConfig,
  RewardItem,
  GamificationAnalytics,
} from '../types/gamification';
import { gamificationService } from '../services/gamificationService';
import { presentLocalNotification } from '../services/notificationService';

const DEFAULT_CONFIG: GamificationConfig = {
  soundEffectsEnabled: true,
  notificationsEnabled: true,
  showOnLeaderboard: true,
  shareProfilePublicly: false,
  dailyReminderEnabled: true,
};

interface GamificationState extends UserProgress {
  config: GamificationConfig;
  earnedRewards: RewardItem[];
  pointsHistory: Array<{ timestamp: string; amount: number; reason: string }>;
  addPoints: (amount: number, reason?: string) => void;
  checkAchievements: (trigger: AchievementTrigger, metadata: any) => void;
  claimReward: (rewardId: string) => void;
  redeemReward: (rewardId: string) => void;
  updateConfig: (patch: Partial<GamificationConfig>) => void;
  getAnalytics: () => GamificationAnalytics;
  resetProgress: () => void;
}

const STORAGE_KEY = 'subtrackr-gamification';

export const useGamificationStore = create<GamificationState>()(
  persist(
    (set, get) => ({
      points: 0,
      level: 1,
      earnedAchievements: [],
      earnedBadges: [],
      streak: 0,
      lastActionAt: undefined,
      config: DEFAULT_CONFIG,
      earnedRewards: [],
      pointsHistory: [],

      addPoints: (amount, reason = 'General XP') => {
        const { points, level, pointsHistory } = get();
        const newPoints = points + amount;
        const newEntry = {
          timestamp: new Date().toISOString(),
          amount,
          reason,
        };

        const nextLevelPoints = Math.floor(100 * Math.pow(level, 1.5));

        if (newPoints >= nextLevelPoints) {
          set({
            points: newPoints,
            level: level + 1,
            pointsHistory: [newEntry, ...pointsHistory].slice(0, 100),
          });
          if (get().config.notificationsEnabled) {
            void presentLocalNotification({
              title: 'Level Up! 🎉',
              body: `You've reached level ${level + 1}! Keep tracking those subscriptions.`,
            });
          }
        } else {
          set({
            points: newPoints,
            pointsHistory: [newEntry, ...pointsHistory].slice(0, 100),
          });
        }
      },

      checkAchievements: (trigger, metadata) => {
        const { earnedAchievements, earnedBadges, earnedRewards, config } = get();
        const allAchievements = gamificationService.getAchievements();

        const newUnlocks = allAchievements.filter(
          (ach) =>
            ach.trigger === trigger &&
            !earnedAchievements.includes(ach.id) &&
            ach.criteria(metadata)
        );

        if (newUnlocks.length > 0) {
          const newIds = newUnlocks.map((a) => a.id);
          const newPoints = newUnlocks.reduce((acc, a) => acc + a.points, 0);
          const newBadgeIds = newUnlocks
            .map((a) => a.badgeId)
            .filter((b): b is string => !!b && !earnedBadges.includes(b));

          // Generate reward items if defined on achievement
          const newRewardItems: RewardItem[] = [];
          newUnlocks.forEach((ach) => {
            if (ach.reward) {
              const item: RewardItem = {
                id: `reward_${ach.id}_${Date.now()}`,
                rewardId: ach.reward.id,
                title: ach.name,
                description: ach.reward.description,
                type: ach.reward.type,
                value: ach.reward.value,
                code: ach.reward.code || `SUB-${ach.id.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`,
                isClaimed: false,
                isRedeemed: false,
                earnedAt: new Date().toISOString(),
              };
              newRewardItems.push(item);
            }
          });

          set((state) => ({
            earnedAchievements: [...state.earnedAchievements, ...newIds],
            earnedBadges: [...state.earnedBadges, ...newBadgeIds],
            earnedRewards: [...state.earnedRewards, ...newRewardItems],
          }));

          get().addPoints(newPoints, `Unlocked ${newUnlocks.length} achievement(s)`);

          if (config.notificationsEnabled) {
            newUnlocks.forEach((ach) => {
              void presentLocalNotification({
                title: 'Achievement Unlocked! 🏆',
                body: `${ach.name}: ${ach.description}`,
              });
            });
          }
        }
      },

      claimReward: (rewardId: string) => {
        set((state) => ({
          earnedRewards: state.earnedRewards.map((item) =>
            item.id === rewardId ? { ...item, isClaimed: true } : item
          ),
        }));
      },

      redeemReward: (rewardId: string) => {
        set((state) => ({
          earnedRewards: state.earnedRewards.map((item) =>
            item.id === rewardId
              ? { ...item, isRedeemed: true, redeemedAt: new Date().toISOString() }
              : item
          ),
        }));
      },

      updateConfig: (patch) => {
        set((state) => ({
          config: { ...state.config, ...patch },
        }));
      },

      getAnalytics: () => {
        const { points, level, earnedAchievements, earnedRewards, streak, pointsHistory } = get();
        const allAchievements = gamificationService.getAchievements();
        const completionRate =
          allAchievements.length > 0
            ? Math.round((earnedAchievements.length / allAchievements.length) * 100)
            : 0;

        const achievementsByCategory: Record<string, number> = {};
        allAchievements.forEach((ach) => {
          const isUnlocked = earnedAchievements.includes(ach.id);
          if (isUnlocked) {
            const cat = ach.trigger.toString();
            achievementsByCategory[cat] = (achievementsByCategory[cat] || 0) + 1;
          }
        });

        const totalRewardsClaimed = earnedRewards.filter((r) => r.isClaimed || r.isRedeemed).length;

        return {
          totalPointsEarned: points,
          totalAchievementsUnlocked: earnedAchievements.length,
          totalRewardsClaimed,
          currentLevel: level,
          longestStreak: streak,
          completionRate,
          achievementsByCategory,
          pointsHistory,
        };
      },

      resetProgress: () => {
        set({
          points: 0,
          level: 1,
          earnedAchievements: [],
          earnedBadges: [],
          streak: 0,
          lastActionAt: undefined,
          config: DEFAULT_CONFIG,
          earnedRewards: [],
          pointsHistory: [],
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
    }
  )
);
