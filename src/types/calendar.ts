export type CalendarProvider = 'google' | 'apple' | 'outlook';

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
}

export type CalendarEventKind = 'billing_reminder';

export interface CalendarEventTemplate {
  kind: CalendarEventKind;
  title: string;
  notes: string;
  startAt: string;
  endAt: string;
  reminderOffsets: number[];
}

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
