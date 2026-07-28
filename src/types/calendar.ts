export type CalendarProvider = 'google' | 'apple' | 'outlook';

// ── Calendar Billing Types ─────────────────────────────────────────────────

/**
 * Policy for handling months that don't have the target day_of_month.
 * - 'last_day': bill on the last day of the month (e.g. Jan 31 → Feb 28)
 * - 'first_day_next': bill on the 1st of the following month
 * - 'skip': skip billing for that month
 */
export type AdjustmentPolicy = 'last_day' | 'first_day_next' | 'skip';

/**
 * Calendar-based billing configuration for a merchant or subscription.
 * Allows billing to be anchored to a specific calendar day rather than
 * the subscription creation date.
 */
export interface CalendarBilling {
  /** Day of month to bill on (1–31). Values > 28 are subject to adjustment_policy. */
  day_of_month: number;
  /** How many months between billing cycles (1 = monthly, 3 = quarterly, 12 = yearly). */
  billing_months_interval: number;
  /** How to handle months that don't have the target day. */
  adjustment_policy: AdjustmentPolicy;
  /** Optional timezone for interpreting the billing day. Defaults to 'UTC'. */
  timezone?: string;
}

/** A generated invoice for a calendar-billing period. */
export interface CalendarInvoice {
  id: string;
  subscriptionId: string;
  merchantId: string;
  periodStart: string; // ISO date string
  periodEnd: string; // ISO date string
  billingDate: string; // ISO date string — the actual calendar-adjusted date
  amount: number;
  currency: string;
  /** Pro-rata amount if the subscription started mid-period. */
  proratedAmount?: number;
  isProratedPeriod: boolean;
  status: 'draft' | 'issued' | 'paid' | 'void';
  createdAt: string;
}

/** Per-merchant calendar billing schedule. */
export interface MerchantBillingSchedule {
  merchantId: string;
  config: CalendarBilling;
  /** ISO date string of the next scheduled billing date. */
  nextBillingDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface PendingCalendarAuthorization {
  provider: CalendarProvider;
  state: string;
  codeVerifier: string;
  authorizationUrl: string;
  redirectUri: string;
  issuedAt: string;
}

export interface CalendarOAuthCallbackPayload {
  state: string;
  code: string;
  redirectUri: string;
}

export interface CalendarIntegration {
  id: string;
  provider: CalendarProvider;
  access_token: string;
  accountEmail: string;
  calendarId: string;
  status: 'connected' | 'disconnected';
  connectedAt: string;
  lastSyncedAt?: string;
  reminderOffsets: number[];
  syncSettings?: CalendarSyncSettings;
}

export type CalendarEventKind = 'billing_reminder' | 'one_time_payment';

export interface CalendarEventTemplate {
  kind: CalendarEventKind;
  title: string;
  notes: string;
  startAt: string;
  endAt: string;
  reminderOffsets: number[];
}

export interface OneTimeScheduledPayment {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  scheduledDate: string;
  description: string;
  status: 'pending' | 'processed' | 'cancelled';
  createdAt: string;
}

export interface ScheduleConflict {
  date: string;
  conflictingSubscriptions: { id: string; name: string; amount: number; currency: string }[];
  totalAmount: number;
}

export interface ProratedAdjustment {
  originalAmount: number;
  proratedAmount: number;
  daysRemaining: number;
  daysInCycle: number;
  effectiveDate: string;
  reason: string;
}

export interface CalendarExportPayload {
  ical: string;
  filename: string;
  events: CalendarEventTemplate[];
}

export const SUBSCRIPTION_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

export type SubscriptionTimezone = (typeof SUBSCRIPTION_TIMEZONES)[number];

export interface CalendarSyncedEvent extends CalendarEventTemplate {
  id: string;
  subscriptionId: string;
  connectionId: string;
  providerEventId: string;
  externalUrl: string;
  lastSyncedAt: string;
}

export interface ReminderPreset {
  label: string;
  offsets: number[];
}

export interface ReminderOffsetOption {
  label: string;
  offset: number;
}

export type SyncDirection = 'to_calendar' | 'from_calendar' | 'bidirectional';
export type CalendarEventType =
  | 'payment_due'
  | 'payment_received'
  | 'trial_ending'
  | 'renewal'
  | 'contract_end';
export type SyncMethod = 'webhook' | 'poll';

export interface CalendarSyncSettings {
  syncDirection: SyncDirection;
  enabledEventTypes: CalendarEventType[];
  syncMethod: SyncMethod;
  lastSyncResult?: {
    syncedAt: string;
    pushed: number;
    pulled: number;
    conflicts: number;
    errors: number;
  };
}

export const ALL_CALENDAR_EVENT_TYPES: CalendarEventType[] = [
  'payment_due',
  'payment_received',
  'trial_ending',
  'renewal',
  'contract_end',
];

export const CALENDAR_EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  payment_due: 'Payment Due',
  payment_received: 'Payment Received',
  trial_ending: 'Trial Ending',
  renewal: 'Renewal',
  contract_end: 'Contract End',
};

export const SYNC_DIRECTION_LABELS: Record<SyncDirection, string> = {
  to_calendar: 'SubTrackr → Calendar',
  from_calendar: 'Calendar → SubTrackr',
  bidirectional: 'Two-way sync',
};

export const CALENDAR_PROVIDERS: CalendarProvider[] = ['google', 'apple', 'outlook'];

export const REMINDER_PRESETS: ReminderPreset[] = [
  { label: 'Last minute', offsets: [60] },
  { label: 'Balanced', offsets: [24 * 60, 60] },
  { label: 'Planned ahead', offsets: [7 * 24 * 60, 24 * 60, 60] },
];

export const REMINDER_OFFSET_OPTIONS: ReminderOffsetOption[] = [
  { label: '7d', offset: 7 * 24 * 60 },
  { label: '3d', offset: 3 * 24 * 60 },
  { label: '1d', offset: 24 * 60 },
  { label: '12h', offset: 12 * 60 },
  { label: '3h', offset: 3 * 60 },
  { label: '1h', offset: 60 },
];
