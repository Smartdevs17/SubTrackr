/**
 * taxExemptionRouter (#1740)
 *
 * Plain Node.js HTTP handler for per-customer tax exemption flags.
 * Mounts under `/tax-exemptions` in server.ts (same handler pattern as
 * `/invoice-numbering` and `/overdue-reminders`).
 *
 * Routes
 * ──────
 *   PUT  /tax-exemptions                     Set a customer's flag (audited, reason required)
 *   GET  /tax-exemptions/:customerId         Current status (or null when never set)
 *   GET  /tax-exemptions/:customerId/audit   Audit-trail entries for the customer
 *
 * All endpoints return JSON. Errors are returned as `{ error: string }`.
 */

import type http from 'node:http';
import {
  TaxExemptionValidationError,
  type TaxExemptionService,
  type SetTaxExemptionInput,
} from './taxExemptionService';

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

function clientIp(req: http.IncomingMessage, bodyValue: unknown): string | undefined {
  if (typeof bodyValue === 'string' && bodyValue.trim()) return bodyValue.trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? undefined;
}

function clientUserAgent(req: http.IncomingMessage, bodyValue: unknown): string | undefined {
  if (typeof bodyValue === 'string' && bodyValue.trim()) return bodyValue.trim();
  const agent = req.headers['user-agent'];
  return typeof agent === 'string' && agent.trim() ? agent : undefined;
}

function errorStatus(err: unknown): number {
  const message = err instanceof Error ? err.message : String(err);
  return err instanceof TaxExemptionValidationError || /Invalid JSON|body too large/.test(message)
    ? 400
    : 500;
}

export function createTaxExemptionRouter(service: TaxExemptionService) {
  const PREFIX = '/tax-exemptions';

  return async function handleTaxExemptionRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    const method = req.method ?? 'GET';
    if (!pathname.startsWith(PREFIX)) return false;

    const rest = pathname.slice(PREFIX.length);

    // ── PUT /tax-exemptions  (set the per-customer flag) ─────────────────────
    if (rest === '') {
      if (method !== 'PUT') {
        sendJson(res, 405, { error: `Method not allowed: ${method}` });
        return true;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const input: SetTaxExemptionInput = {
          isExempt: body['isExempt'] as boolean,
          certificateId: body['certificateId'] as string | undefined,
          certificateExpiry: body['certificateExpiry'] as number | undefined,
          issuingAuthority: body['issuingAuthority'] as string | undefined,
          exemptJurisdictions: body['exemptJurisdictions'] as string[] | undefined,
          actorId: body['actorId'] as string | undefined,
          reason: String(body['reason'] ?? ''),
          ipAddress: clientIp(req, body['ipAddress']),
          userAgent: clientUserAgent(req, body['userAgent']),
        };
        const result = await service.set(String(body['customerId'] ?? ''), input);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, errorStatus(err), {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    // ── GET /tax-exemptions/:customerId/audit  (audit trail) ─────────────────
    const auditMatch = /^\/([^/]+)\/audit$/.exec(rest);
    if (auditMatch) {
      if (method !== 'GET') {
        sendJson(res, 405, { error: `Method not allowed: ${method}` });
        return true;
      }
      const customerId = auditMatch[1];
      try {
        sendJson(res, 200, { customerId, entries: service.listAudit(customerId) });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // ── GET /tax-exemptions/:customerId  (current status) ────────────────────
    const idMatch = /^\/([^/]+)$/.exec(rest);
    if (idMatch) {
      if (method !== 'GET') {
        sendJson(res, 405, { error: `Method not allowed: ${method}` });
        return true;
      }
      const customerId = idMatch[1];
      try {
        const status = await service.get(customerId);
        sendJson(res, 200, { customerId, status, isExempt: status?.isExempt ?? false });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    return false;
  };
}
