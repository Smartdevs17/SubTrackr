import { asyncStorageAdapter } from '../utils/storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  beginCalendarOAuth,
  buildSubscriptionCalendarEvent,
  calculateProratedAdjustment,
  connectCalendar,
  createCalendarOAuthCallbackUrl,
  detectScheduleConflicts,
  disconnectCalendar,
  generateICalendarExport,
  normalizeReminderOffsets,
  parseCalendarOAuthCallback,
  scheduleOneTimePayment,
  syncToCalendar,
} from '../services/calendarService';
import type {
  CalendarExportPayload,
  CalendarEventType,
  CalendarIntegration,
  CalendarProvider,
  CalendarSyncedEvent,
  CalendarSyncSettings,
  OneTimeScheduledPayment,
  PendingCalendarAuthorization,
  ProratedAdjustment,
  ScheduleConflict,
  SyncDirection,
} from '../types/calendar';
import { REMINDER_PRESETS } from '../types/calendar';
import type { Subscription } from '../types/subscription';

const STORAGE_KEY = 'subtrackr-calendar-integrations';

type PendingAuthorizationMap = Partial<Record<CalendarProvider, PendingCalendarAuthorization>>;

interface CalendarState {
  integrations: CalendarIntegration[];
  syncedEvents: CalendarSyncedEvent[];
  reminderOffsets: number[];
  pendingAuthorizations: PendingAuthorizationMap;
  isLoading: boolean;
  error: string | null;
  oneTimePayments: OneTimeScheduledPayment[];
  scheduleConflicts: ScheduleConflict[];
  timezone: string;
  beginConnection: (provider: CalendarProvider) => Promise<PendingCalendarAuthorization>;
  completeConnection: (
    provider: CalendarProvider,
    redirectUrl?: string
  ) => Promise<CalendarIntegration>;
  handleOAuthRedirect: (redirectUrl: string) => Promise<CalendarIntegration | null>;
  cancelConnection: (provider: CalendarProvider) => void;
  disconnectConnection: (connectionId: string) => Promise<void>;
  setReminderOffsets: (offsets: number[]) => void;
  toggleReminderOffset: (offset: number) => void;
  clearError: () => void;
  syncSubscriptionToCalendars: (subscription: Subscription) => Promise<void>;
  syncSubscriptions: (subscriptions: Subscription[]) => Promise<void>;
  removeSubscriptionFromCalendars: (subscriptionId: string) => Promise<void>;
  addOneTimePayment: (
    subscriptionId: string,
    amount: number,
    currency: string,
    scheduledDate: Date,
    description: string
  ) => void;
  cancelOneTimePayment: (paymentId: string) => void;
  getOneTimePayments: () => OneTimeScheduledPayment[];
  checkConflicts: (subscriptions: Subscription[]) => void;
  exportCalendar: (subscriptions: Subscription[], timezone?: string) => CalendarExportPayload;
  calculateProratedCharge: (
    subscription: Subscription,
    newDate: Date,
    reason: string
  ) => ProratedAdjustment;
  setTimezone: (timezone: string) => void;
  setSyncDirection: (connectionId: string, direction: SyncDirection) => void;
  toggleEventType: (connectionId: string, eventType: CalendarEventType) => void;
  setEnabledEventTypes: (connectionId: string, eventTypes: CalendarEventType[]) => void;
  triggerBidirectionalSync: (subscription: Subscription) => Promise<void>;
  getSyncSettings: (connectionId: string) => CalendarSyncSettings | undefined;
}

function removeProviderPendingState(
  pendingAuthorizations: PendingAuthorizationMap,
  provider: CalendarProvider
): PendingAuthorizationMap {
  const next = { ...pendingAuthorizations };
  delete next[provider];
  return next;
}

function isConnected(integration: CalendarIntegration): boolean {
  return integration.status === 'connected';
}

function getPendingProviderByState(
  pendingAuthorizations: PendingAuthorizationMap,
  state: string
): CalendarProvider | null {
  const provider = Object.entries(pendingAuthorizations).find(
    ([, authorization]) => authorization?.state === state
  )?.[0];
  return (provider as CalendarProvider | undefined) ?? null;
}

