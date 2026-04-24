import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Segment, SegmentRule, SegmentPricingRule } from '../types/segment';
import { segmentService } from '../services/segmentService';
import { useSubscriptionStore } from './subscriptionStore';
import { useUserStore } from './userStore';
import { useGamificationStore } from './gamificationStore';
import { AchievementTrigger } from '../types/gamification';

interface SegmentState {
  segments: Segment[];
  isLoading: boolean;
  error: string | null;

  // Actions
  addSegment: (segment: Omit<Segment, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateSegment: (id: string, segment: Partial<Segment>) => void;
  deleteSegment: (id: string) => void;
  getSegmentsForUser: () => Segment[];
  getSegmentStats: (id: string) => any;
}

const STORAGE_KEY = 'subtrackr-segments';

export const useSegmentStore = create<SegmentState>()(
  persist(
    (set, get) => ({
      segments: [],
      isLoading: false,
      error: null,

      addSegment: (data) => {
        const newSegment: Segment = {
          ...data,
          id: `seg-${Date.now()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        set((state) => ({
          segments: [...state.segments, newSegment],
        }));

        // Gamification Triggers
        const gamificationStore = useGamificationStore.getState();
        gamificationStore.addPoints(25); // 25 points for creating a segment
        gamificationStore.checkAchievements(AchievementTrigger.SEGMENT_CREATED, {});
      },

      updateSegment: (id, data) => {
        set((state) => ({
          segments: state.segments.map((seg) =>
            seg.id === id ? { ...seg, ...data, updatedAt: new Date() } : seg
          ),
        }));
      },

      deleteSegment: (id) => {
        set((state) => ({
          segments: state.segments.filter((seg) => seg.id !== id),
        }));
      },

      getSegmentsForUser: () => {
        const { subscriptions } = useSubscriptionStore.getState();
        const { user } = useUserStore.getState();
        
        if (!user) return [];
        
        const subscriberData = segmentService.mapSubscriberData(user, subscriptions);
        return get().segments.filter((seg) => 
          segmentService.isSubscriberInSegment(subscriberData, seg)
        );
      },

      getSegmentStats: (id) => {
        // This is a mock implementation as we don't have multiple users' data in the local store
        // In a real merchant app, this would query a backend
        const segment = get().segments.find((s) => s.id === id);
        if (!segment) return null;

        const { subscriptions } = useSubscriptionStore.getState();
        const { user } = useUserStore.getState();
        if (!user) return null;

        const subscriberData = segmentService.mapSubscriberData(user, subscriptions);
        const isInSegment = segmentService.isSubscriberInSegment(subscriberData, segment);

        return {
          subscriberCount: isInSegment ? 1 : 0,
          totalMonthlyValue: isInSegment ? subscriberData.totalMonthlySpend : 0,
          averageValuePerSubscriber: isInSegment ? subscriberData.totalMonthlySpend : 0,
        };
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
