/**
 * scheduledReportRouter
 *
 * Plain Node.js HTTP handler for managing scheduled email report schedules
 * and their recipient lists.  Mounts under `/scheduled-reports` in server.ts.
 *
 * Routes
 * ──────
 *   POST   /scheduled-reports                       Create a new schedule
 *   GET    /scheduled-reports?merchantId=…          List schedules for a merchant
 *   GET    /scheduled-reports/:id                   Get a single schedule
 *   PATCH  /scheduled-reports/:id                   Update a schedule
 *   DELETE /scheduled-reports/:id                   Delete a schedule
 *
 *   POST   /scheduled-reports/:id/recipients        Add recipients
 *   DELETE /scheduled-reports/:id/recipients        Remove recipients
 *
 *   POST   /scheduled-reports/:id/send-now          Trigger an immediate send
 *
 * All endpoints return JSON.  Errors are returned as `{ error: string }`.
 */

import type http from 'node:http';
import { URL } from 'node:url';
import type { ScheduledReportService, ReportAnalyticsSnapshot } from '../scheduledReportService';
import type { SnapshotFactory } from '../jobs/scheduledReportJob';

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
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Extract the last path segment from a pathname like /scheduled-reports/:id */
function extractId(pathname: string, prefix: string): string | null {
  const after = pathname.slice(prefix.length);
  if (!after || after === '/') return null;
  const segment = after.replace(/^\//, '').split('/')[0];
  return segment || null;
}

/** True when the segment after `/:id` equals `sub`. */
function hasSubPath(pathname: string, prefix: string, sub: string): boolean {
  const after = pathname.slice(prefix.length).replace(/^\//, '');
  const parts = after.split('/');
  return parts.length === 2 && parts[1] === sub;
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createScheduledReportRouter(
  service: ScheduledReportService,
  snapshotFactory: SnapshotFactory
) {
  const PREFIX = '/scheduled-reports';

  /**
   * Handle a request if it matches the `/scheduled-reports` prefix.
   * Returns `true` when the request was handled (caller should return).
   * Returns `false` to let the caller fall through to the next handler.
   */
  return async function handleScheduledReportRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    const method = req.method ?? 'GET';

    if (!pathname.startsWith(PREFIX)) return false;

    // ── POST /scheduled-reports  (create) ────────────────────────────────────
    if (pathname === PREFIX && method === 'POST') {
      try {
        const body = await readJsonBody(req) as Record<string, unknown>;
        const schedule = service.createSchedule({
          merchantId: String(body['merchantId'] ?? ''),
          name: String(body['name'] ?? ''),
          reportType: body['reportType'] as never,
          frequency: body['frequency'] as never,
          recipients: Array.isArray(body['recipients']) ? body['recipients'].map(String) : [],
          startAt: body['startAt'] ? String(body['startAt']) : undefined,
        });
        sendJson(res, 201, schedule);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // ── GET /scheduled-reports?merchantId=…  (list) ──────────────────────────
    if (pathname === PREFIX && method === 'GET') {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const merchantId = url.searchParams.get('merchantId') ?? '';
      if (!merchantId) {
        sendJson(res, 400, { error: 'merchantId query parameter is required' });
        return true;
      }
      sendJson(res, 200, service.listSchedules(merchantId));
      return true;
    }

    const id = extractId(pathname, PREFIX);

    // ── POST /scheduled-reports/:id/recipients  (add recipients) ─────────────
    if (id && hasSubPath(pathname, PREFIX, 'recipients') && method === 'POST') {
      try {
        const body = await readJsonBody(req) as Record<string, unknown>;
        const emails = Array.isArray(body['emails']) ? body['emails'].map(String) : [];
        const updated = service.addRecipients(id, emails);
        sendJson(res, 200, updated);
      } catch (err) {
        const status = /not found/i.test(String(err)) ? 404 : 400;
        sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // ── DELETE /scheduled-reports/:id/recipients  (remove recipients) ─────────
    if (id && hasSubPath(pathname, PREFIX, 'recipients') && method === 'DELETE') {
      try {
        const body = await readJsonBody(req) as Record<string, unknown>;
        const emails = Array.isArray(body['emails']) ? body['emails'].map(String) : [];
        const updated = service.removeRecipients(id, emails);
        sendJson(res, 200, updated);
      } catch (err) {
        const status = /not found/i.test(String(err)) ? 404 : 400;
        sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // ── POST /scheduled-reports/:id/send-now  (trigger immediate send) ────────
    if (id && hasSubPath(pathname, PREFIX, 'send-now') && method === 'POST') {
      const schedule = service.getSchedule(id);
      if (!schedule) {
        sendJson(res, 404, { error: `Schedule not found: ${id}` });
        return true;
      }
      try {
        const snapshot = await snapshotFactory(schedule.merchantId);
        const result = await service.sendReport(schedule, snapshot);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    if (!id) return false;

    // ── GET /scheduled-reports/:id  (get single) ─────────────────────────────
    if (method === 'GET') {
      const schedule = service.getSchedule(id);
      if (!schedule) {
        sendJson(res, 404, { error: `Schedule not found: ${id}` });
      } else {
        sendJson(res, 200, schedule);
      }
      return true;
    }

    // ── PATCH /scheduled-reports/:id  (update) ────────────────────────────────
    if (method === 'PATCH') {
      try {
        const body = await readJsonBody(req) as Record<string, unknown>;
        const updated = service.updateSchedule(id, {
          name: body['name'] !== undefined ? String(body['name']) : undefined,
          reportType: body['reportType'] as never,
          frequency: body['frequency'] as never,
          enabled: body['enabled'] !== undefined ? Boolean(body['enabled']) : undefined,
        });
        sendJson(res, 200, updated);
      } catch (err) {
        const status = /not found/i.test(String(err)) ? 404 : 400;
        sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // ── DELETE /scheduled-reports/:id  (delete) ───────────────────────────────
    if (method === 'DELETE') {
      const deleted = service.deleteSchedule(id);
      if (!deleted) {
        sendJson(res, 404, { error: `Schedule not found: ${id}` });
      } else {
        sendJson(res, 204, null);
      }
      return true;
    }

    return false;
  };
}
