import { randomBytes } from 'crypto';
import type {
  CalendarConnection,
  CalendarEvent,
  CalendarEventType,
  CalendarProvider,
  CalendarSyncPreferences,
  SyncConflict,
  SyncDirection,
  SyncError,
  SyncResult,
  SyncWorkerConfig,
  WebhookNotification,
} from './types';
import { DEFAULT_SYNC_CONFIG } from './types';

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export class CalendarSyncService {
  private connections = new Map<string, CalendarConnection>();
  private events = new Map<string, CalendarEvent>();
  private preferences = new Map<string, CalendarSyncPreferences>();
  private webhookQueue: WebhookNotification[] = [];
  private rateLimitCounters = new Map<string, { count: number; windowStart: number }>();
  private config: SyncWorkerConfig;

  constructor(config: Partial<SyncWorkerConfig> = {}) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  // ── Connection Management ───────────────────────────────────────────

  createConnection(
    userId: string,
    provider: CalendarProvider,
    accessToken: string,
    refreshToken: string | undefined,
    accountEmail: string,
    calendarId: string,
    syncDirection: SyncDirection = 'bidirectional',
    enabledEventTypes: CalendarEventType[] = ['payment_due', 'renewal', 'trial_ending'],
  ): CalendarConnection {
    const now = new Date().toISOString();
    const connection: CalendarConnection = {
      id: generateId('cal_conn'),
      userId,
      provider,
      accessToken,
      refreshToken,
      calendarId,
      accountEmail,
      syncDirection,
      syncMethod: provider === 'ical' ? 'poll' : 'webhook',
      enabledEventTypes,
      status: 'connected',
      createdAt: now,
      updatedAt: now,
    };

    this.connections.set(connection.id, connection);

    if (connection.syncMethod === 'webhook' && provider !== 'ical') {
      this.registerWebhook(connection);
    }

    return connection;
  }

  getConnection(connectionId: string): CalendarConnection | undefined {
    return this.connections.get(connectionId);
  }

  listConnections(userId: string): CalendarConnection[] {
    return Array.from(this.connections.values()).filter(
      (c) => c.userId === userId,
    );
  }

  updateConnectionSettings(
    connectionId: string,
    updates: {
      syncDirection?: SyncDirection;
      enabledEventTypes?: CalendarEventType[];
      selectedCalendarId?: string;
    },
  ): CalendarConnection {
    const conn = this.requireConnection(connectionId);
    if (updates.syncDirection !== undefined) conn.syncDirection = updates.syncDirection;
    if (updates.enabledEventTypes !== undefined) conn.enabledEventTypes = updates.enabledEventTypes;
    if (updates.selectedCalendarId !== undefined) conn.selectedCalendarId = updates.selectedCalendarId;
    conn.updatedAt = new Date().toISOString();
    return conn;
  }

  disconnectConnection(connectionId: string): CalendarConnection {
    const conn = this.requireConnection(connectionId);
    conn.status = 'disconnected';
    conn.updatedAt = new Date().toISOString();

    const connEvents = Array.from(this.events.values()).filter(
      (e) => e.connectionId === connectionId,
    );
    for (const event of connEvents) {
      this.events.delete(event.id);
    }

    return conn;
  }

  // ── Event Management ────────────────────────────────────────────────

  createEvent(
    connectionId: string,
    subscriptionId: string,
    eventType: CalendarEventType,
    title: string,
    description: string,
    startTime: string,
    endTime: string,
    allDay = false,
  ): CalendarEvent {
    const conn = this.requireConnection(connectionId);
    if (!conn.enabledEventTypes.includes(eventType)) {
      throw new Error(`Event type '${eventType}' is not enabled for this connection`);
    }

    const now = new Date().toISOString();
    const event: CalendarEvent = {
      id: generateId('cal_event'),
      connectionId,
      subscriptionId,
      providerEventId: generateId('prov_evt'),
      eventType,
      title,
      description,
      startTime,
      endTime,
      allDay,
      syncStatus: 'pending',
      lastSyncedAt: now,
      localUpdatedAt: now,
      deleted: false,
    };

    this.events.set(event.id, event);
    return event;
  }

  getEvent(eventId: string): CalendarEvent | undefined {
    return this.events.get(eventId);
  }

  listEvents(connectionId: string): CalendarEvent[] {
    return Array.from(this.events.values()).filter(
      (e) => e.connectionId === connectionId && !e.deleted,
    );
  }

  listEventsBySubscription(subscriptionId: string): CalendarEvent[] {
    return Array.from(this.events.values()).filter(
      (e) => e.subscriptionId === subscriptionId && !e.deleted,
    );
  }

  updateEventLocally(
    eventId: string,
    updates: Partial<Pick<CalendarEvent, 'title' | 'description' | 'startTime' | 'endTime'>>,
  ): CalendarEvent {
    const event = this.requireEvent(eventId);
    if (updates.title !== undefined) event.title = updates.title;
    if (updates.description !== undefined) event.description = updates.description;
    if (updates.startTime !== undefined) event.startTime = updates.startTime;
    if (updates.endTime !== undefined) event.endTime = updates.endTime;
    event.localUpdatedAt = new Date().toISOString();
    event.syncStatus = 'pending';
    return event;
  }

  deleteEvent(eventId: string): CalendarEvent {
    const event = this.requireEvent(eventId);
    event.deleted = true;
    event.localUpdatedAt = new Date().toISOString();
    event.syncStatus = 'pending';
    return event;
  }

  // ── Two-Way Sync ────────────────────────────────────────────────────

  pushToCalendar(connectionId: string): SyncResult {
    const conn = this.requireConnection(connectionId);
    if (conn.syncDirection === 'from_calendar') {
      return this.emptySyncResult(connectionId);
    }

    if (!this.checkRateLimit(connectionId)) {
      return {
        ...this.emptySyncResult(connectionId),
        errors: [{ eventId: '', error: 'Rate limit exceeded', retryable: true }],
      };
    }

    const pendingEvents = Array.from(this.events.values()).filter(
      (e) => e.connectionId === connectionId && e.syncStatus === 'pending',
    );

    let pushed = 0;
    const errors: SyncError[] = [];

    for (const event of pendingEvents) {
      try {
        if (event.deleted) {
          event.syncStatus = 'synced';
        } else {
          event.syncStatus = 'synced';
          event.lastSyncedAt = new Date().toISOString();
          event.providerEventId = event.providerEventId || generateId('prov_evt');
        }
        pushed++;
      } catch (err) {
        errors.push({
          eventId: event.id,
          error: (err as Error).message,
          retryable: true,
        });
        event.syncStatus = 'failed';
      }
    }

    conn.lastSyncedAt = new Date().toISOString();
    conn.updatedAt = conn.lastSyncedAt;

    return {
      connectionId,
      syncedAt: conn.lastSyncedAt,
      pushed,
      pulled: 0,
      conflicts: [],
      errors,
    };
  }

  pullFromCalendar(connectionId: string, remoteChanges: RemoteChange[] = []): SyncResult {
    const conn = this.requireConnection(connectionId);
    if (conn.syncDirection === 'to_calendar') {
      return this.emptySyncResult(connectionId);
    }

    if (!this.checkRateLimit(connectionId)) {
      return {
        ...this.emptySyncResult(connectionId),
        errors: [{ eventId: '', error: 'Rate limit exceeded', retryable: true }],
      };
    }

    let pulled = 0;
    const conflicts: SyncConflict[] = [];
    const errors: SyncError[] = [];

    for (const change of remoteChanges) {
      try {
        const existing = Array.from(this.events.values()).find(
          (e) => e.providerEventId === change.providerEventId && e.connectionId === connectionId,
        );

        if (change.changeType === 'deleted') {
          if (existing) {
            existing.deleted = true;
            existing.syncStatus = 'synced';
            existing.lastSyncedAt = new Date().toISOString();
            pulled++;
          }
          continue;
        }

        if (existing) {
          const conflict = this.detectConflict(existing, change);
          if (conflict) {
            conflicts.push(conflict);
            this.resolveConflict(existing, change, conflict);
          } else {
            this.applyRemoteChange(existing, change);
          }
          pulled++;
        }
      } catch (err) {
        errors.push({
          eventId: change.providerEventId,
          error: (err as Error).message,
          retryable: true,
        });
      }
    }

    conn.lastSyncedAt = new Date().toISOString();
    conn.lastPollAt = conn.lastSyncedAt;
    conn.updatedAt = conn.lastSyncedAt;

    return {
      connectionId,
      syncedAt: conn.lastSyncedAt,
      pushed: 0,
      pulled,
      conflicts,
      errors,
    };
  }

  fullSync(connectionId: string, remoteChanges: RemoteChange[] = []): SyncResult {
    const pushResult = this.pushToCalendar(connectionId);
    const pullResult = this.pullFromCalendar(connectionId, remoteChanges);

    return {
      connectionId,
      syncedAt: new Date().toISOString(),
      pushed: pushResult.pushed,
      pulled: pullResult.pulled,
      conflicts: [...pushResult.conflicts, ...pullResult.conflicts],
      errors: [...pushResult.errors, ...pullResult.errors],
    };
  }

  // ── Webhook Handling ────────────────────────────────────────────────

  handleWebhookNotification(notification: WebhookNotification): void {
    this.webhookQueue.push(notification);
  }

  processWebhookQueue(): SyncResult[] {
    const results: SyncResult[] = [];
    const pending = [...this.webhookQueue];
    this.webhookQueue = [];

    const grouped = new Map<string, WebhookNotification[]>();
    for (const n of pending) {
      const existing = grouped.get(n.connectionId) ?? [];
      existing.push(n);
      grouped.set(n.connectionId, existing);
    }

    for (const [connectionId, notifications] of grouped) {
      const remoteChanges: RemoteChange[] = notifications.map((n) => ({
        providerEventId: n.resourceId,
        changeType: n.changeType,
        title: undefined,
        startTime: undefined,
        endTime: undefined,
        updatedAt: n.timestamp,
      }));

      const result = this.pullFromCalendar(connectionId, remoteChanges);
      results.push(result);
    }

    return results;
  }

  // ── Polling Fallback ────────────────────────────────────────────────

  getConnectionsNeedingPoll(): CalendarConnection[] {
    const now = Date.now();
    return Array.from(this.connections.values()).filter((conn) => {
      if (conn.status !== 'connected') return false;
      if (conn.syncMethod !== 'poll') return false;

      const lastPoll = conn.lastPollAt ? new Date(conn.lastPollAt).getTime() : 0;
      return now - lastPoll >= this.config.pollIntervalMs;
    });
  }

  pollConnection(connectionId: string, remoteChanges: RemoteChange[] = []): SyncResult {
    const conn = this.requireConnection(connectionId);
    conn.lastPollAt = new Date().toISOString();
    return this.fullSync(connectionId, remoteChanges);
  }

  // ── Sync Preferences ───────────────────────────────────────────────

  setSyncPreferences(preferences: CalendarSyncPreferences): void {
    this.preferences.set(preferences.userId, preferences);
  }

  getSyncPreferences(userId: string): CalendarSyncPreferences | undefined {
    return this.preferences.get(userId);
  }

  // ── ICS Generation ──────────────────────────────────────────────────

  generateICS(connectionId: string): string {
    const events = this.listEvents(connectionId);
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SubTrackr//Calendar Sync//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    for (const event of events) {
      const start = new Date(event.startTime).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const end = new Date(event.endTime).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${event.id}@subtrackr`);
      lines.push(`DTSTAMP:${start}`);
      lines.push(`DTSTART:${start}`);
      lines.push(`DTEND:${end}`);
      lines.push(`SUMMARY:${event.title.replace(/[;,\\]/g, '\\$&')}`);
      lines.push(`DESCRIPTION:${event.description.replace(/[;,\\]/g, '\\$&')}`);
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // ── Internals ───────────────────────────────────────────────────────

  private registerWebhook(connection: CalendarConnection): void {
    connection.webhookId = generateId('webhook');
    connection.webhookExpiry = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  private requireConnection(connectionId: string): CalendarConnection {
    const conn = this.connections.get(connectionId);
    if (!conn) throw new Error(`Calendar connection ${connectionId} not found`);
    return conn;
  }

  private requireEvent(eventId: string): CalendarEvent {
    const event = this.events.get(eventId);
    if (!event) throw new Error(`Calendar event ${eventId} not found`);
    return event;
  }

  private emptySyncResult(connectionId: string): SyncResult {
    return {
      connectionId,
      syncedAt: new Date().toISOString(),
      pushed: 0,
      pulled: 0,
      conflicts: [],
      errors: [],
    };
  }

  private checkRateLimit(connectionId: string): boolean {
    const now = Date.now();
    const counter = this.rateLimitCounters.get(connectionId);

    if (!counter || now - counter.windowStart > 60_000) {
      this.rateLimitCounters.set(connectionId, { count: 1, windowStart: now });
      return true;
    }

    if (counter.count >= this.config.rateLimitPerMinute) {
      return false;
    }

    counter.count++;
    return true;
  }

  private detectConflict(existing: CalendarEvent, remote: RemoteChange): SyncConflict | null {
    if (!remote.updatedAt || !existing.localUpdatedAt) return null;

    const remoteTime = new Date(remote.updatedAt).getTime();
    const localTime = new Date(existing.localUpdatedAt).getTime();
    const lastSync = existing.lastSyncedAt ? new Date(existing.lastSyncedAt).getTime() : 0;

    if (remoteTime > lastSync && localTime > lastSync) {
      if (remote.title && remote.title !== existing.title) {
        return {
          eventId: existing.id,
          field: 'title',
          localValue: existing.title,
          remoteValue: remote.title,
          resolvedWith: remoteTime > localTime ? 'remote' : 'local',
        };
      }
    }

    return null;
  }

  private resolveConflict(existing: CalendarEvent, remote: RemoteChange, conflict: SyncConflict): void {
    if (conflict.resolvedWith === 'remote') {
      this.applyRemoteChange(existing, remote);
    }
    existing.syncStatus = 'synced';
  }

  private applyRemoteChange(event: CalendarEvent, change: RemoteChange): void {
    if (change.title !== undefined) event.title = change.title;
    if (change.startTime !== undefined) event.startTime = change.startTime;
    if (change.endTime !== undefined) event.endTime = change.endTime;
    event.providerUpdatedAt = change.updatedAt;
    event.lastSyncedAt = new Date().toISOString();
    event.syncStatus = 'synced';
  }
}

export interface RemoteChange {
  providerEventId: string;
  changeType: 'created' | 'updated' | 'deleted';
  title?: string;
  startTime?: string;
  endTime?: string;
  updatedAt?: string;
}

export const calendarSyncService = new CalendarSyncService();
