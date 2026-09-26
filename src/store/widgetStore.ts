import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface WidgetItem {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  order: number;
}

export const DEFAULT_WIDGET_ITEMS: WidgetItem[] = [
  { id: 'overview', title: 'MRR & ARR Overview', description: 'Key recurring revenue metrics', enabled: true, order: 0 },
  { id: 'revenueTrend', title: 'Historical Revenue Trend', description: '6-month MRR/ARR trajectory chart', enabled: true, order: 1 },
  { id: 'forecast', title: 'Revenue Forecasting', description: 'Predictive trajectory models', enabled: true, order: 2 },
  { id: 'cohortHeatmap', title: 'Cohort Retention Heatmap', description: 'Lifecycle retention curves', enabled: true, order: 3 },
  { id: 'churnBreakdown', title: 'Churn vs. Logo Breakdown', description: 'Revenue loss vs subscriber churn', enabled: true, order: 4 },
  { id: 'planMigrations', title: 'Plan Migrations Flow', description: 'Sankey diagram for plan changes', enabled: true, order: 5 },
];

export interface WidgetState {
  enabledWidgets: string[];
  widgetOrder: string[];
  forecastModel: 'exponential' | 'linear';
  toggleWidget: (id: string) => void;
  reorderWidgets: (newOrder: string[]) => void;
  setForecastModel: (model: 'exponential' | 'linear') => void;
  resetWidgetConfig: () => void;
}

const initialOrder = DEFAULT_WIDGET_ITEMS.map((w) => w.id);
const initialEnabled = DEFAULT_WIDGET_ITEMS.filter((w) => w.enabled).map((w) => w.id);

export const useWidgetStore = create<WidgetState>()(
  persist(
    (set, get) => ({
      enabledWidgets: initialEnabled,
      widgetOrder: initialOrder,
      forecastModel: 'exponential',

      toggleWidget: (id: string) => {
        const { enabledWidgets } = get();
        const next = enabledWidgets.includes(id)
          ? enabledWidgets.filter((w) => w !== id)
          : [...enabledWidgets, id];
        set({ enabledWidgets: next });
      },

      reorderWidgets: (newOrder: string[]) => {
        set({ widgetOrder: newOrder });
      },

      setForecastModel: (model) => {
        set({ forecastModel: model });
      },

      resetWidgetConfig: () => {
        set({
          enabledWidgets: initialEnabled,
          widgetOrder: initialOrder,
          forecastModel: 'exponential',
        });
      },
    }),
    {
      name: 'subtrackr-widget-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
