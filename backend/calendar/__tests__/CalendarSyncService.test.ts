import { CalendarSyncService, type RemoteChange } from '../domain/CalendarSyncService';
import { SyncWorker } from '../domain/SyncWorker';

describe('CalendarSyncService', () => {
  let service: CalendarSyncService;

  beforeEach(() => {
    service = new CalendarSyncService({ pollIntervalMs: 1000, rateLimitPerMinute: 100 });
  });

  describe('Connection Management', () => {
    it('creates a Google Calendar connection with webhook sync', () => {
      const conn = service.createConnection(
        'user_1', 'google', 'token_123', 'refresh_123',
        'user@gmail.com', 'primary',
      );

      expect(conn.id).toMatch(/^cal_conn_/);
      expect(conn.provider).toBe('google');
      expect(conn.syncMethod).toBe('webhook');
      expect(conn.syncDirection).toBe('bidirectional');
      expect(conn.status).toBe('connected');
      expect(conn.webhookId).toBeTruthy();
    });

    it('creates an Outlook connection', () => {
      const conn = service.createConnection(
        'user_1', 'outlook', 'token_456', undefined,
        'user@outlook.com', 'calendar_id',
      );

      expect(conn.provider).toBe('outlook');
      expect(conn.syncMethod).toBe('webhook');
    });

    it('creates an iCal connection with poll sync', () => {
      const conn = service.createConnection(
        'user_1', 'ical', 'token_789', undefined,
        'user@example.com', 'cal_id',
      );

      expect(conn.provider).toBe('ical');
      expect(conn.syncMethod).toBe('poll');
      expect(conn.webhookId).toBeUndefined();
    });

    it('lists connections by user', () => {
      service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');
      service.createConnection('user_1', 'outlook', 'tok', undefined, 'a@b.com', 'cal');
      service.createConnection('user_2', 'google', 'tok', undefined, 'c@c.com', 'cal');

      expect(service.listConnections('user_1')).toHaveLength(2);
      expect(service.listConnections('user_2')).toHaveLength(1);
    });

    it('updates connection settings', () => {
      const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');
      const updated = service.updateConnectionSettings(conn.id, {
        syncDirection: 'to_calendar',
        enabledEventTypes: ['payment_due', 'contract_end'],
      });

      expect(updated.syncDirection).toBe('to_calendar');
      expect(updated.enabledEventTypes).toEqual(['payment_due', 'contract_end']);
    });

    it('disconnects and removes events', () => {
      const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');
      service.createEvent(conn.id, 'sub_1', 'payment_due', 'Payment', 'Desc',
        new Date().toISOString(), new Date().toISOString());

      expect(service.listEvents(conn.id)).toHaveLength(1);

      const disconnected = service.disconnectConnection(conn.id);
      expect(disconnected.status).toBe('disconnected');
      expect(service.listEvents(conn.id)).toHaveLength(0);
    });
  });

  describe('Event Management', () => {
    let connectionId: string;

    beforeEach(() => {
      const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');
      connectionId = conn.id;
    });

    it('creates calendar events', () => {
      const event = service.createEvent(
        connectionId, 'sub_1', 'payment_due',
        'Netflix Payment Due', 'Monthly Netflix subscription',
        '2025-02-01T09:00:00Z', '2025-02-01T09:30:00Z',
      );

      expect(event.id).toMatch(/^cal_event_/);
      expect(event.eventType).toBe('payment_due');
      expect(event.syncStatus).toBe('pending');
      expect(event.deleted).toBe(false);
    });

    it('rejects disabled event types', () => {
      service.updateConnectionSettings(connectionId, {
        enabledEventTypes: ['payment_due'],
      });

      expect(() =>
        service.createEvent(connectionId, 'sub_1', 'trial_ending', 'Trial', 'Desc',
          '2025-02-01T00:00:00Z', '2025-02-01T00:30:00Z'),
      ).toThrow("Event type 'trial_ending' is not enabled");
    });

    it('lists events by connection', () => {
      service.createEvent(connectionId, 'sub_1', 'payment_due', 'P1', 'D', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');
      service.createEvent(connectionId, 'sub_2', 'renewal', 'P2', 'D', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z');

      expect(service.listEvents(connectionId)).toHaveLength(2);
    });

    it('lists events by subscription', () => {
      service.createEvent(connectionId, 'sub_1', 'payment_due', 'P1', 'D', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');
      service.createEvent(connectionId, 'sub_1', 'renewal', 'P2', 'D', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z');
      service.createEvent(connectionId, 'sub_2', 'payment_due', 'P3', 'D', '2025-03-01T00:00:00Z', '2025-03-01T01:00:00Z');

      expect(service.listEventsBySubscription('sub_1')).toHaveLength(2);
      expect(service.listEventsBySubscription('sub_2')).toHaveLength(1);
    });

    it('updates events locally', () => {
      const event = service.createEvent(connectionId, 'sub_1', 'payment_due', 'Original', 'Desc',
        '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

      const updated = service.updateEventLocally(event.id, { title: 'Updated Title' });
      expect(updated.title).toBe('Updated Title');
      expect(updated.syncStatus).toBe('pending');
    });

    it('soft-deletes events', () => {
      const event = service.createEvent(connectionId, 'sub_1', 'payment_due', 'P', 'D',
        '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

      service.deleteEvent(event.id);
      expect(service.listEvents(connectionId)).toHaveLength(0);
      expect(service.getEvent(event.id)!.deleted).toBe(true);
    });
  });

  describe('Push Sync (to calendar)', () => {
    it('pushes pending events to calendar', () => {
      const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');
      service.createEvent(conn.id, 'sub_1', 'payment_due', 'P1', 'D', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');
      service.createEvent(conn.id, 'sub_2', 'renewal', 'P2', 'D', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z');

      const result = service.pushToCalendar(conn.id);
      expect(result.pushed).toBe(2);
      expect(result.errors).toHaveLength(0);

      const events = service.listEvents(conn.id);
      expect(events.every((e) => e.syncStatus === 'synced')).toBe(true);
    });

    it('skips push for from_calendar connections', () => {
      const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal', 'from_calendar');
      service.createEvent(conn.id, 'sub_1', 'payment_due', 'P1', 'D', '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

      const result = service.pushToCalendar(conn.id);
      expect(result.pushed).toBe(0);
    });
  });

  describe('Pull Sync (from calendar)', () => {
    it('pulls remote changes', () => {
      const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');
      const event = service.createEvent(conn.id, 'sub_1', 'payment_due', 'Original', 'D',
        '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');
      service.pushToCalendar(conn.id);

      const remoteChanges: RemoteChange[] = [{
        providerEventId: event.providerEventId,
        changeType: 'updated',
        title: 'Remotely Updated',
        updatedAt: new Date(Date.now() + 10000).toISOString(),
      }];

      const result = service.pullFromCalendar(conn.id, remoteChanges);
      expect(result.pulled).toBe(1);

      const updated = service.getEvent(event.id);
      expect(updated!.title).toBe('Remotely Updated');
    });

    it('handles remote deletion', () => {
      const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');
      const event = service.createEvent(conn.id, 'sub_1', 'payment_due', 'To Delete', 'D',
        '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');
      service.pushToCalendar(conn.id);

      const remoteChanges: RemoteChange[] = [{
        providerEventId: event.providerEventId,
        changeType: 'deleted',
      }];

      const result = service.pullFromCalendar(conn.id, remoteChanges);
      expect(result.pulled).toBe(1);
      expect(service.getEvent(event.id)!.deleted).toBe(true);
    });

    it('skips pull for to_calendar connections', () => {
      const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal', 'to_calendar');

      const result = service.pullFromCalendar(conn.id, [{
        providerEventId: 'prov_1',
        changeType: 'updated',
        title: 'Remote',
      }]);

      expect(result.pulled).toBe(0);
    });
  });

  describe('Full Bidirectional Sync', () => {
    it('pushes and pulls in one operation', () => {
      const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');
      const event = service.createEvent(conn.id, 'sub_1', 'payment_due', 'Local', 'D',
        '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

      const result = service.fullSync(conn.id);
      expect(result.pushed).toBe(1);

      const result2 = service.fullSync(conn.id, [{
        providerEventId: event.providerEventId,
        changeType: 'updated',
        title: 'Remote Update',
        updatedAt: new Date(Date.now() + 10000).toISOString(),
      }]);
      expect(result2.pulled).toBe(1);
    });
  });

  describe('Webhook Handling', () => {
    it('queues and processes webhook notifications', () => {
      const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');
      const event = service.createEvent(conn.id, 'sub_1', 'payment_due', 'P', 'D',
        '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');
      service.pushToCalendar(conn.id);

      service.handleWebhookNotification({
        provider: 'google',
        connectionId: conn.id,
        resourceId: event.providerEventId,
        changeType: 'deleted',
        timestamp: new Date().toISOString(),
      });

      const results = service.processWebhookQueue();
      expect(results).toHaveLength(1);
      expect(results[0].pulled).toBe(1);
    });
  });

  describe('Polling Fallback', () => {
    it('identifies connections needing poll', () => {
      const conn = service.createConnection('user_1', 'ical', 'tok', undefined, 'a@a.com', 'cal');

      const needingPoll = service.getConnectionsNeedingPoll();
      expect(needingPoll).toHaveLength(1);
      expect(needingPoll[0].id).toBe(conn.id);
    });

    it('does not poll recently polled connections', () => {
      const conn = service.createConnection('user_1', 'ical', 'tok', undefined, 'a@a.com', 'cal');
      service.pollConnection(conn.id);

      const needingPoll = service.getConnectionsNeedingPoll();
      expect(needingPoll).toHaveLength(0);
    });

    it('does not poll webhook-based connections', () => {
      service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');

      const needingPoll = service.getConnectionsNeedingPoll();
      expect(needingPoll).toHaveLength(0);
    });
  });

  describe('ICS Export', () => {
    it('generates valid ICS content', () => {
      const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');
      service.createEvent(conn.id, 'sub_1', 'payment_due', 'Netflix Due', 'Monthly charge',
        '2025-02-01T09:00:00Z', '2025-02-01T09:30:00Z');

      const ics = service.generateICS(conn.id);
      expect(ics).toContain('BEGIN:VCALENDAR');
      expect(ics).toContain('BEGIN:VEVENT');
      expect(ics).toContain('SUMMARY:Netflix Due');
      expect(ics).toContain('END:VCALENDAR');
    });
  });

  describe('Sync Preferences', () => {
    it('stores and retrieves sync preferences', () => {
      service.setSyncPreferences({
        userId: 'user_1',
        enabledEventTypes: ['payment_due', 'renewal'],
        defaultSyncDirection: 'bidirectional',
        reminderMinutesBefore: [60, 1440],
      });

      const prefs = service.getSyncPreferences('user_1');
      expect(prefs).toBeDefined();
      expect(prefs!.enabledEventTypes).toEqual(['payment_due', 'renewal']);
    });

    it('returns undefined for unknown user', () => {
      expect(service.getSyncPreferences('unknown')).toBeUndefined();
    });
  });
});

describe('SyncWorker', () => {
  let service: CalendarSyncService;
  let worker: SyncWorker;

  beforeEach(() => {
    service = new CalendarSyncService({ pollIntervalMs: 100, rateLimitPerMinute: 100 });
    worker = new SyncWorker(service, { pollIntervalMs: 100 });
  });

  afterEach(() => {
    worker.stop();
  });

  it('starts and stops', () => {
    expect(worker.isRunning()).toBe(false);
    worker.start();
    expect(worker.isRunning()).toBe(true);
    worker.stop();
    expect(worker.isRunning()).toBe(false);
  });

  it('triggers immediate sync', () => {
    const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');
    service.createEvent(conn.id, 'sub_1', 'payment_due', 'P', 'D',
      '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');

    const result = worker.triggerImmediateSync(conn.id);
    expect(result.pushed).toBe(1);
  });

  it('processes pending webhooks', () => {
    const conn = service.createConnection('user_1', 'google', 'tok', undefined, 'a@a.com', 'cal');
    const event = service.createEvent(conn.id, 'sub_1', 'payment_due', 'P', 'D',
      '2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z');
    service.pushToCalendar(conn.id);

    service.handleWebhookNotification({
      provider: 'google',
      connectionId: conn.id,
      resourceId: event.providerEventId,
      changeType: 'updated',
      timestamp: new Date().toISOString(),
    });

    const results = worker.processWebhooks();
    expect(results).toHaveLength(1);
  });

  it('runs poll cycle for eligible connections', () => {
    service.createConnection('user_1', 'ical', 'tok', undefined, 'a@a.com', 'cal');

    const results = worker.runPollCycle();
    expect(results).toHaveLength(1);
  });
});
