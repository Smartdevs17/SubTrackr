/**
 * overdueInvoiceReminderRouter (#1737)
 *
 * Plain Node.js HTTP handler for the configurable overdue-invoice reminder
 * schedule and its per-invoice entries. Mounts under `/overdue-reminders` in
 * server.ts.
 *
 * Routes
 * ──────
 *   POST   /overdue-reminders                            Create a schedule
 *   GET    /overdue-reminders?merchantId=…               List schedules
 *   GET    /overdue-reminders/entries?…                  List reminder entries
 *   POST   /overdue-reminders/run-now                    Trigger a pass
 *   POST   /overdue-reminders/invoices/:invoiceId/stop   Stop reminders (paid)
 *   GET    /overdue-reminders/:id                        Get a schedule
 *   PATCH  /overdue-reminders/:id                        Update a schedule
 *   DELETE /overdue-reminders/:id                        Delete a schedule
 *
 * All endpoints return JSON. Errors are returned as `{ error: string }`.
 */

import type http from 'node:http';
import { URL } from 'node:url';
import type {
  OverdueInvoiceReminderService,
  OverdueInvoiceSource,
  OverdueReminderEntryStatus,
  OverdueReminderStopReason,
} from './overdueInvoiceReminderService';

const EXPLICIT_STOP_REASONS: OverdueReminderStopReason[] = [
  'paid',
  'voided',
  'cancelled',
  'settled',
];

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

function parseStages(raw: unknown): Array<{ daysOverdue: number; label: string }> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new Error('stages must be an array');
  return raw.map((stage) => {
    const record = stage as Record<string, unknown>;
    return {
      daysOverdue: Number(record['daysOverdue']),
      label: String(record['label'] ?? ''),
    };
  });
}

function parseRecipients(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new Error('recipients must be an array');
  return raw.map(String);
}

export function createOverdueInvoiceReminderRouter(
  service: OverdueInvoiceReminderService,
  source?: OverdueInvoiceSource
) {
  const PREFIX = '/overdue-reminders';

  return async function handleOverdueReminderRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    const method = req.method ?? 'GET';

    if (!pathname.startsWith(PREFIX)) return false;

    const rest = pathname.slice(PREFIX.length);

    // ── POST /overdue-reminders  (create) ────────────────────────────────────
    if (rest === '' && method === 'POST') {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const schedule = service.createSchedule({
          merchantId: String(body['merchantId'] ?? ''),
          stages: parseStages(body['stages']),
          recipients: parseRecipients(body['recipients']),
          enabled: body['enabled'] !== undefined ? Boolean(body['enabled']) : undefined,
        });
        sendJson(res, 201, schedule);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // ── GET /overdue-reminders?merchantId=…  (list) ──────────────────────────
    if (rest === '' && method === 'GET') {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const merchantId = url.searchParams.get('merchantId') ?? '';
      if (!merchantId) {
        sendJson(res, 400, { error: 'merchantId query parameter is required' });
        return true;
      }
      sendJson(res, 200, service.listSchedules(merchantId));
      return true;
    }

    // ── GET /overdue-reminders/entries  (list reminder entries) ──────────────
    if (rest === '/entries' && method === 'GET') {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const status = url.searchParams.get('status');
      if (status && status !== 'active' && status !== 'stopped') {
        sendJson(res, 400, { error: `Invalid status: ${status}` });
        return true;
      }
      sendJson(
        res,
        200,
        service.listEntries({
          merchantId: url.searchParams.get('merchantId') ?? undefined,
          invoiceId: url.searchParams.get('invoiceId') ?? undefined,
          status: (status as OverdueReminderEntryStatus | null) ?? undefined,
        })
      );
      return true;
    }

    // ── POST /overdue-reminders/run-now  (trigger a pass) ────────────────────
    if (rest === '/run-now' && method === 'POST') {
      if (!source) {
        sendJson(res, 503, { error: 'run-now is unavailable: no invoice source configured' });
        return true;
      }
      try {
        const summary = await service.runDue(source);
        sendJson(res, 200, summary);
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // ── POST /overdue-reminders/invoices/:invoiceId/stop  (stop on payment) ──
    const invoiceStop = rest.match(/^\/invoices\/([^/]+)\/stop$/);
    if (invoiceStop && method === 'POST') {
      try {
        const body = (await readJsonBody(req).catch(() => ({}))) as Record<string, unknown>;
        const reason = String(body['reason'] ?? 'paid') as OverdueReminderStopReason;
        if (!EXPLICIT_STOP_REASONS.includes(reason)) {
          sendJson(res, 400, { error: `Invalid reason: ${reason}` });
          return true;
        }
        const invoiceId = decodeURIComponent(invoiceStop[1]);
        const stopped = service.stopReminders(invoiceId, reason);
        if (stopped) {
          sendJson(res, 200, { invoiceId, stopped: true, reason });
        } else {
          sendJson(res, 404, { error: `No active reminders for invoice ${invoiceId}` });
        }
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    const id = rest.replace(/^\//, '').split('/')[0];
    if (!id) return false;
    const isSingle = rest === `/${id}`;

    // ── GET /overdue-reminders/:id  (get single) ─────────────────────────────
    if (isSingle && method === 'GET') {
      const schedule = service.getSchedule(id);
      if (!schedule) {
        sendJson(res, 404, { error: `Schedule not found: ${id}` });
      } else {
        sendJson(res, 200, schedule);
      }
      return true;
    }

    // ── PATCH /overdue-reminders/:id  (update) ───────────────────────────────
    if (isSingle && method === 'PATCH') {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const updated = service.updateSchedule(id, {
          stages: parseStages(body['stages']),
          recipients: parseRecipients(body['recipients']),
          enabled: body['enabled'] !== undefined ? Boolean(body['enabled']) : undefined,
        });
        sendJson(res, 200, updated);
      } catch (err) {
        const status = /not found/i.test(String(err)) ? 404 : 400;
        sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // ── DELETE /overdue-reminders/:id  (delete) ──────────────────────────────
    if (isSingle && method === 'DELETE') {
      const deleted = service.deleteSchedule(id);
      if (!deleted) {
        sendJson(res, 404, { error: `Schedule not found: ${id}` });
      } else {
        sendJson(res, 204, null);
      }
      return true;
    }

    if (isSingle) {
      sendJson(res, 405, { error: `Method not allowed: ${method}` });
      return true;
    }

    return false;
  };
}
