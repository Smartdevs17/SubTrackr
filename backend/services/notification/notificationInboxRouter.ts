/**
 * Notification inbox API (#1750)
 *
 * Plain Node.js HTTP router exposing the NotificationCenterService history as
 * the inbox the mobile client syncs against. Mounts under `/api/notifications`
 * in server.ts.
 *
 * Routes
 * ──────
 *   GET    /api/notifications/history?userId=…[&type=…&channel=…&status=…&unreadOnly=1&since=…&until=…&limit=…]
 *   GET    /api/notifications/unread-count?userId=…
 *   POST   /api/notifications/history/read-all          body: { userId }
 *   POST   /api/notifications/:id/read
 *   POST   /api/notifications/:id/click
 *
 * Every route is scoped to one subscriber via `userId` (query or body); there
 * is deliberately no cross-user listing. Errors are `{ error: string }`.
 */

import type http from 'node:http';
import { URL } from 'node:url';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
} from '../../../src/types/notification';
import type {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from '../../../src/types/notification';
import type { NotificationCenterService } from '../notificationCenterService';

const PREFIX = '/api/notifications';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

async function readJsonBody(req: http.IncomingMessage, maxBytes = 64_000): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as string[]).includes(value);
}

function isNotificationChannel(value: string): value is NotificationChannel {
  return (NOTIFICATION_CHANNELS as string[]).includes(value);
}

const NOTIFICATION_STATUSES: NotificationStatus[] = [
  'scheduled',
  'sent',
  'delivered',
  'failed',
  'suppressed',
];

function isNotificationStatus(value: string): value is NotificationStatus {
  return (NOTIFICATION_STATUSES as string[]).includes(value);
}

/** `/api/notifications/:id/read` → `:id`, or null when the path is deeper. */
function extractRecordId(pathname: string, action: string): string | null {
  const after = pathname.slice(PREFIX.length).replace(/^\//, '');
  const parts = after.split('/');
  if (parts.length !== 2 || parts[1] !== action) return null;
  const id = parts[0];
  return id ? id : null;
}

export interface InboxQuery {
  userId: string;
  type?: NotificationType;
  channel?: NotificationChannel;
  status?: NotificationStatus;
  unreadOnly?: boolean;
  since?: string;
  until?: string;
  limit?: number;
}

/**
 * Parse and validate the history query string.
 * Returns `{ error }` when a parameter is present but unusable.
 */
export function parseInboxQuery(params: URLSearchParams): InboxQuery | { error: string } {
  const userId = params.get('userId')?.trim();
  if (!userId) return { error: 'userId is required' };

  const type = params.get('type')?.trim();
  if (type && !isNotificationType(type)) {
    return { error: `Unknown notification type "${type}"` };
  }

  const channel = params.get('channel')?.trim();
  if (channel && !isNotificationChannel(channel)) {
    return { error: `Unknown notification channel "${channel}"` };
  }

  const status = params.get('status')?.trim();
  if (status && !isNotificationStatus(status)) {
    return { error: `Unknown notification status "${status}"` };
  }

  const since = params.get('since')?.trim();
  if (since && Number.isNaN(Date.parse(since))) {
    return { error: 'since must be an ISO-8601 timestamp' };
  }

  const until = params.get('until')?.trim();
  if (until && Number.isNaN(Date.parse(until))) {
    return { error: 'until must be an ISO-8601 timestamp' };
  }

  const limitRaw = params.get('limit')?.trim();
  let limit: number | undefined;
  if (limitRaw) {
    limit = Number.parseInt(limitRaw, 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
      return { error: 'limit must be an integer between 1 and 500' };
    }
  }

  return {
    userId,
    type: type as NotificationType | undefined,
    channel: channel as NotificationChannel | undefined,
    status: status as NotificationStatus | undefined,
    unreadOnly: params.get('unreadOnly') === '1' || params.get('unreadOnly') === 'true',
    since: since || undefined,
    until: until || undefined,
    limit,
  };
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createNotificationInboxRouter(center: NotificationCenterService) {
  /**
   * Handle a request when it matches the `/api/notifications` prefix.
   * Returns true when handled; false to fall through to the next handler.
   */
  return async function handleInboxRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    if (!pathname.startsWith(PREFIX)) return false;

    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // ── GET /api/notifications/history ────────────────────────────────────
    if (pathname === `${PREFIX}/history` && method === 'GET') {
      const query = parseInboxQuery(url.searchParams);
      if ('error' in query) {
        sendJson(res, 400, { error: query.error });
        return true;
      }

      const records = center.getHistory({
        userId: query.userId,
        type: query.type,
        channel: query.channel,
        status: query.status,
        unreadOnly: query.unreadOnly,
        since: query.since,
        until: query.until,
      });
      const limited = query.limit ? records.slice(0, query.limit) : records;
      return sendJson(res, 200, { records: limited, total: records.length }), true;
    }

    // ── GET /api/notifications/unread-count ───────────────────────────────
    if (pathname === `${PREFIX}/unread-count` && method === 'GET') {
      const userId = url.searchParams.get('userId')?.trim();
      if (!userId) {
        sendJson(res, 400, { error: 'userId is required' });
        return true;
      }
      sendJson(res, 200, { userId, unread: center.getUnreadCount(userId) });
      return true;
    }

    // ── POST /api/notifications/history/read-all ──────────────────────────
    if (pathname === `${PREFIX}/history/read-all` && method === 'POST') {
      const body = (await readJsonBody(req)) as { userId?: unknown };
      const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
      if (!userId) {
        sendJson(res, 400, { error: 'userId is required' });
        return true;
      }
      const marked = center.markAllRead(userId);
      sendJson(res, 200, { userId, marked });
      return true;
    }

    // ── POST /api/notifications/:id/read ──────────────────────────────────
    const readId = extractRecordId(pathname, 'read');
    if (readId && method === 'POST') {
      try {
        sendJson(res, 200, center.markRead(readId));
      } catch {
        sendJson(res, 404, { error: `Notification ${readId} not found` });
      }
      return true;
    }

    // ── POST /api/notifications/:id/click ─────────────────────────────────
    const clickId = extractRecordId(pathname, 'click');
    if (clickId && method === 'POST') {
      try {
        sendJson(res, 200, center.markClicked(clickId));
      } catch {
        sendJson(res, 404, { error: `Notification ${clickId} not found` });
      }
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  };
}
