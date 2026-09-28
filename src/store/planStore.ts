import { create } from 'zustand';
import type {
  SubscriptionPlan,
  PlanComparison,
  PlanSwitchRequest,
  PlanSwitchResponse,
  PlanSwitchHistory,
  PlanAnalytics,
  BillingCycle,
  PlanTier,
} from '../types/plan';
import * as planService from '../services/planService';

interface PlanStore {
  plans: SubscriptionPlan[];
  comparison: PlanComparison | null;
  switchHistory: PlanSwitchHistory[];
  analytics: PlanAnalytics | null;
  isLoading: boolean;
  error: string | null;

  // Plan operations
  loadPlans: (billingCycle?: BillingCycle) => Promise<void>;
  getPlanById: (id: string) => SubscriptionPlan | undefined;
  getPlansByTier: (tier: PlanTier) => Promise<SubscriptionPlan[]>;

  // Comparison
  comparePlans: (planIds: string[]) => Promise<void>;
  clearComparison: () => void;

  // Plan switching
  switchPlan: (request: PlanSwitchRequest) => Promise<PlanSwitchResponse>;
  loadSwitchHistory: (userId?: string) => Promise<void>;

  // Analytics
  loadAnalytics: () => Promise<void>;

  // Utility
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  plans: [],
  comparison: null,
  switchHistory: [],
  analytics: null,
  isLoading: false,
  error: null,
};

export const usePlanStore = create<PlanStore>((set, get) => ({
  ...initialState,

  loadPlans: async (billingCycle?: BillingCycle) => {
    set({ isLoading: true, error: null });
    try {
      const plans = await planService.getAllPlans(billingCycle);
      set({ plans, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  getPlanById: (id: string) => {
    return get().plans.find(p => p.id === id);
  },

  getPlansByTier: async (tier: PlanTier) => {
    try {
      return await planService.getPlansByTier(tier);
    } catch (error) {
      set({ error: (error as Error).message });
      return [];
    }
  },

  comparePlans: async (planIds: string[]) => {
    set({ isLoading: true, error: null });
    try {
      const comparison = await planService.comparePlans(planIds);
      set({ comparison, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  clearComparison: () => {
    set({ comparison: null });
  },

  switchPlan: async (request: PlanSwitchRequest) => {
    set({ isLoading: true, error: null });
    try {
      const response = await planService.switchPlan(request);
      
      // Reload history
      await get().loadSwitchHistory(request.userId);
      
      set({ isLoading: false });
      return response;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  loadSwitchHistory: async (userId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const switchHistory = await planService.getSwitchHistory(userId);
      set({ switchHistory, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  loadAnalytics: async () => {
    set({ isLoading: true, error: null });
    try {
      const analytics = await planService.getPlanAnalytics();
      set({ analytics, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
  reset: () => set(initialState),
}));