export const useCalendarStore = create<CalendarState>()(
  persist(
    (set, get) => ({
      integrations: [],
      syncedEvents: [],
      reminderOffsets: REMINDER_PRESETS[1].offsets,
      pendingAuthorizations: {},
      isLoading: false,
      error: null,
      oneTimePayments: [],
      scheduleConflicts: [],
      timezone: 'UTC',

      beginConnection: async (provider) => {
        set({ isLoading: true, error: null });

        try {
          const authorization = beginCalendarOAuth(provider);
          set((state) => ({
            pendingAuthorizations: {
              ...state.pendingAuthorizations,
              [provider]: authorization,
            },
            isLoading: false,
          }));
          return authorization;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to start calendar OAuth.';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      completeConnection: async (provider, redirectUrl) => {
        const authorization = get().pendingAuthorizations[provider];
        if (!authorization) {
          throw new Error(`No pending OAuth session for ${provider}.`);
        }

        set({ isLoading: true, error: null });

        try {
          const callbackUrl =
            redirectUrl ?? createCalendarOAuthCallbackUrl(provider, authorization);
          const integration = await connectCalendar(provider, authorization, callbackUrl);
          const reminderOffsets = normalizeReminderOffsets(get().reminderOffsets);
          set((state) => ({
            integrations: [
              ...state.integrations.filter((entry) => entry.provider !== provider),
              { ...integration, reminderOffsets },
            ],
            pendingAuthorizations: removeProviderPendingState(
              state.pendingAuthorizations,
              provider
            ),
            isLoading: false,
          }));
          return { ...integration, reminderOffsets };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to connect calendar.';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      handleOAuthRedirect: async (redirectUrl) => {
        let callbackState: string;

        try {
          callbackState = parseCalendarOAuthCallback(redirectUrl).state;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to parse calendar callback.';
          set({ error: message });
          throw error;
        }

        const provider = getPendingProviderByState(get().pendingAuthorizations, callbackState);
        if (!provider) return null;

        return get().completeConnection(provider, redirectUrl);
      },

      cancelConnection: (provider) => {
        set((state) => ({
          pendingAuthorizations: removeProviderPendingState(state.pendingAuthorizations, provider),
          error: null,
          isLoading: false,
        }));
      },

      disconnectConnection: async (connectionId) => {
        set({ isLoading: true, error: null });
        try {
          await disconnectCalendar(connectionId);
          set((state) => ({
            integrations: state.integrations.filter(
              (integration) => integration.id !== connectionId
            ),
            syncedEvents: state.syncedEvents.filter((event) => event.connectionId !== connectionId),
            isLoading: false,
          }));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to disconnect calendar integration.';
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      setReminderOffsets: (offsets) => {
        const normalized = normalizeReminderOffsets(offsets);
        set((state) => ({
          reminderOffsets: normalized,
          integrations: state.integrations.map((integration) => ({
            ...integration,
            reminderOffsets: normalized,
          })),
        }));
      },

      toggleReminderOffset: (offset) => {
        const currentOffsets = get().reminderOffsets;
        const nextOffsets = currentOffsets.includes(offset)
          ? currentOffsets.filter((entry) => entry !== offset)
          : [...currentOffsets, offset];

        get().setReminderOffsets(nextOffsets);
      },

      clearError: () => {
        set({ error: null });
      },

      addOneTimePayment: (subscriptionId, amount, currency, scheduledDate, description) => {
        const payment = scheduleOneTimePayment(
          subscriptionId,
          amount,
          currency,
          scheduledDate,
          description
        );
        set((state) => ({
          oneTimePayments: [...state.oneTimePayments, payment],
        }));
      },

      cancelOneTimePayment: (paymentId) => {
        set((state) => ({
          oneTimePayments: state.oneTimePayments.map((p) =>
            p.id === paymentId ? { ...p, status: 'cancelled' as const } : p
          ),
        }));
      },

      getOneTimePayments: () => get().oneTimePayments,

      checkConflicts: (subscriptions) => {
        const conflicts = detectScheduleConflicts(subscriptions, get().syncedEvents);
        set({ scheduleConflicts: conflicts });
      },

      exportCalendar: (subscriptions, timezone) => {
        const events = subscriptions
          .filter((s) => s.isActive)
          .map((s) => buildSubscriptionCalendarEvent(s, get().reminderOffsets));
        return generateICalendarExport(events, timezone || get().timezone);
      },

      calculateProratedCharge: (subscription, newDate, reason) => {
        return calculateProratedAdjustment(subscription, newDate, reason);
      },

      setTimezone: (timezone) => {
        set({ timezone });
      },

      setSyncDirection: (connectionId, direction) => {
        set((state) => ({
          integrations: state.integrations.map((integration) => {
            if (integration.id !== connectionId) return integration;
            const syncSettings: CalendarSyncSettings = {
              ...(integration.syncSettings ?? {
                syncDirection: 'bidirectional',
                enabledEventTypes: ['payment_due', 'renewal', 'trial_ending'],
                syncMethod: 'webhook' as const,
              }),
              syncDirection: direction,
            };
            return { ...integration, syncSettings };
          }),
        }));
      },

      toggleEventType: (connectionId, eventType) => {
        set((state) => ({
          integrations: state.integrations.map((integration) => {
            if (integration.id !== connectionId) return integration;
            const current = integration.syncSettings?.enabledEventTypes ?? [
              'payment_due',
              'renewal',
              'trial_ending',
            ];
            const updated = current.includes(eventType)
              ? current.filter((t) => t !== eventType)
              : [...current, eventType];
            const syncSettings: CalendarSyncSettings = {
              ...(integration.syncSettings ?? {
                syncDirection: 'bidirectional' as SyncDirection,
                enabledEventTypes: current,
                syncMethod: 'webhook' as const,
              }),
              enabledEventTypes: updated,
            };
            return { ...integration, syncSettings };
          }),
        }));
      },

      setEnabledEventTypes: (connectionId, eventTypes) => {
        set((state) => ({
          integrations: state.integrations.map((integration) => {
            if (integration.id !== connectionId) return integration;
            const syncSettings: CalendarSyncSettings = {
              ...(integration.syncSettings ?? {
                syncDirection: 'bidirectional' as SyncDirection,
                enabledEventTypes: [],
                syncMethod: 'webhook' as const,
              }),
              enabledEventTypes: eventTypes,
            };
            return { ...integration, syncSettings };
          }),
        }));
      },

      triggerBidirectionalSync: async (subscription) => {
        const { integrations, syncedEvents } = get();
        const activeIntegrations = integrations.filter(isConnected);
        if (activeIntegrations.length === 0) return;

        const untouchedEvents = syncedEvents.filter(
          (event) => event.subscriptionId !== subscription.id
        );
        const nextSyncedEvents: CalendarSyncedEvent[] = [...untouchedEvents];
        const syncTime = new Date().toISOString();

        for (const integration of activeIntegrations) {
          const direction = integration.syncSettings?.syncDirection ?? 'bidirectional';
          if (direction === 'from_calendar') continue;

          const template = buildSubscriptionCalendarEvent(
            subscription,
            integration.reminderOffsets
          );
          const upserted = await syncToCalendar(
            subscription.id,
            [template],
            integration,
            syncedEvents
          );
          nextSyncedEvents.push(...upserted);
        }

        set((state) => ({
          syncedEvents: nextSyncedEvents,
          integrations: state.integrations.map((integration) => {
            const wasActive = activeIntegrations.some((entry) => entry.id === integration.id);
            if (!wasActive) return integration;
            return {
              ...integration,
              lastSyncedAt: syncTime,
              syncSettings: integration.syncSettings
                ? {
                    ...integration.syncSettings,
                    lastSyncResult: {
                      syncedAt: syncTime,
                      pushed: nextSyncedEvents.length - untouchedEvents.length,
                      pulled: 0,
                      conflicts: 0,
                      errors: 0,
                    },
                  }
                : undefined,
            };
          }),
        }));
      },

      getSyncSettings: (connectionId) => {
        const integration = get().integrations.find((i) => i.id === connectionId);
        return integration?.syncSettings;
      },

      syncSubscriptionToCalendars: async (subscription) => {
        const { integrations, syncedEvents } = get();
        const activeIntegrations = integrations.filter(isConnected);
        if (activeIntegrations.length === 0) return;

        if (!subscription.isActive) {
          await get().removeSubscriptionFromCalendars(subscription.id);
          return;
        }

        const untouchedEvents = syncedEvents.filter(
          (event) => event.subscriptionId !== subscription.id
        );
        const nextSyncedEvents: CalendarSyncedEvent[] = [...untouchedEvents];
        const syncTime = new Date().toISOString();

        for (const integration of activeIntegrations) {
          const template = buildSubscriptionCalendarEvent(
            subscription,
            integration.reminderOffsets
          );
          const upserted = await syncToCalendar(
            subscription.id,
            [template],
            integration,
            syncedEvents
          );
          nextSyncedEvents.push(...upserted);
        }

        set((state) => ({
          syncedEvents: nextSyncedEvents,
          integrations: state.integrations.map((integration) =>
            activeIntegrations.some((entry) => entry.id === integration.id)
              ? {
                  ...integration,
                  lastSyncedAt: syncTime,
                  reminderOffsets: normalizeReminderOffsets(integration.reminderOffsets),
                }
              : integration
          ),
        }));
      },

      syncSubscriptions: async (subscriptions) => {
        const activeSubscriptionIds = new Set(
          subscriptions
            .filter((subscription) => subscription.isActive)
            .map((subscription) => subscription.id)
        );

        set((state) => ({
          syncedEvents: state.syncedEvents.filter((event) =>
            activeSubscriptionIds.has(event.subscriptionId)
          ),
        }));

        for (const subscription of subscriptions) {
          await get().syncSubscriptionToCalendars(subscription);
        }
      },

      removeSubscriptionFromCalendars: async (subscriptionId) => {
        set((state) => ({
          syncedEvents: state.syncedEvents.filter(
            (event) => event.subscriptionId !== subscriptionId
          ),
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        integrations: state.integrations,
        syncedEvents: state.syncedEvents,
        reminderOffsets: state.reminderOffsets,
        oneTimePayments: state.oneTimePayments,
        timezone: state.timezone,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[calendarStore] Hydration error — resetting to defaults:', error);
          useCalendarStore.setState({
            integrations: [],
            syncedEvents: [],
            oneTimePayments: [],
            scheduleConflicts: [],
            isLoading: false,
            error: null,
          });
        }
      },
    }
  )
);
