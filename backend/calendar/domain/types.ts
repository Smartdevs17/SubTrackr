export type CalendarProvider = 'google' | 'outlook' | 'ical';
export type CalendarEventType =
  | 'payment_due'
  | 'payment_received'
  | 'trial_ending'
  | 'renewal'
  | 'contract_end';
export type SyncDirection = 'to_calendar' | 'from_calendar' | 'bidirectional';
export type SyncMethod = 'webhook' | 'poll';
export type SyncStatus = 'pending' | 'synced' | 'failed' | 'conflict';

export interface CalendarConnection {
  id: string;
  userId: string;
  provider: CalendarProvider;
  accessToken: string;
  refreshToken?: string;
  calendarId: string;
  accountEmail: string;
  syncDirection: SyncDirection;
  syncMethod: SyncMethod;
  enabledEventTypes: CalendarEventType[];
  selectedCalendarId?: string;
  webhookId?: string;
  webhookExpiry?: string;
  lastSyncedAt?: string;
  lastPollAt?: string;
  status: 'connected' | 'disconnected' | 'error';
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  id: string;
  connectionId: string;
  subscriptionId: string;
  providerEventId: string;
  eventType: CalendarEventType;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  syncStatus: SyncStatus;
  lastSyncedAt: string;
  providerUpdatedAt?: string;
  localUpdatedAt: string;
  deleted: boolean;
}

export interface SyncResult {
  connectionId: string;
  syncedAt: string;
  pushed: number;
  pulled: number;
  conflicts: SyncConflict[];
  errors: SyncError[];
}

export interface SyncConflict {
  eventId: string;
  field: string;
  localValue: string;
  remoteValue: string;
  resolvedWith: 'local' | 'remote';
}

export interface SyncError {
  eventId: string;
  error: string;
  retryable: boolean;
}

export interface WebhookNotification {
  provider: CalendarProvider;
  connectionId: string;
  resourceId: string;
  changeType: 'created' | 'updated' | 'deleted';
  timestamp: string;
}

export interface SyncWorkerConfig {
  pollIntervalMs: number;
  webhookRenewalBeforeExpiryMs: number;
  maxRetries: number;
  rateLimitPerMinute: number;
}

export interface CalendarSyncPreferences {
  userId: string;
  enabledEventTypes: CalendarEventType[];
  defaultSyncDirection: SyncDirection;
  preferredCalendarId?: string;
  reminderMinutesBefore: number[];
}

export const DEFAULT_SYNC_CONFIG: SyncWorkerConfig = {
  pollIntervalMs: 60 * 60 * 1000,
  webhookRenewalBeforeExpiryMs: 24 * 60 * 60 * 1000,
  maxRetries: 3,
  rateLimitPerMinute: 60,
};

export const ALL_EVENT_TYPES: CalendarEventType[] = [
  'payment_due',
  'payment_received',
  'trial_ending',
  'renewal',
  'contract_end',
];

export const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  payment_due: 'Payment Due',
  payment_received: 'Payment Received',
  trial_ending: 'Trial Ending',
  renewal: 'Renewal',
  contract_end: 'Contract End',
};
