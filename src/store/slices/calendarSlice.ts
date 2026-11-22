/**
 * calendarSlice.ts — Calendar provider integrations, synced events,
 * one-time scheduled payments, and conflict detection.
 *
 * Issue #2045 — Collapse repeated Zustand stores into feature-scoped slices.
 *
 * Lifted from src/store/calendarStore.ts (standalone persisted store) into the
 * combined useAppStore. The legacy `useCalendarStore` hook in
 * app/stores/calendarStore.ts is now a thin adapter that re-exports useAppStore.
 *
 * Persisted fields (whitelisted in partialize):
 *   calendarIntegrations, calendarSyncedEvents, calendarReminderOffsets,
 *   calendarOneTimePayments, calendarTimezone.
 *
 * Ephemeral fields (excluded): calendarIsLoading, calendarError,
 *   calendarPendingAuthorizations, calendarScheduleConflicts.
 */

import { SliceCreator } from './types';
import type { AppState } from './state';
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
} from '../../services/calendarService';
import type {
  CalendarExportPayload,
  CalendarIntegration,
  CalendarProvider,
  CalendarSyncedEvent,
  OneTimeScheduledPayment,
  PendingCalendarAuthorization,
  ProratedAdjustment,
  ScheduleConflict,
} from '../../types/calendar';
import { REMINDER_PRESETS } from '../../types/calendar';
import type { Subscription } from '../../types/subscription';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type PendingAuthorizationMap = Partial<Record<CalendarProvider, PendingCalendarAuthorization>>;

export interface CalendarSlice {
  calendarIntegrations: CalendarIntegration[];
  calendarSyncedEvents: CalendarSyncedEvent[];
  calendarReminderOffsets: number[];
  /** Ephemeral OAuth sessions — not persisted. */
  calendarPendingAuthorizations: PendingAuthorizationMap;
  calendarIsLoading: boolean;
  calendarError: string | null;
  calendarOneTimePayments: OneTimeScheduledPayment[];
  calendarScheduleConflicts: ScheduleConflict[];
  calendarTimezone: string;

  beginCalendarConnection: (provider: CalendarProvider) => Promise<PendingCalendarAuthorization>;
  completeCalendarConnection: (
    provider: CalendarProvider,
    redirectUrl?: string
  ) => Promise<CalendarIntegration>;
  handleCalendarOAuthRedirect: (redirectUrl: string) => Promise<CalendarIntegration | null>;
  cancelCalendarConnection: (provider: CalendarProvider) => void;
  disconnectCalendarConnection: (connectionId: string) => Promise<void>;
  setCalendarReminderOffsets: (offsets: number[]) => void;
  toggleCalendarReminderOffset: (offset: number) => void;
  clearCalendarError: () => void;
  syncSubscriptionToCalendars: (subscription: Subscription) => Promise<void>;
  syncSubscriptions: (subscriptions: Subscription[]) => Promise<void>;
  removeSubscriptionFromCalendars: (subscriptionId: string) => Promise<void>;
  addCalendarOneTimePayment: (
    subscriptionId: string,
    amount: number,
    currency: string,
    scheduledDate: Date,
    description: string
  ) => void;
  cancelCalendarOneTimePayment: (paymentId: string) => void;
  getCalendarOneTimePayments: () => OneTimeScheduledPayment[];
  checkCalendarConflicts: (subscriptions: Subscription[]) => void;
  exportCalendar: (subscriptions: Subscription[], timezone?: string) => CalendarExportPayload;
  calculateProratedCharge: (
    subscription: Subscription,
    newDate: Date,
    reason: string
  ) => ProratedAdjustment;
  setCalendarTimezone: (timezone: string) => void;
}

export type CalendarStoreState = AppState & CalendarSlice;

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

function removePendingProvider(
  map: PendingAuthorizationMap,
  provider: CalendarProvider
): PendingAuthorizationMap {
  const next = { ...map };
  delete next[provider];
  return next;
}

function isConnected(integration: CalendarIntegration): boolean {
  return integration.status === 'connected';
}

