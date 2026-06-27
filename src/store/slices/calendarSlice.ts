/**
 * Calendar Slice – calendar integration and sync.
 */
import type { StateCreator } from 'zustand';
import { CalendarIntegration, CalendarProvider, CalendarSyncedEvent, OneTimeScheduledPayment, PendingCalendarAuthorization, ProratedAdjustment, ScheduleConflict, REMINDER_PRESETS, CalendarExportPayload } from '../../types/calendar';
import { Subscription } from '../../types/subscription';

// ── Interface ───────────────────────────────────────────────────────────

export interface CalendarSlice {
  calendarIntegrations: CalendarIntegration[];
  syncedEvents: CalendarSyncedEvent[];
  reminderOffsets: number[];
  pendingAuthorizations: Record<string, PendingCalendarAuthorization | undefined>;
  calendarLoading: boolean;
  calendarError: string | null;
  oneTimePayments: OneTimeScheduledPayment[];
  scheduleConflicts: ScheduleConflict[];
  calendarTimezone: string;
  beginConnection: (provider: CalendarProvider) => Promise<PendingCalendarAuthorization>;
  completeConnection: (provider: CalendarProvider, redirectUrl?: string) => Promise<CalendarIntegration>;
  handleOAuthRedirect: (redirectUrl: string) => Promise<CalendarIntegration | null>;
  cancelConnection: (provider: CalendarProvider) => void;
  disconnectConnection: (connectionId: string) => Promise<void>;
  setReminderOffsets: (offsets: number[]) => void;
  toggleReminderOffset: (offset: number) => void;
  clearCalendarError: () => void;
  syncSubscriptionToCalendars: (subscription: Subscription) => Promise<void>;
  syncSubscriptionsToCalendars: (subscriptions: Subscription[]) => Promise<void>;
  removeSubscriptionFromCalendars: (subscriptionId: string) => Promise<void>;
  addOneTimePayment: (subscriptionId: string, amount: number, currency: string, scheduledDate: Date, description: string) => void;
  cancelOneTimePayment: (paymentId: string) => void;
  getOneTimePayments: () => OneTimeScheduledPayment[];
  checkCalendarConflicts: (subscriptions: Subscription[]) => void;
  exportCalendar: (subscriptions: Subscription[], timezone?: string) => CalendarExportPayload;
  calculateProratedCharge: (subscription: Subscription, newDate: Date, reason: string) => ProratedAdjustment;
  setCalendarTimezone: (timezone: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const removeProviderPendingState = (pending: Record<string, PendingCalendarAuthorization | undefined>, provider: string) => {
  const next = { ...pending };
  delete next[provider];
  return next;
};

type CalendarStore = CalendarSlice;
type CalendarCreator = StateCreator<CalendarStore & any, [], [], CalendarStore>;

// ═══════════════════════════════════════════════════════════════════════════
// Slice Factory
// ═══════════════════════════════════════════════════════════════════════════

export const createCalendarSlice: CalendarCreator = (set, get) => ({
  calendarIntegrations: [],
  syncedEvents: [],
  reminderOffsets: REMINDER_PRESETS[1]?.offsets ?? [0],
  pendingAuthorizations: {},
  calendarLoading: false,
  calendarError: null,
  oneTimePayments: [],
  scheduleConflicts: [],
  calendarTimezone: 'UTC',

  beginConnection: async (provider) => {
    set({ calendarLoading: true, calendarError: null });
    try {
      const authorization: PendingCalendarAuthorization = { provider, state: `state_${Date.now()}`, codeVerifier: 'mock', redirectUri: 'mock://callback', expiresAt: Date.now() + 3600000 };
      set((s) => ({ pendingAuthorizations: { ...s.pendingAuthorizations, [provider]: authorization }, calendarLoading: false }));
      return authorization;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start OAuth.';
      set({ calendarError: message, calendarLoading: false });
      throw error;
    }
  },

  completeConnection: async (provider, _redirectUrl) => {
    const authorization = get().pendingAuthorizations[provider];
    if (!authorization) throw new Error(`No pending OAuth session for ${provider}.`);
    set({ calendarLoading: true, calendarError: null });
    try {
      const integration: CalendarIntegration = { id: `cal-${Date.now()}`, provider, status: 'connected', connectedAt: new Date(), lastSyncedAt: new Date(), reminderOffsets: get().reminderOffsets, calendarId: `${provider}-default`, accountName: `${provider} Calendar`, expiresAt: null } as CalendarIntegration;
      set((s) => ({ calendarIntegrations: [...s.calendarIntegrations.filter((i) => i.provider !== provider), integration], pendingAuthorizations: removeProviderPendingState(s.pendingAuthorizations, provider), calendarLoading: false }));
      return integration;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect calendar.';
      set({ calendarError: message, calendarLoading: false });
      throw error;
    }
  },

  handleOAuthRedirect: async (_redirectUrl) => null,
  cancelConnection: (provider) => set((s) => ({ pendingAuthorizations: removeProviderPendingState(s.pendingAuthorizations, provider), calendarError: null, calendarLoading: false })),

  disconnectConnection: async (connectionId) => {
    set({ calendarLoading: true, calendarError: null });
    try {
      set((s) => ({ calendarIntegrations: s.calendarIntegrations.filter((i) => i.id !== connectionId), syncedEvents: s.syncedEvents.filter((e) => e.connectionId !== connectionId), calendarLoading: false }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disconnect.';
      set({ calendarError: message, calendarLoading: false });
    }
  },

  setReminderOffsets: (offsets) => set({ reminderOffsets: offsets }),
  toggleReminderOffset: (offset) => {
    const current = get().reminderOffsets;
    const next = current.includes(offset) ? current.filter((o) => o !== offset) : [...current, offset];
    set({ reminderOffsets: next });
  },
  clearCalendarError: () => set({ calendarError: null }),

  addOneTimePayment: (subscriptionId, amount, currency, scheduledDate, description) => {
    const payment: OneTimeScheduledPayment = { id: `otp-${Date.now()}`, subscriptionId, amount, currency, scheduledDate, description, status: 'scheduled' };
    set((s) => ({ oneTimePayments: [...s.oneTimePayments, payment] }));
  },

  cancelOneTimePayment: (paymentId) => set((s) => ({ oneTimePayments: s.oneTimePayments.map((p) => p.id === paymentId ? { ...p, status: 'cancelled' as const } : p) })),
  getOneTimePayments: () => get().oneTimePayments,

  checkCalendarConflicts: (_subscriptions) => { set({ scheduleConflicts: [] }); },

  exportCalendar: (_subscriptions, _timezone) => ({ events: [], timezone: _timezone || get().calendarTimezone, exportFormat: 'ical' } as CalendarExportPayload),

  calculateProratedCharge: (_subscription, _newDate, _reason) => ({ amount: 0, daysRemaining: 0, description: '' } as ProratedAdjustment),
  setCalendarTimezone: (timezone) => set({ calendarTimezone: timezone }),

  syncSubscriptionToCalendars: async (_subscription) => {},
  syncSubscriptionsToCalendars: async (_subscriptions) => {},
  removeSubscriptionFromCalendars: async (_subscriptionId) => {},
});
