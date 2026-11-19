/**
 * smsConsentRouter (#1747)
 *
 * Plain Node.js HTTP handler for the SMS consent ledger. Mounts under
 * `/api/sms-consent` in server.ts.
 *
 * Routes
 * ──────
 *   GET    /api/sms-consent/:phone                 Current consent record
 *   GET    /api/sms-consent/:phone/events          Consent audit trail
 *   GET    /api/sms-consent/user/:userId           Records owned by a user
 *   POST   /api/sms-consent/:phone/opt-out         Record an opt-out
 *   POST   /api/sms-consent/:phone/opt-in          Record an opt-in
 *
 * The opt-in/opt-out endpoints are for web forms and admin actions; inbound
 * STOP/START is written by `SmsInboundHandler` directly. All responses are
 * JSON; errors are `{ error: string }`.
 */

import type http from 'node:http';

import {
  type ConsentSource,
  type SmsConsentService,
} from './smsConsentService';

const PREFIX = '/api/sms-consent';

const SOURCES: readonly ConsentSource[] = [
  'web_form',
  'inbound_sms',
  'admin',
  'import',
  'api',
  'system',
];

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: http.IncomingMessage, maxBytes = 32_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
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
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Split `/api/sms-consent/…` into its path segments. */
function segments(pathname: string): string[] {
  return pathname.slice(PREFIX.length).replace(/^\//, '').split('/').filter(Boolean);
}

function isSource(value: string): value is ConsentSource {
  return (SOURCES as readonly string[]).includes(value);
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createSmsConsentRouter(service: SmsConsentService) {
  return async function handleSmsConsentRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    const method = req.method ?? 'GET';
    if (!pathname.startsWith(PREFIX)) return false;

    const parts = segments(pathname);
    if (parts.length === 0) {
      sendJson(res, 400, { error: 'A phone number or /user/:userId is required' });
      return true;
    }

    // ── GET /api/sms-consent/user/:userId  (records owned by a user) ─────────
    if (parts[0] === 'user' && parts.length === 2 && method === 'GET') {
      sendJson(res, 200, { consents: await service.listForUser(parts[1]!) });
      return true;
    }

    const phone = decodeURIComponent(parts[0]!);
    const sub = parts[1];

    // ── GET /api/sms-consent/:phone  (current record) ────────────────────────
    if (!sub && method === 'GET') {
      const consent = await service.getConsent(phone);
      if (!consent) {
        sendJson(res, 404, { error: `No consent record for ${phone}` });
      } else {
        sendJson(res, 200, consent);
      }
      return true;
    }

    // ── GET /api/sms-consent/:phone/events  (audit trail) ────────────────────
    if (sub === 'events' && method === 'GET') {
      sendJson(res, 200, { events: await service.listEvents(phone) });
      return true;
    }

    // ── POST /api/sms-consent/:phone/opt-out | /opt-in ───────────────────────
    if ((sub === 'opt-out' || sub === 'opt-in') && method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const rawSource = body['source'] !== undefined ? String(body['source']) : 'web_form';
        if (!isSource(rawSource)) {
          sendJson(res, 400, { error: `Unknown source: ${rawSource}` });
          return true;
        }
        const options = {
          userId: body['userId'] !== undefined ? String(body['userId']) : null,
          reason: body['reason'] !== undefined ? String(body['reason']) : undefined,
        };
        const consent =
          sub === 'opt-out'
            ? await service.optOut(phone, rawSource, options)
            : await service.optIn(phone, rawSource, options);
        sendJson(res, 200, consent);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    return false;
  };
}
