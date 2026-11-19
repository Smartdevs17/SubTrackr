/**
 * mrrDashboardRouter
 *
 * Plain Node.js HTTP handler for the MRR/ARR dashboard (issue #1754).
 * Mounts under `/analytics/mrr` in server.ts.
 *
 * Routes
 * ──────
 *   GET  /analytics/mrr?merchantId=…
 *        Full dashboard snapshot: MRR, ARR, movement breakdown,
 *        revenue trend, churn summary, and forecast.
 *
 *   GET  /analytics/mrr/breakdown?merchantId=…
 *        MRR movement (new / expansion / contraction / churn / net).
 *
 *   GET  /analytics/mrr/arr?merchantId=…
 *        ARR summary (ARR, growth rate, implied monthly growth).
 *
 *   GET  /analytics/mrr/trend?merchantId=…&months=6
 *        Revenue trend points for the last N months.
 *
 *   GET  /analytics/mrr/export?merchantId=…&format=csv|json
 *        Downloadable full report (CSV or JSON).
 *
 *   POST /analytics/mrr/subscriptions
 *        Upsert the caller's subscription list used for computation.
 *        Body: { merchantId: string; subscriptions: Subscription[]; prevSubscriptions?: Subscription[] }
 *
 * All JSON responses follow { success, data } | { success, error }.
 *
 * The router is stateless regarding subscriptions — callers POST their
 * subscription lists in the request body. For a live deployment, replace
 * the body-parsing path with a repository lookup.
 */

import type http from 'node:http';
import { URL } from 'node:url';
import {
  subscriptionAnalyticsService,
  type AnalyticsQuery,
} from '../services/analytics/subscriptionAnalyticsService';
import type { Subscription } from '../../src/types/subscription';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendCsv(res: http.ServerResponse, csv: string, filename: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  res.end(csv);
}

async function readJsonBody(req: http.IncomingMessage, maxBytes = 256_000): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) { reject(new Error('Request body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// In-memory subscription store keyed by merchantId.
// In production, replace with a DB repository lookup.
const subscriptionStore = new Map<string, { curr: Subscription[]; prev: Subscription[] }>();

// ─── Router ───────────────────────────────────────────────────────────────────

const PREFIX = '/analytics/mrr';

export async function mrrDashboardRouter(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string
): Promise<boolean> {
  if (!pathname.startsWith(PREFIX)) return false;

  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const subPath = pathname.slice(PREFIX.length);

  // ── POST /analytics/mrr/subscriptions ────────────────────────────────────
  if (subPath === '/subscriptions' && method === 'POST') {
    try {
      const body = await readJsonBody(req) as Record<string, unknown>;
      const merchantId = String(body['merchantId'] ?? '');
      if (!merchantId) {
        sendJson(res, 400, { success: false, error: 'merchantId is required' });
        return true;
      }
      const curr = (Array.isArray(body['subscriptions']) ? body['subscriptions'] : []) as Subscription[];
      const prev = (Array.isArray(body['prevSubscriptions']) ? body['prevSubscriptions'] : curr) as Subscription[];
      subscriptionStore.set(merchantId, { curr, prev });
      sendJson(res, 200, { success: true, data: { stored: curr.length } });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (method !== 'GET') {
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return true;
  }

  const merchantId = url.searchParams.get('merchantId') ?? '';
  if (!merchantId) {
    sendJson(res, 400, { success: false, error: 'merchantId query parameter is required' });
    return true;
  }

  const stored = subscriptionStore.get(merchantId) ?? { curr: [], prev: [] };
  const query: AnalyticsQuery = { merchantId };
  const envelope = subscriptionAnalyticsService.compute(stored.curr, query);

  // ── GET /analytics/mrr/breakdown ─────────────────────────────────────────
  if (subPath === '/breakdown') {
    const breakdown = subscriptionAnalyticsService.mrrBreakdown(stored.prev, stored.curr);
    sendJson(res, 200, { success: true, data: breakdown });
    return true;
  }

  // ── GET /analytics/mrr/arr ────────────────────────────────────────────────
  if (subPath === '/arr') {
    const arr = subscriptionAnalyticsService.arrSummary(envelope);
    sendJson(res, 200, { success: true, data: arr });
    return true;
  }

  // ── GET /analytics/mrr/trend ──────────────────────────────────────────────
  if (subPath === '/trend') {
    const months = Math.min(Math.max(parseInt(url.searchParams.get('months') ?? '6', 10), 1), 24);
    const trend = subscriptionAnalyticsService.revenueTrend(envelope.report, months);
    sendJson(res, 200, { success: true, data: trend });
    return true;
  }

  // ── GET /analytics/mrr/export ─────────────────────────────────────────────
  if (subPath === '/export') {
    const format = url.searchParams.get('format') ?? 'csv';
    const date = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="mrr-dashboard-${merchantId}-${date}.json"`,
      });
      res.end(JSON.stringify(envelope, null, 2));
    } else {
      const csv = subscriptionAnalyticsService.exportCsv(envelope);
      sendCsv(res, csv, `mrr-dashboard-${merchantId}-${date}.csv`);
    }
    return true;
  }

  // ── GET /analytics/mrr  (full dashboard snapshot) ────────────────────────
  if (subPath === '' || subPath === '/') {
    const breakdown = subscriptionAnalyticsService.mrrBreakdown(stored.prev, stored.curr);
    const arr = subscriptionAnalyticsService.arrSummary(envelope);
    const trend = subscriptionAnalyticsService.revenueTrend(envelope.report, 6);
    const churn = subscriptionAnalyticsService.churnSummary(envelope.report);
    const forecast = subscriptionAnalyticsService.forecastSummary(envelope.report);

    sendJson(res, 200, {
      success: true,
      data: {
        merchantId,
        computedAt: envelope.computedAt,
        durationMs: envelope.durationMs,
        mrr: envelope.report.mrr,
        arr: arr.arr,
        arrGrowthRate: arr.arrGrowthRate,
        mrrGrowthRate: envelope.report.mrrGrowthRate,
        subscriberCount: envelope.report.subscriberCount,
        arpu: envelope.report.arpu,
        ltv: envelope.report.ltv,
        breakdown,
        trend,
        churn,
        forecast,
      },
    });
    return true;
  }

  return false;
}
