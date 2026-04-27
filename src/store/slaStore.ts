import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  SlaAvailabilityEvent,
  SlaAvailabilityState,
  SlaBreach,
  SlaConfig,
  SlaDashboardReport,
  SlaStatus,
} from '../types/sla';
import {
  buildSlaDashboardReport,
  evaluateMerchantSnapshot,
  normalizeSlaConfig,
} from '../services/slaService';
import { presentSlaBreachNotification } from '../services/notificationService';
import { errorHandler, AppError } from '../services/errorHandler';

const STORAGE_KEY = 'subtrackr-sla';

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

interface TrackAvailabilityInput {
  durationSeconds: number;
  state: SlaAvailabilityState;
  note?: string;
  timestamp?: number;
}

interface SlaState {
  configs: Record<string, SlaConfig>;
  statuses: Record<string, SlaStatus>;
  availabilityEvents: SlaAvailabilityEvent[];
  breaches: SlaBreach[];
  report: SlaDashboardReport;
  isLoading: boolean;
  error: AppError | null;
  configureSla: (merchantId: string, config: Partial<SlaConfig>) => Promise<void>;
  trackServiceAvailability: (merchantId: string, input: TrackAvailabilityInput) => Promise<void>;
  detectSlaBreach: (merchantId: string) => Promise<SlaStatus | null>;
  acknowledgeBreach: (breachId: string) => Promise<void>;
  calculateCredit: (breachId: string) => number;
  getSlaStatus: (merchantId: string) => SlaStatus | null;
  refreshReport: () => void;
}

function buildEmptyReport(): SlaDashboardReport {
  return {
    summary: {
      totalMerchants: 0,
      compliantMerchants: 0,
      breachCount: 0,
      averageUptime: 100,
      totalCreditsIssued: 0,
      partialOutageEvents: 0,
      maintenanceEvents: 0,
    },
    configs: {},
    statuses: {},
    breaches: [],
    events: [],
  };
}

function updateMerchantState(state: SlaState, merchantId: string, now = Date.now()) {
  const config = state.configs[merchantId];
  if (!config) {
    return {
      statuses: state.statuses,
      breaches: state.breaches,
      createdBreach: null as SlaBreach | null,
      resolvedBreachId: null as string | null,
    };
  }

  const merchantEvents = state.availabilityEvents.filter(
    (event) => event.merchantId === merchantId
  );
  const merchantBreaches = state.breaches.filter((breach) => breach.merchantId === merchantId);
  const evaluation = evaluateMerchantSnapshot({
    config,
    events: merchantEvents,
    breaches: merchantBreaches,
    now,
  });

  const nextBreaches = state.breaches
    .filter((breach) => breach.merchantId !== merchantId)
    .concat(evaluation.breaches);

  return {
    statuses: {
      ...state.statuses,
      [merchantId]: evaluation.status,
    },
    breaches: nextBreaches,
    createdBreach: evaluation.createdBreach,
    resolvedBreachId: evaluation.resolvedBreachId,
  };
}

function rebuildReport(
  state: Pick<SlaState, 'configs' | 'statuses' | 'breaches' | 'availabilityEvents'>
): SlaDashboardReport {
  return buildSlaDashboardReport({
    configs: state.configs,
    statuses: state.statuses,
    breaches: state.breaches,
    events: state.availabilityEvents,
  });
}

