import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  beginCalendarOAuth,
  buildSubscriptionCalendarEvent,
  connectCalendar,
  createCalendarOAuthCallbackUrl,
  disconnectCalendar,
  normalizeReminderOffsets,
  parseCalendarOAuthCallback,
  syncToCalendar,
} from '../services/calendarService';
import type {
  CalendarIntegration,
  CalendarProvider,
  CalendarSyncedEvent,
  PendingCalendarAuthorization,
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
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        integrations: state.integrations,
        syncedEvents: state.syncedEvents,
        reminderOffsets: state.reminderOffsets,
      }),
    }
  )
);
