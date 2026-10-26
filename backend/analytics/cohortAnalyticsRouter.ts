/**
 * cohortAnalyticsRouter
 *
 * Plain Node.js HTTP handler for cohort retention and churn analytics.
 * Mounts under `/analytics/cohorts` in server.ts.
 *
 * Routes
 * ──────
 *   GET  /analytics/cohorts?merchantId=…&granularity=month|week
 *        Cohort table grouped by signup period
 *
 *   GET  /analytics/cohorts/retention?merchantId=…
 *        Day 1/7/30/60/90 retention curve
 *
 *   GET  /analytics/cohorts/churn?merchantId=…&from=<epochMs>&to=<epochMs>
 *        Revenue churn vs logo churn breakdown for a period
 *
 *   GET  /analytics/cohorts/export?merchantId=…&granularity=month|week&format=csv|pdf
 *        Downloadable cohort table (CSV or PDF)
 *
 *   GET  /analytics/cohorts/mrr?merchantId=…
 *        MRR / ARR / ARPU / LTV summary
 *
 *   POST /analytics/cohorts/subscribers
 *        Upsert a subscriber record (seed data into the in-memory store)
 *        Body: SubscriberRecord (JSON)
 *
 * All JSON responses follow { success, data } | { success, error }.
 * Export responses stream file bytes with Content-Disposition for download.
 */

import type http from 'node:http';
import { URL } from 'node:url';
import { analyticsDashboardApi } from '../services/analytics/analyticsDashboardApi';
import { subscriberRecordRepository } from '../services/analytics/subscriberRecordRepository';
import type { CohortGranularity, AnalyticsExportFormat } from '../../src/types/cohortAnalytics';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Router ───────────────────────────────────────────────────────────────────

const PREFIX = '/analytics/cohorts';

export async function cohortAnalyticsRouter(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string
): Promise<boolean> {
  if (!pathname.startsWith(PREFIX)) return false;

  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const merchantId = url.searchParams.get('merchantId') ?? '';
  const subPath = pathname.slice(PREFIX.length); // e.g. '', '/retention', '/churn', ...

  // ── POST /analytics/cohorts/subscribers  (seed/upsert a subscriber record) ─
  if (subPath === '/subscribers' && method === 'POST') {
    try {
      const body = await readJsonBody(req) as Record<string, unknown>;
      subscriberRecordRepository.upsert(body as never);
      sendJson(res, 200, { success: true, data: { upserted: true } });
    } catch (err) {
      sendJson(res, 400, { success: false, error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (method !== 'GET') {
    sendJson(res, 405, { success: false, error: 'Method not allowed' });
    return true;
  }

  if (!merchantId) {
    sendJson(res, 400, { success: false, error: 'merchantId query parameter is required' });
    return true;
  }

  // ── GET /analytics/cohorts/retention ──────────────────────────────────────
  if (subPath === '/retention') {
    const result = analyticsDashboardApi.getRetentionCurve(merchantId);
    sendJson(res, result.success ? 200 : 500, result);
    return true;
  }

  // ── GET /analytics/cohorts/churn ──────────────────────────────────────────
  if (subPath === '/churn') {
    const from = parseInt(url.searchParams.get('from') ?? '0', 10);
    const to = parseInt(url.searchParams.get('to') ?? String(Date.now()), 10);
    const result = analyticsDashboardApi.getChurnBreakdown(merchantId, from, to);
    sendJson(res, result.success ? 200 : 500, result);
    return true;
  }

  // ── GET /analytics/cohorts/export ─────────────────────────────────────────
  if (subPath === '/export') {
    const granularity = (url.searchParams.get('granularity') ?? 'month') as CohortGranularity;
    const format = (url.searchParams.get('format') ?? 'csv') as AnalyticsExportFormat;
    const result = analyticsDashboardApi.exportCohortReport(merchantId, granularity, format);
    if (!result.success || !result.data) {
      sendJson(res, 500, result);
      return true;
    }
    const { filename, contentType, body } = result.data;
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.end(body);
    return true;
  }

  // ── GET /analytics/cohorts/mrr ────────────────────────────────────────────
  if (subPath === '/mrr') {
    const result = analyticsDashboardApi.getMrrArrReport(merchantId);
    sendJson(res, result.success ? 200 : 500, result);
    return true;
  }

  // ── GET /analytics/cohorts  (cohort table — default) ──────────────────────
  if (subPath === '' || subPath === '/') {
    const granularity = (url.searchParams.get('granularity') ?? 'month') as CohortGranularity;
    const result = analyticsDashboardApi.getCohortTable(merchantId, granularity);
    sendJson(res, result.success ? 200 : 500, result);
    return true;
  }

  return false;
}
