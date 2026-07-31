import { CalendarSyncService, type RemoteChange } from '../domain/CalendarSyncService';
import type {
  CalendarConnection,
  CalendarEvent,
  CalendarEventType,
  CalendarProvider,
  CalendarSyncPreferences,
  SyncDirection,
  SyncResult,
  WebhookNotification,
} from '../domain/types';

interface ControllerResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export function createCalendarSyncController(deps: {
  syncService: CalendarSyncService;
}) {
  const { syncService } = deps;

  return {
    createConnection(body: {
      userId: string;
      provider: CalendarProvider;
      accessToken: string;
      refreshToken?: string;
      accountEmail: string;
      calendarId: string;
      syncDirection?: SyncDirection;
      enabledEventTypes?: CalendarEventType[];
    }): ControllerResult<CalendarConnection> {
      try {
        if (!body.userId || !body.provider || !body.accessToken || !body.accountEmail) {
          return { success: false, error: 'Missing required fields', status: 400 };
        }

        const conn = syncService.createConnection(
          body.userId,
          body.provider,
          body.accessToken,
          body.refreshToken,
          body.accountEmail,
          body.calendarId,
          body.syncDirection,
          body.enabledEventTypes,
        );
        return { success: true, data: conn };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 500 };
      }
    },

    getConnection(connectionId: string): ControllerResult<CalendarConnection> {
      const conn = syncService.getConnection(connectionId);
      if (!conn) return { success: false, error: 'Connection not found', status: 404 };
      return { success: true, data: conn };
    },

    listConnections(userId: string): ControllerResult<CalendarConnection[]> {
      const connections = syncService.listConnections(userId);
      return { success: true, data: connections };
    },

    updateConnectionSettings(connectionId: string, body: {
      syncDirection?: SyncDirection;
      enabledEventTypes?: CalendarEventType[];
      selectedCalendarId?: string;
    }): ControllerResult<CalendarConnection> {
      try {
        const conn = syncService.updateConnectionSettings(connectionId, body);
        return { success: true, data: conn };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    disconnectConnection(connectionId: string): ControllerResult<CalendarConnection> {
      try {
        const conn = syncService.disconnectConnection(connectionId);
        return { success: true, data: conn };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    createEvent(connectionId: string, body: {
      subscriptionId: string;
      eventType: CalendarEventType;
      title: string;
      description: string;
      startTime: string;
      endTime: string;
      allDay?: boolean;
    }): ControllerResult<CalendarEvent> {
      try {
        if (!body.subscriptionId || !body.eventType || !body.title) {
          return { success: false, error: 'Missing required fields', status: 400 };
        }
        const event = syncService.createEvent(
          connectionId,
          body.subscriptionId,
          body.eventType,
          body.title,
          body.description,
          body.startTime,
          body.endTime,
          body.allDay,
        );
        return { success: true, data: event };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    listEvents(connectionId: string): ControllerResult<CalendarEvent[]> {
      try {
        const events = syncService.listEvents(connectionId);
        return { success: true, data: events };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    listEventsBySubscription(subscriptionId: string): ControllerResult<CalendarEvent[]> {
      const events = syncService.listEventsBySubscription(subscriptionId);
      return { success: true, data: events };
    },

    updateEvent(eventId: string, body: {
      title?: string;
      description?: string;
      startTime?: string;
      endTime?: string;
    }): ControllerResult<CalendarEvent> {
      try {
        const event = syncService.updateEventLocally(eventId, body);
        return { success: true, data: event };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    deleteEvent(eventId: string): ControllerResult<CalendarEvent> {
      try {
        const event = syncService.deleteEvent(eventId);
        return { success: true, data: event };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    pushSync(connectionId: string): ControllerResult<SyncResult> {
      try {
        const result = syncService.pushToCalendar(connectionId);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 500 };
      }
    },

    pullSync(connectionId: string, remoteChanges: RemoteChange[]): ControllerResult<SyncResult> {
      try {
        const result = syncService.pullFromCalendar(connectionId, remoteChanges);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 500 };
      }
    },

    fullSync(connectionId: string, remoteChanges: RemoteChange[] = []): ControllerResult<SyncResult> {
      try {
        const result = syncService.fullSync(connectionId, remoteChanges);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 500 };
      }
    },

    handleWebhook(notification: WebhookNotification): ControllerResult {
      try {
        syncService.handleWebhookNotification(notification);
        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    exportICS(connectionId: string): ControllerResult<{ ics: string }> {
      try {
        const ics = syncService.generateICS(connectionId);
        return { success: true, data: { ics } };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    setSyncPreferences(preferences: CalendarSyncPreferences): ControllerResult {
      try {
        syncService.setSyncPreferences(preferences);
        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    getSyncPreferences(userId: string): ControllerResult<CalendarSyncPreferences | undefined> {
      const prefs = syncService.getSyncPreferences(userId);
      return { success: true, data: prefs };
    },
  };
}
