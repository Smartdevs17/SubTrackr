/**
 * deliveryStatusRouter
 *
 * Plain Node.js HTTP handler exposing delivery receipts (#1749) and receiving
 * provider status callbacks. Mounts under `/api/delivery-receipts` in server.ts.
 *
 * Routes
 * ──────
 *   GET    /api/delivery-receipts?userId=…[&channel=…&limit=…]  Receipt list
 *   GET    /api/delivery-receipts/summary?userId=…              Latest per channel
 *   GET    /api/delivery-receipts/:id                           Single receipt
 *   POST   /api/delivery-receipts/status                        Provider callback
 *
 * The status callback accepts Twilio's `application/x-www-form-urlencoded`
 * payload (`MessageSid`, `MessageStatus`, `ErrorCode`) as well as JSON. Twilio
 * authenticates with HTTP Basic (account SID as username); set
 * `TWILIO_ACCOUNT_SID` to enforce that check — when unset (local dev, tests)
 * the callback is accepted without credentials.
 *
 * All responses are JSON; errors are `{ error: string }`. The callback
 * acknowledges unknown message SIDs with 202 so providers do not retry forever.
 */

import type http from 'node:http';
import { URL } from 'node:url';

import {
  normalizeProviderStatus,
  type DeliveryReceiptService,
  type DeliveryReceiptStatus,
} from '../notification/deliveryReceiptService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHANNELS = ['email', 'push', 'sms', 'in_app'] as const;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readRawBody(req: http.IncomingMessage, maxBytes = 64_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
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
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Parse a status callback body.
 *
 * Twilio posts `application/x-www-form-urlencoded`; other integrations may use
 * JSON. A JSON body is detected by its leading `{`; anything else is treated as
 * form data so a stray content-type header cannot desync the parser.
 */
export function parseStatusCallback(
  raw: string,
  contentType: string | undefined
): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const looksJson = trimmed.startsWith('{') || (contentType ?? '').includes('application/json');
  if (looksJson) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, value == null ? '' : String(value)])
      );
    } catch {
      // Fall through to form parsing — some senders set a JSON content-type on
      // a form body.
    }
  }

  return Object.fromEntries(new URLSearchParams(trimmed).entries());
}

/**
 * Twilio posts the account SID as HTTP Basic username with an empty password.
 * Mirrors `isAuthorisedTwilioRequest` in the preferences controller.
 */
export function isAuthorisedCallback(
  authorizationHeader: string | undefined,
  expectedAccountSid: string
): boolean {
  if (!authorizationHeader) return false;
  const [scheme, encoded] = authorizationHeader.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  return (separator === -1 ? decoded : decoded.slice(0, separator)) === expectedAccountSid;
}

function extractId(pathname: string, prefix: string): string | null {
  const after = pathname.slice(prefix.length);
  if (!after || after === '/') return null;
  const segment = after.replace(/^\//, '').split('/')[0];
  return segment || null;
}

// ─── Router factory ───────────────────────────────────────────────────────────

export interface DeliveryStatusRouterOptions {
  /** Expected Twilio Account SID; when omitted the callback skips auth. */
  accountSid?: string;
}

export function createDeliveryStatusRouter(
  service: DeliveryReceiptService,
  options: DeliveryStatusRouterOptions = {}
) {
  const PREFIX = '/api/delivery-receipts';

  return async function handleDeliveryStatusRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    const method = req.method ?? 'GET';
    if (!pathname.startsWith(PREFIX)) return false;

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // ── POST /api/delivery-receipts/status  (provider callback) ───────────────
    if (pathname === `${PREFIX}/status` && method === 'POST') {
      if (options.accountSid) {
        if (!isAuthorisedCallback(req.headers.authorization, options.accountSid)) {
          sendJson(res, 401, { error: 'Unauthorized' });
          return true;
        }
      }

      let parsed: Record<string, string>;
      try {
        parsed = parseStatusCallback(
          await readRawBody(req),
          req.headers['content-type']
        );
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
        return true;
      }

      const providerMessageId = parsed['MessageSid'] ?? parsed['messageSid'] ?? parsed['providerMessageId'];
      const rawStatus = parsed['MessageStatus'] ?? parsed['messageStatus'] ?? parsed['status'];
      if (!providerMessageId || !rawStatus) {
        sendJson(res, 400, { error: 'MessageSid and MessageStatus are required' });
        return true;
      }

      const status = normalizeProviderStatus(rawStatus);
      if (!status) {
        // Recognised shape but a status we do not model — ack and move on.
        sendJson(res, 202, { accepted: false, reason: `Unhandled status: ${rawStatus}` });
        return true;
      }

      const errorCode = parsed['ErrorCode'] ?? parsed['errorCode'];
      const updated = await service.applyStatusUpdate({
        providerMessageId,
        status,
        detail: errorCode ? `Provider error code ${errorCode}` : undefined,
        errorCode: errorCode || undefined,
      });
      if (!updated) {
        sendJson(res, 202, { accepted: false, reason: 'Unknown message id' });
        return true;
      }
      sendJson(res, 200, updated);
      return true;
    }

    // ── GET /api/delivery-receipts/summary?userId=…  ──────────────────────────
    if (pathname === `${PREFIX}/summary` && method === 'GET') {
      const userId = url.searchParams.get('userId');
      if (!userId) {
        sendJson(res, 400, { error: 'userId query parameter is required' });
        return true;
      }
      sendJson(res, 200, await service.summarize(userId));
      return true;
    }

    // ── GET /api/delivery-receipts?userId=…  (list) ───────────────────────────
    if (pathname === PREFIX && method === 'GET') {
      const userId = url.searchParams.get('userId');
      if (!userId) {
        sendJson(res, 400, { error: 'userId query parameter is required' });
        return true;
      }
      const rawChannel = url.searchParams.get('channel');
      if (rawChannel && !CHANNELS.includes(rawChannel as (typeof CHANNELS)[number])) {
        sendJson(res, 400, { error: `Unknown channel: ${rawChannel}` });
        return true;
      }
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit ? Math.min(Math.max(parseInt(rawLimit, 10) || 0, 0), 200) : undefined;

      sendJson(
        res,
        200,
        await service.listForUser(userId, {
          channel: (rawChannel as (typeof CHANNELS)[number]) || undefined,
          limit,
        })
      );
      return true;
    }

    const id = extractId(pathname, PREFIX);

    // ── GET /api/delivery-receipts/:id  (single) ──────────────────────────────
    if (id && method === 'GET') {
      const receipt = await service.get(id);
      if (!receipt) {
        sendJson(res, 404, { error: `Receipt not found: ${id}` });
      } else {
        sendJson(res, 200, receipt);
      }
      return true;
    }

    return false;
  };
}

export type { DeliveryReceiptStatus };
