/**
 * revenueByCurrencyRouter
 *
 * Plain Node.js HTTP handler for the revenue-by-currency report endpoint.
 * Mounts under `/reports/revenue-by-currency` in server.ts.
 *
 * Routes
 * ──────
 *   GET /reports/revenue-by-currency?merchantId=…&format=json  (default)
 *   GET /reports/revenue-by-currency?merchantId=…&format=csv
 *
 * The `format` query parameter selects JSON (default) or CSV export.
 * CSV responses use `text/csv` content-type with a `Content-Disposition`
 * header for download. JSON responses use `application/json`.
 */

import type http from 'node:http';
import { URL } from 'node:url';
import type {
  RevenueByCurrencyReportService,
  SubscriptionRevenueInput,
  ExportFormat,
} from './revenueByCurrencyReport';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

function sendCsv(res: http.ServerResponse, csv: string, filename: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  res.end(csv);
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Factory that returns the subscriptions for a merchant.
 * In production this would call the subscription repository; in tests a
 * stub can be injected.
 */
export type SubscriptionProvider = (
  merchantId: string
) => SubscriptionRevenueInput[] | Promise<SubscriptionRevenueInput[]>;

// ─── Router factory ───────────────────────────────────────────────────────────

export function createRevenueByCurrencyRouter(
  service: RevenueByCurrencyReportService,
  subscriptionProvider: SubscriptionProvider
) {
  const PREFIX = '/reports/revenue-by-currency';

  /**
   * Handle a request if it matches the `/reports/revenue-by-currency` prefix.
   * Returns `true` when handled, `false` to fall through.
   */
  return async function handleRevenueByCurrencyRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    const method = req.method ?? 'GET';

    if (!pathname.startsWith(PREFIX)) return false;

    // Only GET is supported.
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed. Use GET.' });
      return true;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const merchantId = url.searchParams.get('merchantId') ?? '';
    const formatParam = url.searchParams.get('format') ?? 'json';

    if (!merchantId) {
      sendJson(res, 400, { error: 'merchantId query parameter is required' });
      return true;
    }

    const format: ExportFormat = formatParam === 'csv' ? 'csv' : 'json';

    try {
      const subscriptions = await subscriptionProvider(merchantId);
      const report = service.generateReport(subscriptions, merchantId);

      if (format === 'csv') {
        const csv = service.exportReport(report, 'csv');
        const date = new Date().toISOString().slice(0, 10);
        sendCsv(res, csv, `revenue-by-currency_${merchantId}_${date}.csv`);
      } else {
        sendJson(res, 200, report);
      }
      return true;
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
      return true;
    }
  };
}