function getPendingProviderByState(
  map: PendingAuthorizationMap,
  state: string
): CalendarProvider | null {
  const entry = Object.entries(map).find(([, auth]) => auth?.state === state);
  return entry ? (entry[0] as CalendarProvider) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Slice creator
// ─────────────────────────────────────────────────────────────────────────────

export const createCalendarSlice: SliceCreator<CalendarSlice> = (set, get) => ({
  calendarIntegrations: [],
  calendarSyncedEvents: [],
  calendarReminderOffsets: REMINDER_PRESETS[1].offsets,
  calendarPendingAuthorizations: {},
  calendarIsLoading: false,
  calendarError: null,
  calendarOneTimePayments: [],
  calendarScheduleConflicts: [],
  calendarTimezone: 'UTC',

  beginCalendarConnection: async (provider) => {
    set({ calendarIsLoading: true, calendarError: null });
    try {
      const authorization = beginCalendarOAuth(provider);
      set((state) => ({
        calendarPendingAuthorizations: {
          ...state.calendarPendingAuthorizations,
          [provider]: authorization,
        },
        calendarIsLoading: false,
      }));
      return authorization;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start calendar OAuth.';
      set({ calendarError: message, calendarIsLoading: false });
      throw err;
    }
  },

  completeCalendarConnection: async (provider, redirectUrl) => {
    const authorization = get().calendarPendingAuthorizations[provider];
    if (!authorization) throw new Error(`No pending OAuth session for ${provider}.`);

    set({ calendarIsLoading: true, calendarError: null });
    try {
      const callbackUrl = redirectUrl ?? createCalendarOAuthCallbackUrl(provider, authorization);
      const integration = await connectCalendar(provider, authorization, callbackUrl);
      const reminderOffsets = normalizeReminderOffsets(get().calendarReminderOffsets);
      set((state) => ({
        calendarIntegrations: [
          ...state.calendarIntegrations.filter((e) => e.provider !== provider),
          { ...integration, reminderOffsets },
        ],
        calendarPendingAuthorizations: removePendingProvider(
          state.calendarPendingAuthorizations,
          provider
        ),
        calendarIsLoading: false,
      }));
      return { ...integration, reminderOffsets };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect calendar.';
      set({ calendarError: message, calendarIsLoading: false });
      throw err;
    }
  },

  handleCalendarOAuthRedirect: async (redirectUrl) => {
    let callbackState: string;
    try {
      callbackState = parseCalendarOAuthCallback(redirectUrl).state;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse calendar callback.';
      set({ calendarError: message });
      throw err;
    }
    const provider = getPendingProviderByState(get().calendarPendingAuthorizations, callbackState);
    if (!provider) return null;
    return get().completeCalendarConnection(provider, redirectUrl);
  },

  cancelCalendarConnection: (provider) => {
    set((state) => ({
      calendarPendingAuthorizations: removePendingProvider(
        state.calendarPendingAuthorizations,
        provider
      ),
      calendarError: null,
      calendarIsLoading: false,
    }));
  },

  disconnectCalendarConnection: async (connectionId) => {
    set({ calendarIsLoading: true, calendarError: null });
    try {
      await disconnectCalendar(connectionId);
      set((state) => ({
        calendarIntegrations: state.calendarIntegrations.filter((i) => i.id !== connectionId),
        calendarSyncedEvents: state.calendarSyncedEvents.filter(
          (e) => e.connectionId !== connectionId
        ),
        calendarIsLoading: false,
      }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to disconnect calendar integration.';
      set({ calendarError: message, calendarIsLoading: false });
      throw err;
    }
  },

  setCalendarReminderOffsets: (offsets) => {
    const normalized = normalizeReminderOffsets(offsets);
    set((state) => ({
      calendarReminderOffsets: normalized,
      calendarIntegrations: state.calendarIntegrations.map((i) => ({
        ...i,
        reminderOffsets: normalized,
      })),
    }));
  },

  toggleCalendarReminderOffset: (offset) => {
    const current = get().calendarReminderOffsets;
    const next = current.includes(offset)
      ? current.filter((o) => o !== offset)
      : [...current, offset];
    get().setCalendarReminderOffsets(next);
  },

  clearCalendarError: () => set({ calendarError: null }),

  syncSubscriptionToCalendars: async (subscription) => {
    const { calendarIntegrations, calendarSyncedEvents } = get();
    const active = calendarIntegrations.filter(isConnected);
    if (active.length === 0) return;

    if (!subscription.isActive) {
      await get().removeSubscriptionFromCalendars(subscription.id);
      return;
    }

    const untouched = calendarSyncedEvents.filter((e) => e.subscriptionId !== subscription.id);
    const next: CalendarSyncedEvent[] = [...untouched];
    const syncTime = new Date().toISOString();

    for (const integration of active) {
      const template = buildSubscriptionCalendarEvent(subscription, integration.reminderOffsets);
      const upserted = await syncToCalendar(
        subscription.id,
        [template],
        integration,
        calendarSyncedEvents
      );
      next.push(...upserted);
    }

    set((state) => ({
      calendarSyncedEvents: next,
      calendarIntegrations: state.calendarIntegrations.map((i) =>
        active.some((a) => a.id === i.id)
          ? {
              ...i,
              lastSyncedAt: syncTime,
              reminderOffsets: normalizeReminderOffsets(i.reminderOffsets),
            }
          : i
      ),
    }));
  },

  syncSubscriptions: async (subscriptions) => {
    const activeIds = new Set(subscriptions.filter((s) => s.isActive).map((s) => s.id));
    set((state) => ({
      calendarSyncedEvents: state.calendarSyncedEvents.filter((e) =>
        activeIds.has(e.subscriptionId)
      ),
    }));
    for (const sub of subscriptions) {
      await get().syncSubscriptionToCalendars(sub);
    }
  },

  removeSubscriptionFromCalendars: async (subscriptionId) => {
    set((state) => ({
      calendarSyncedEvents: state.calendarSyncedEvents.filter(
        (e) => e.subscriptionId !== subscriptionId
      ),
    }));
  },

  addCalendarOneTimePayment: (subscriptionId, amount, currency, scheduledDate, description) => {
    const payment = scheduleOneTimePayment(
      subscriptionId,
      amount,
      currency,
      scheduledDate,
      description
    );
    set((state) => ({
      calendarOneTimePayments: [...state.calendarOneTimePayments, payment],
    }));
  },

  cancelCalendarOneTimePayment: (paymentId) => {
    set((state) => ({
      calendarOneTimePayments: state.calendarOneTimePayments.map((p) =>
        p.id === paymentId ? { ...p, status: 'cancelled' as const } : p
      ),
    }));
  },

  getCalendarOneTimePayments: () => get().calendarOneTimePayments,

  checkCalendarConflicts: (subscriptions) => {
    const conflicts = detectScheduleConflicts(subscriptions, get().calendarSyncedEvents);
    set({ calendarScheduleConflicts: conflicts });
  },

  exportCalendar: (subscriptions, timezone) => {
    const events = subscriptions
      .filter((s) => s.isActive)
      .map((s) => buildSubscriptionCalendarEvent(s, get().calendarReminderOffsets));
    return generateICalendarExport(events, timezone ?? get().calendarTimezone);
  },

  calculateProratedCharge: (subscription, newDate, reason) =>
    calculateProratedAdjustment(subscription, newDate, reason),

  setCalendarTimezone: (timezone) => set({ calendarTimezone: timezone }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Re-export types for callers that prefer to import from the slice
// ─────────────────────────────────────────────────────────────────────────────

export type {
  CalendarExportPayload,
  CalendarIntegration,
  CalendarProvider,
  CalendarSyncedEvent,
  OneTimeScheduledPayment,
  PendingCalendarAuthorization,
  ProratedAdjustment,
  ScheduleConflict,
};
export { REMINDER_PRESETS };
