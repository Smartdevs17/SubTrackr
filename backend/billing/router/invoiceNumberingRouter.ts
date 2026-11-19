/**
 * invoiceNumberingRouter (#1738)
 *
 * Plain Node.js HTTP handler for per-merchant invoice numbering schemes.
 * Mounts under `/invoice-numbering` in server.ts (same handler pattern as
 * `/overdue-reminders` and `/scheduled-reports`).
 *
 * Routes
 * ──────
 *   GET /invoice-numbering?merchantId=…   Current scheme (or built-in defaults)
 *   PUT /invoice-numbering                Configure a merchant's scheme
 *
 * All endpoints return JSON. Errors are returned as `{ error: string }`.
 */

import type http from 'node:http';
import { URL } from 'node:url';
import {
  InvoiceNumberingValidationError,
  type InvoiceNumberingService,
} from '../domain/InvoiceNumberingService';

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

export function createInvoiceNumberingRouter(service: InvoiceNumberingService) {
  const PREFIX = '/invoice-numbering';

  return async function handleInvoiceNumberingRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    const method = req.method ?? 'GET';

    if (!pathname.startsWith(PREFIX)) return false;
    if (pathname.slice(PREFIX.length) !== '') return false;

    // ── GET /invoice-numbering?merchantId=…  (current scheme) ───────────────
    if (method === 'GET') {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const merchantId = url.searchParams.get('merchantId') ?? '';
      if (!merchantId) {
        sendJson(res, 400, { error: 'merchantId query parameter is required' });
        return true;
      }
      try {
        sendJson(res, 200, await service.getScheme(merchantId));
      } catch (err) {
        const status = err instanceof InvoiceNumberingValidationError ? 400 : 500;
        sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    // ── PUT /invoice-numbering  (configure) ──────────────────────────────────
    if (method === 'PUT') {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const merchantId = String(body['merchantId'] ?? '');
        const patch = body['scheme'] !== undefined ? body['scheme'] : body;
        const view = await service.configureScheme(merchantId, patch);
        sendJson(res, 200, view);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status =
          err instanceof InvoiceNumberingValidationError || /Invalid JSON|body too large/.test(message)
            ? 400
            : 500;
        sendJson(res, status, { error: message });
      }
      return true;
    }

    sendJson(res, 405, { error: `Method not allowed: ${method}` });
    return true;
  };
}
