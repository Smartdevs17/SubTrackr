/**
 * Issue #776 – Zustand store wrapping the plan comparison engine.
 */

import { create } from 'zustand';
import type {
  ComparablePlan,
  CompareOptions,
  ComparisonAnalytics,
  ComparisonShare,
  PlanComparisonResult,
  PlanRecommendation,
  PreferenceProfile,
  RecommendationTrackingEvent,
} from '../types/planComparison';
import {
  PlanRecommendationTracker,
  compareAndTrack,
  recommendAndTrack,
  resolveComparisonShare,
} from '../services/planComparisonEngine';

interface PlanComparisonState {
  selectedPlans: ComparablePlan[];
  comparison: PlanComparisonResult | null;
  recommendations: PlanRecommendation[];
  preferenceProfile: PreferenceProfile;
  analytics: ComparisonAnalytics | null;
  lastShare: ComparisonShare | null;
  isLoading: boolean;
  error: string | null;

  setSelectedPlans: (plans: ComparablePlan[]) => void;
  addPlan: (plan: ComparablePlan) => void;
  removePlan: (planId: string) => void;
  clearSelection: () => void;
  setPreferenceProfile: (profile: Partial<PreferenceProfile>) => void;
  runComparison: (options?: CompareOptions) => PlanComparisonResult | null;
  runRecommendation: (profile?: PreferenceProfile) => PlanRecommendation[];
  trackEvent: (
    event: Omit<RecommendationTrackingEvent, 'id' | 'occurredAt'> & {
      id?: string;
      occurredAt?: number;
    }
  ) => RecommendationTrackingEvent;
  refreshAnalytics: () => ComparisonAnalytics;
  shareComparison: (ttlMs?: number) => ComparisonShare | null;
  loadShare: (token: string) => ComparisonShare | null;
  reset: () => void;
}

const tracker = new PlanRecommendationTracker();

const defaultProfile: PreferenceProfile = {
  prioritizeValue: true,
  maxResults: 3,
};

export const usePlanComparisonStore = create<PlanComparisonState>((set, get) => ({
  selectedPlans: [],
  comparison: null,
  recommendations: [],
  preferenceProfile: { ...defaultProfile },
  analytics: null,
  lastShare: null,
  isLoading: false,
  error: null,

  setSelectedPlans: (plans) => set({ selectedPlans: plans, error: null }),

  addPlan: (plan) => {
    const { selectedPlans } = get();
    if (selectedPlans.some((p) => p.id === plan.id)) return;
    set({ selectedPlans: [...selectedPlans, plan], error: null });
  },

  removePlan: (planId) => {
    set({
      selectedPlans: get().selectedPlans.filter((p) => p.id !== planId),
      error: null,
    });
  },

  clearSelection: () =>
    set({
      selectedPlans: [],
      comparison: null,
      recommendations: [],
      lastShare: null,
      error: null,
    }),

  setPreferenceProfile: (profile) =>
    set({
      preferenceProfile: { ...get().preferenceProfile, ...profile },
    }),

  runComparison: (options) => {
    const { selectedPlans } = get();
    set({ isLoading: true, error: null });
    try {
      const comparison = compareAndTrack(selectedPlans, options, tracker);
      set({ comparison, isLoading: false, analytics: tracker.getAnalytics() });
      return comparison;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Comparison failed';
      set({ isLoading: false, error: message });
      return null;
    }
  },

  runRecommendation: (profile) => {
    const { selectedPlans, preferenceProfile } = get();
    const merged = { ...preferenceProfile, ...profile };
    set({ isLoading: true, error: null, preferenceProfile: merged });
    try {
      const recommendations = recommendAndTrack(selectedPlans, merged, tracker);
      set({
        recommendations,
        isLoading: false,
        analytics: tracker.getAnalytics(),
      });
      return recommendations;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Recommendation failed';
      set({ isLoading: false, error: message, recommendations: [] });
      return [];
    }
  },

  trackEvent: (event) => {
    const stored = tracker.track(event);
    set({ analytics: tracker.getAnalytics() });
    return stored;
  },

  refreshAnalytics: () => {
    const analytics = tracker.getAnalytics();
    set({ analytics });
    return analytics;
  },

  shareComparison: (ttlMs) => {
    const { comparison } = get();
    if (!comparison) {
      set({ error: 'No comparison to share' });
      return null;
    }
    const share = tracker.createShare(
      comparison.id,
      comparison.plans.map((p) => p.id),
      comparison,
      ttlMs
    );
    tracker.track({
      recommendationId: comparison.id,
      planId: comparison.plans.map((p) => p.id).join(','),
      eventType: 'share',
      comparisonId: comparison.id,
    });
    set({ lastShare: share, analytics: tracker.getAnalytics() });
    return share;
  },

  loadShare: (token) => {
    const share = resolveComparisonShare(token, tracker);
    if (!share) {
      set({ error: 'Share token not found or expired' });
      return null;
    }
    if (share.payload) {
      set({
        comparison: share.payload,
        selectedPlans: share.payload.plans,
        lastShare: share,
        error: null,
      });
    } else {
      set({ lastShare: share, error: null });
    }
    return share;
  },

  reset: () => {
    tracker.reset();
    set({
      selectedPlans: [],
      comparison: null,
      recommendations: [],
      preferenceProfile: { ...defaultProfile },
      analytics: null,
      lastShare: null,
      isLoading: false,
      error: null,
    });
  },
}));
