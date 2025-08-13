import { create } from 'zustand';
import { Subscription, SubscriptionFormData, SubscriptionStats, SubscriptionCategory } from '../types/subscription';
import { dummySubscriptions } from '../utils/dummyData';

interface SubscriptionState {
  subscriptions: Subscription[];
  stats: SubscriptionStats;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  addSubscription: (data: SubscriptionFormData) => Promise<void>;
  updateSubscription: (id: string, data: Partial<Subscription>) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  toggleSubscriptionStatus: (id: string) => Promise<void>;
  fetchSubscriptions: () => Promise<void>;
  calculateStats: () => void;
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  subscriptions: dummySubscriptions, // Initialize with dummy data
  stats: {
    totalActive: 0,
    totalMonthlySpend: 0,
    totalYearlySpend: 0,
    categoryBreakdown: {} as Record<string, number>,
  },
  isLoading: false,
  error: null,

  addSubscription: async (data: SubscriptionFormData) => {
    set({ isLoading: true, error: null });
    try {
      const newSubscription: Subscription = {
        id: Date.now().toString(),
        ...data,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      set((state) => ({
        subscriptions: [...state.subscriptions, newSubscription],
        isLoading: false,
      }));
      
      get().calculateStats();
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to add subscription',
        isLoading: false 
      });
    }
  },

  updateSubscription: async (id: string, data: Partial<Subscription>) => {
    set({ isLoading: true, error: null });
    try {
      set((state) => ({
        subscriptions: state.subscriptions.map((sub) =>
          sub.id === id
            ? { ...sub, ...data, updatedAt: new Date() }
            : sub
        ),
        isLoading: false,
      }));
      
      get().calculateStats();
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to update subscription',
        isLoading: false 
      });
    }
  },

  deleteSubscription: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      set((state) => ({
        subscriptions: state.subscriptions.filter((sub) => sub.id !== id),
        isLoading: false,
      }));
      
      get().calculateStats();
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to delete subscription',
        isLoading: false 
      });
    }
  },

  toggleSubscriptionStatus: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      set((state) => ({
        subscriptions: state.subscriptions.map((sub) =>
          sub.id === id
            ? { ...sub, isActive: !sub.isActive, updatedAt: new Date() }
            : sub
        ),
        isLoading: false,
      }));
      
      get().calculateStats();
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to toggle subscription',
        isLoading: false 
      });
    }
  },

  fetchSubscriptions: async () => {
    set({ isLoading: true, error: null });
    try {
      // TODO: Implement API call
      // For now, just simulate loading
      await new Promise(resolve => setTimeout(resolve, 1000));
      set({ isLoading: false });
      get().calculateStats();
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch subscriptions',
        isLoading: false 
      });
    }
  },

  calculateStats: () => {
    const { subscriptions } = get();
    
    // Safety check: ensure subscriptions is an array
    if (!subscriptions || !Array.isArray(subscriptions)) {
      set({
        stats: {
          totalActive: 0,
          totalMonthlySpend: 0,
          totalYearlySpend: 0,
          categoryBreakdown: {} as Record<SubscriptionCategory, number>,
        },
      });
      return;
    }
    
    const activeSubs = subscriptions.filter(sub => sub.isActive);
    
    const totalMonthlySpend = activeSubs.reduce((total, sub) => {
      if (sub.billingCycle === 'monthly') return total + sub.price;
      if (sub.billingCycle === 'yearly') return total + (sub.price / 12);
      if (sub.billingCycle === 'weekly') return total + (sub.price * 4);
      return total + sub.price;
    }, 0);

    const totalYearlySpend = activeSubs.reduce((total, sub) => {
      if (sub.billingCycle === 'yearly') return total + sub.price;
      if (sub.billingCycle === 'monthly') return total + (sub.price * 12);
      if (sub.billingCycle === 'weekly') return total + (sub.price * 52);
      return total + (sub.price * 12);
    }, 0);

    const categoryBreakdown = activeSubs.reduce((acc, sub) => {
      acc[sub.category] = (acc[sub.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    set({
      stats: {
        totalActive: activeSubs.length,
        totalMonthlySpend,
        totalYearlySpend,
        categoryBreakdown,
      },
    });
  },
}));
