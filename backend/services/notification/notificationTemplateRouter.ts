/**
 * notificationTemplateRouter (#1748)
 *
 * Plain Node.js HTTP handler for notification template versioning and rollback.
 * Mounts under `/api/notification-templates` in server.ts.
 *
 * Routes
 * ──────
 *   GET    /api/notification-templates                              List template keys
 *   GET    /api/notification-templates/:type/:channel               Current version
 *   GET    /api/notification-templates/:type/:channel/versions      Full history
 *   POST   /api/notification-templates/:type/:channel               Save a new version
 *   POST   /api/notification-templates/:type/:channel/rollback      Roll back
 *
 * All responses are JSON; errors are `{ error: string }`.
 */

import type http from 'node:http';
import { URL } from 'node:url';

import type { NotificationChannel, NotificationType } from '../../../src/types/notification';
import {
  TemplateVersionError,
  type NotificationTemplateVersionService,
} from '../notification/notificationTemplateVersionService';

const PREFIX = '/api/notification-templates';

const TYPES: readonly NotificationType[] = [
  'renewal_reminder',
  'charge_success',
  'charge_failed',
  'dunning',
  'trial_ending',
  'security_alert',
  'product_update',
  'promotion',
  'digest',
];

const CHANNELS: readonly NotificationChannel[] = ['email', 'push', 'sms', 'in_app'];

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
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
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Split `/api/notification-templates/:type/:channel[/sub]` into its parts. */
function parsePath(pathname: string): {
  type: string;
  channel: string;
  sub?: string;
} | null {
  const after = pathname.slice(PREFIX.length).replace(/^\//, '');
  if (!after) return null;
  const parts = after.split('/');
  if (parts.length < 2) return null;
  return { type: parts[0]!, channel: parts[1]!, sub: parts[2] };
}

function isType(value: string): value is NotificationType {
  return (TYPES as readonly string[]).includes(value);
}

function isChannel(value: string): value is NotificationChannel {
  return (CHANNELS as readonly string[]).includes(value);
}

function statusForError(error: unknown): number {
  if (error instanceof TemplateVersionError) {
    return error.code === 'not_found' || error.code === 'no_versions' ? 404 : 400;
  }
  return 400;
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createNotificationTemplateRouter(service: NotificationTemplateVersionService) {
  return async function handleNotificationTemplateRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    const method = req.method ?? 'GET';
    if (!pathname.startsWith(PREFIX)) return false;

    // ── GET /api/notification-templates  (list keys) ─────────────────────────
    if (pathname === PREFIX && method === 'GET') {
      sendJson(res, 200, { templates: await service.listTemplates() });
      return true;
    }

    const parsed = parsePath(pathname);
    if (!parsed) {
      sendJson(res, 400, { error: 'Expected /:type/:channel' });
      return true;
    }

    const { type, channel, sub } = parsed;
    if (!isType(type) || !isChannel(channel)) {
      sendJson(res, 400, { error: `Unknown template: ${type}/${channel}` });
      return true;
    }

    // ── POST /:type/:channel  (save a new version) ───────────────────────────
    if (!sub && method === 'POST') {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const result = await service.saveDraft({
          type,
          channel,
          subject: String(body['subject'] ?? ''),
          body: String(body['body'] ?? ''),
          variables: Array.isArray(body['variables']) ? body['variables'].map(String) : [],
        });
        sendJson(res, result.created ? 201 : 200, {
          template: result.version,
          created: result.created,
        });
      } catch (err) {
        sendJson(res, statusForError(err), { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // ── POST /:type/:channel/rollback  (roll back) ───────────────────────────
    if (sub === 'rollback' && method === 'POST') {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        let targetVersion = parseInt(url.searchParams.get('version') ?? '', 10);

        if (!Number.isFinite(targetVersion)) {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          targetVersion = Number(body['version']);
        }
        if (!Number.isInteger(targetVersion) || targetVersion < 1) {
          sendJson(res, 400, { error: 'A positive integer version is required' });
          return true;
        }

        const restored = await service.rollback(type, channel, targetVersion);
        sendJson(res, 200, restored);
      } catch (err) {
        sendJson(res, statusForError(err), { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // ── GET /:type/:channel/versions  (full history) ─────────────────────────
    if ((sub === 'versions' || sub === undefined) && method === 'GET') {
      const versions = await service.listVersions(type, channel);
      if (sub === 'versions') {
        sendJson(res, 200, { versions });
        return true;
      }
      const current = versions.length === 0 ? null : versions[versions.length - 1];
      if (!current) {
        sendJson(res, 404, { error: `No template recorded for ${type}/${channel}` });
        return true;
      }
      sendJson(res, 200, current);
      return true;
    }

    return false;
  };
}