export const useSlaStore = create<SlaState>()(
  persist(
    (set, get) => ({
      configs: {},
      statuses: {},
      availabilityEvents: [],
      breaches: [],
      report: buildEmptyReport(),
      isLoading: false,
      error: null,

      configureSla: async (merchantId, config) => {
        set({ isLoading: true, error: null });
        try {
          const normalized = normalizeSlaConfig(merchantId, config);
          set((state) => {
            const nextState: SlaState = {
              ...state,
              configs: {
                ...state.configs,
                [merchantId]: normalized,
              },
            };
            const evaluated = updateMerchantState(nextState, merchantId);
            return {
              configs: nextState.configs,
              statuses: evaluated.statuses,
              breaches: evaluated.breaches,
              report: rebuildReport({
                configs: nextState.configs,
                statuses: evaluated.statuses,
                breaches: evaluated.breaches,
                availabilityEvents: state.availabilityEvents,
              }),
              isLoading: false,
            };
          });
        } catch (error) {
          set({
            error: errorHandler.handleError(error as Error, {
              action: 'configureSla',
              metadata: { merchantId, config },
            }),
            isLoading: false,
          });
        }
      },

      trackServiceAvailability: async (merchantId, input) => {
        set({ isLoading: true, error: null });
        try {
          const event: SlaAvailabilityEvent = {
            id: generateId('sla-event'),
            merchantId,
            timestamp: input.timestamp ?? Date.now(),
            durationSeconds: Math.max(1, Math.floor(input.durationSeconds)),
            state: input.state,
            note: input.note,
          };

          let createdBreach: SlaBreach | null = null;

          set((state) => {
            const availabilityEvents = [...state.availabilityEvents, event];
            const nextState: SlaState = {
              ...state,
              availabilityEvents,
            };
            const evaluated = updateMerchantState(
              nextState,
              merchantId,
              event.timestamp + event.durationSeconds * 1000
            );
            createdBreach = evaluated.createdBreach;

            return {
              availabilityEvents,
              statuses: evaluated.statuses,
              breaches: evaluated.breaches,
              report: rebuildReport({
                configs: state.configs,
                statuses: evaluated.statuses,
                breaches: evaluated.breaches,
                availabilityEvents,
              }),
              isLoading: false,
            };
          });

          const breachToNotify = createdBreach as SlaBreach | null;
          if (breachToNotify) {
            const config = get().configs[merchantId];
            void presentSlaBreachNotification({
              merchantName: config?.merchantId ?? merchantId,
              uptimeTarget: breachToNotify.uptimeTarget,
              uptimePercentage: breachToNotify.uptimePercentage,
              creditAmount: breachToNotify.creditAmount,
            });
          }
        } catch (error) {
          set({
            error: errorHandler.handleError(error as Error, {
              action: 'trackServiceAvailability',
              metadata: { merchantId, input },
            }),
            isLoading: false,
          });
        }
      },

      detectSlaBreach: async (merchantId) => {
        const state = get();
        const config = state.configs[merchantId];
        if (!config) return null;

        const evaluated = updateMerchantState(state, merchantId);
        set({
          statuses: evaluated.statuses,
          breaches: evaluated.breaches,
          report: rebuildReport({
            configs: state.configs,
            statuses: evaluated.statuses,
            breaches: evaluated.breaches,
            availabilityEvents: state.availabilityEvents,
          }),
        });

        const nextStatus = evaluated.statuses[merchantId] ?? null;
        if (evaluated.createdBreach) {
          void presentSlaBreachNotification({
            merchantName: config.merchantId,
            uptimeTarget: evaluated.createdBreach.uptimeTarget,
            uptimePercentage: evaluated.createdBreach.uptimePercentage,
            creditAmount: evaluated.createdBreach.creditAmount,
          });
        }
        return nextStatus;
      },

      acknowledgeBreach: async (breachId) => {
        set({ isLoading: true, error: null });
        try {
          set((state) => {
            const breaches = state.breaches.map((breach) =>
              breach.id === breachId ? { ...breach, acknowledged: true } : breach
            );
            return {
              breaches,
              report: rebuildReport({
                configs: state.configs,
                statuses: state.statuses,
                breaches,
                availabilityEvents: state.availabilityEvents,
              }),
              isLoading: false,
            };
          });
        } catch (error) {
          set({
            error: errorHandler.handleError(error as Error, {
              action: 'acknowledgeBreach',
              metadata: { breachId },
            }),
            isLoading: false,
          });
        }
      },

      calculateCredit: (breachId) =>
        get().breaches.find((breach) => breach.id === breachId)?.creditAmount ?? 0,

      getSlaStatus: (merchantId) => get().statuses[merchantId] ?? null,

      refreshReport: () => {
        const state = get();
        set({
          report: rebuildReport(state),
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (state) => ({
        configs: state.configs,
        statuses: state.statuses,
        availabilityEvents: state.availabilityEvents,
        breaches: state.breaches,
      }),
    }
  )
);
