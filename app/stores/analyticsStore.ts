import { create } from 'zustand';
import {
  calculateSubscriptionAnalytics,
  SubscriptionAnalyticsReport,
} from '../../src/services/analyticsService';
import { Subscription } from '../../src/types/subscription';
import { generateCSV } from '../../src/utils/importExport';

interface AnalyticsStoreState {
  report: SubscriptionAnalyticsReport | null;
  compute: (subscriptions: Subscription[]) => void;
  exportCSV: (subscriptions: Subscription[]) => string;
}

export const useAnalyticsStore = create<AnalyticsStoreState>()((set) => ({
  report: null,

  compute: (subscriptions) => {
    const report = calculateSubscriptionAnalytics(subscriptions);
    set({ report });
  },

  exportCSV: (subscriptions) => {
    return generateCSV(subscriptions);
  },
}));
