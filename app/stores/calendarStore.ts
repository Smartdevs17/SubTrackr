/**
 * calendarStore.ts — Legacy adapter for the calendar slice.
 *
 * Issue #2045 — Collapse repeated Zustand stores into feature-scoped slices.
 *
 * Calendar integration state now lives in the slices-pattern root store
 * (src/store/slices/calendarSlice.ts) and is exposed through the combined
 * `useAppStore`. This adapter keeps existing consumers (`useCalendarStore`,
 * its types, `REMINDER_PRESETS`) working without changes.
 *
 * Action name mapping (old standalone store → new slice on combined store):
 *
 *   beginConnection            → beginCalendarConnection
 *   completeConnection         → completeCalendarConnection
 *   handleOAuthRedirect        → handleCalendarOAuthRedirect
 *   cancelConnection           → cancelCalendarConnection
 *   disconnectConnection       → disconnectCalendarConnection
 *   setReminderOffsets         → setCalendarReminderOffsets
 *   toggleReminderOffset       → toggleCalendarReminderOffset
 *   clearError                 → clearCalendarError
 *   addOneTimePayment          → addCalendarOneTimePayment
 *   cancelOneTimePayment       → cancelCalendarOneTimePayment
 *   getOneTimePayments         → getCalendarOneTimePayments
 *   checkConflicts             → checkCalendarConflicts
 *   setTimezone                → setCalendarTimezone
 *
 * State field name mapping:
 *
 *   integrations               → calendarIntegrations
 *   syncedEvents               → calendarSyncedEvents
 *   reminderOffsets            → calendarReminderOffsets
 *   pendingAuthorizations      → calendarPendingAuthorizations
 *   isLoading                  → calendarIsLoading
 *   error                      → calendarError
 *   oneTimePayments            → calendarOneTimePayments
 *   scheduleConflicts          → calendarScheduleConflicts
 *   timezone                   → calendarTimezone
 */
export { useAppStore as useCalendarStore } from '../../src/store/slices';

export type {
  CalendarSlice,
  CalendarStoreState,
  CalendarExportPayload,
  CalendarIntegration,
  CalendarProvider,
  CalendarSyncedEvent,
  OneTimeScheduledPayment,
  PendingCalendarAuthorization,
  ProratedAdjustment,
  ScheduleConflict,
} from '../../src/store/slices';

export { REMINDER_PRESETS } from '../../src/store/slices';
