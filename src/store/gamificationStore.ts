import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProgress, AchievementTrigger, Achievement } from '../types/gamification';
import { gamificationService } from '../services/gamificationService';
import { presentLocalNotification } from '../services/notificationService';

interface GamificationState extends UserProgress {
  addPoints: (amount: number) => void;
  checkAchievements: (trigger: AchievementTrigger, metadata: any) => void;
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

      addPoints: (amount) => {
        const { points, level } = get();
        const newPoints = points + amount;
        
        // Calculate level up
        // Level 1: 0, Level 2: 250, Level 3: 650, etc.
        const nextLevelPoints = Math.floor(100 * Math.pow(level, 1.5));
        
        if (newPoints >= nextLevelPoints) {
          set({
            points: newPoints,
            level: level + 1,
          });
          void presentLocalNotification({
            title: 'Level Up! 🎉',
            body: `You've reached level ${level + 1}! Keep tracking those subscriptions.`,
          });
        } else {
          set({ points: newPoints });
        }
      },

      checkAchievements: (trigger, metadata) => {
        const { earnedAchievements, earnedBadges } = get();
        const allAchievements = gamificationService.getAchievements();
        
        const newUnlocks = allAchievements.filter(
          (ach) => 
            ach.trigger === trigger && 
            !earnedAchievements.includes(ach.id) && 
            ach.criteria(metadata)
        );

        if (newUnlocks.length > 0) {
          const newIds = newUnlocks.map(a => a.id);
          const newPoints = newUnlocks.reduce((acc, a) => acc + a.points, 0);
          const newBadgeIds = newUnlocks
            .map(a => a.badgeId)
            .filter((b): b is string => !!b && !earnedBadges.includes(b));

          set((state) => ({
            earnedAchievements: [...state.earnedAchievements, ...newIds],
            earnedBadges: [...state.earnedBadges, ...newBadgeIds],
          }));

          get().addPoints(newPoints);

          newUnlocks.forEach(ach => {
            void presentLocalNotification({
              title: 'Achievement Unlocked! 🏆',
              body: `${ach.name}: ${ach.description}`,
            });
          });
        }
      },

      resetProgress: () => {
        set({
          points: 0,
          level: 1,
          earnedAchievements: [],
          earnedBadges: [],
          streak: 0,
          lastActionAt: undefined,
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
