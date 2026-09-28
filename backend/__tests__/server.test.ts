/**
 * Backend server integration tests (no real Redis/Postgres required).
 */

import http from 'node:http';
import { startServer } from '../server';
import type { Pool } from '../shared/db/connectionPool';
import { PlanCacheService } from '../subscription/domain/PlanCacheService';
import { InMemoryPlanRepository } from '../subscription/domain/PlanRepository';
import type { PlanMetadata } from '../subscription/domain/types';
import type { RedisClient } from '../shared/cache/types';
import { setPlanCacheService } from '../subscription/planCacheRegistry';
import { buildMetricsService } from '../services/shared/buildMetricsService';
import { rateLimitingService } from '../services/shared/rateLimitingService';

class FakeRedis implements RedisClient {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _mode: 'EX', _ttl: number): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k)) n++;
    }
    return n;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace(/\*$/, '');
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }
}

const seedPlan: PlanMetadata = {
  id: 'plan-1',
  name: 'Starter',
  price: 9,
  currency: 'USD',
  billingCycle: 'monthly',
  features: ['basic'],
  limits: {},
  isActive: true,
  metadata: {},
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function makeMockPool(): Pool {
  return {
    query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  } as unknown as Pool;
}

function makeBootstrap(repository = new InMemoryPlanRepository([seedPlan])) {
  const redis = new FakeRedis();
  const planCache = new PlanCacheService(redis, repository);
  return { planCache, redis, repository };
}

/** `undefined` sends no body; a string is sent verbatim so tests can post bad JSON. */
function encodeBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  return typeof body === 'string' ? body : JSON.stringify(body);
}

function request(
  port: number,
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const payload = encodeBody(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              ...headers,
            }
          : headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
            ),
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listenEphemeral(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

describe('backend server', () => {
  afterEach(() => {
    setPlanCacheService(null);
  });

  it('serves health, plan REST, and plan cache metrics', async () => {
    const pool = makeMockPool();
    const planBootstrap = makeBootstrap();

    const running = await startServer({ pool, planBootstrap, listen: false });
    const port = await listenEphemeral(running.server);

    const health = await request(port, '/health');
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body).status).toBe('ok');

    const plan = await request(port, '/plans/plan-1');
    expect(plan.status).toBe(200);
    expect(JSON.parse(plan.body).data.name).toBe('Starter');

    const metrics = await request(port, '/metrics/plan-cache');
    expect(metrics.status).toBe(200);
    expect(metrics.body).toContain('subtrackr_plan_cache_hits_total');

    await running.shutdown();
  });

  it('creates a plan via POST /plans with write-through cache', async () => {
    const pool = makeMockPool();
    const planBootstrap = makeBootstrap(new InMemoryPlanRepository());

    const running = await startServer({ pool, planBootstrap, listen: false });
    const port = await listenEphemeral(running.server);

    const created = await request(port, '/plans', 'POST', {
      name: 'Growth',
      price: 25,
      currency: 'USD',
      billingCycle: 'monthly',
    });

    expect(created.status).toBe(201);
    const parsed = JSON.parse(created.body);
    expect(parsed.data.name).toBe('Growth');

    await running.shutdown();
  });

  it('exposes build metrics in Prometheus and JSON form (issue #1285)', async () => {
    const pool = makeMockPool();
    const planBootstrap = makeBootstrap();

    buildMetricsService.reset();
    buildMetricsService.recordBuildRun({
      pipeline: 'ci',
      status: 'success',
      durationMs: 1_500,
      branch: 'main',
      artifacts: [{ name: 'bundle.js', sizeBytes: 400 }],
    });

    const running = await startServer({ pool, planBootstrap, listen: false });
    const port = await listenEphemeral(running.server);

    const prometheus = await request(port, '/metrics/build');
    expect(prometheus.status).toBe(200);
    expect(prometheus.body).toContain('# TYPE subtrackr_build_runs_total counter');
    expect(prometheus.body).toContain('subtrackr_build_runs_total{pipeline="ci",status="success"} 1');
    expect(prometheus.body).toContain('subtrackr_build_duration_p95_ms{pipeline="ci"} 1500');
    // Boot is tracked as a build run, so a scrape is never empty.
    expect(prometheus.body).toContain('subtrackr_build_runs_total{pipeline="backend-bootstrap",status="success"} 1');

    const json = await request(port, '/build/metrics');
    expect(json.status).toBe(200);
    const summary = JSON.parse(json.body);
    expect(summary.pipelines.ci).toMatchObject({ totalRuns: 1, successRuns: 1, successRatePct: 100 });
    expect(summary.totalRuns).toBeGreaterThanOrEqual(2);

    await running.shutdown();
    buildMetricsService.reset();
  });

  describe('POST /build/metrics ingest (issue #1285)', () => {
    let previousToken: string | undefined;
    let shutdowns: Array<() => Promise<void>> = [];
    let tokenSeq = 0;

    beforeEach(() => {
      previousToken = process.env['BUILD_METRICS_INGEST_TOKEN'];
      buildMetricsService.reset();
      shutdowns = [];
    });

    afterEach(async () => {
      // Always tear down, even when an assertion fails, so a failing test
      // cannot leave a listening server that hangs the whole run.
      for (const shutdown of shutdowns.reverse()) {
        await shutdown();
      }
      if (previousToken === undefined) delete process.env['BUILD_METRICS_INGEST_TOKEN'];
      else process.env['BUILD_METRICS_INGEST_TOKEN'] = previousToken;
      buildMetricsService.reset();
    });

    // The ingest token is sent as `Authorization: Bearer`, which is also how the
    // rate limiter resolves a key, so each test gets its own secret — and
    // therefore its own quota bucket.
    async function serve(): Promise<{ port: number; token: string }> {
      const token = `ingest-secret-${++tokenSeq}`;
      process.env['BUILD_METRICS_INGEST_TOKEN'] = token;
      const running = await startServer({
        pool: makeMockPool(),
        planBootstrap: makeBootstrap(),
        listen: false,
      });
      shutdowns.push(running.shutdown);
      return { port: await listenEphemeral(running.server), token };
    }

    it('records runs from an authenticated report', async () => {
      const { port, token } = await serve();

      const res = await request(
        port,
        '/build/metrics',
        'POST',
        {
          runs: [
            { pipeline: 'ci', conclusion: 'success', durationMs: 4_200, ref: 'refs/heads/main' },
            { pipeline: 'ci', status: 'failure', durationMs: 900 },
          ],
        },
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(202);
      expect(JSON.parse(res.body)).toMatchObject({ accepted: 2, rejected: 0 });

      const summary = buildMetricsService.getMetrics();
      expect(summary.pipelines.ci).toMatchObject({
        totalRuns: 2,
        successRuns: 1,
        failureRuns: 1,
        successRatePct: 50,
      });
      expect(summary.pipelines.ci!.lastDurationMs).toBe(900);
      expect(summary.pipelines.ci!.lastBranch).toBe('refs/heads/main');
    });

    it('rejects a request with no or wrong token', async () => {
      const { port, token } = await serve();

      const missing = await request(port, '/build/metrics', 'POST', {
        pipeline: 'ci',
        status: 'success',
        durationMs: 10,
      });
      expect(missing.status).toBe(401);

      const wrong = await request(
        port,
        '/build/metrics',
        'POST',
        { pipeline: 'ci', status: 'success', durationMs: 10 },
        { Authorization: 'Bearer nope' },
      );
      expect(wrong.status).toBe(401);

      // A prefix of the secret must not pass the length guard.
      const prefix = await request(
        port,
        '/build/metrics',
        'POST',
        { pipeline: 'ci', status: 'success', durationMs: 10 },
        { Authorization: `Bearer ${token.slice(0, 5)}` },
      );
      expect(prefix.status).toBe(401);

      expect(buildMetricsService.getMetrics().pipelines.ci).toBeUndefined();
    });

    it('is disabled with 503 when no ingest token is configured', async () => {
      const { port, token } = await serve();
      delete process.env['BUILD_METRICS_INGEST_TOKEN'];

      const res = await request(
        port,
        '/build/metrics',
        'POST',
        { pipeline: 'ci', status: 'success', durationMs: 10 },
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(503);
    });

    it('keeps valid entries from a partly corrupt report and reports the rest', async () => {
      const { port, token } = await serve();

      const res = await request(
        port,
        '/build/metrics',
        'POST',
        [
          { pipeline: 'ci', status: 'success', durationMs: 100 },
          { pipeline: 'ci', status: 'not-a-status', durationMs: 100 },
          { status: 'success', durationMs: 100 },
          { pipeline: 'ci', status: 'success', durationMs: -5 },
        ],
        { Authorization: `Bearer ${token}` },
      );

      expect(res.status).toBe(202);
      const parsed = JSON.parse(res.body);
      expect(parsed.accepted).toBe(1);
      expect(parsed.rejected).toBe(3);
      expect(parsed.rejections.map((r: { index: number }) => r.index)).toEqual([1, 2, 3]);
      expect(parsed.rejections[0].reason).toMatch(/status/);

      expect(buildMetricsService.getMetrics().pipelines.ci).toMatchObject({ totalRuns: 1 });
    });

    it('rejects a malformed body with 400 instead of 500', async () => {
      const { port, token } = await serve();

      const res = await request(port, '/build/metrics', 'POST', '{not json', {
        Authorization: `Bearer ${token}`,
      });

      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/JSON/);
    });

    it('rejects an oversized report with 413', async () => {
      const { port, token } = await serve();

      const huge = JSON.stringify({
        runs: [
          {
            pipeline: 'ci',
            status: 'success',
            durationMs: 1,
            failureReason: 'x'.repeat(1024 * 1024 + 64),
          },
        ],
      });
      const res = await request(port, '/build/metrics', 'POST', huge, {
        Authorization: `Bearer ${token}`,
      });

      expect(res.status).toBe(413);
      expect(buildMetricsService.getMetrics().pipelines.ci).toBeUndefined();
    });
  });

  describe('rate limit metering (issue #913)', () => {
    let shutdowns: Array<() => Promise<void>> = [];

    beforeEach(() => {
      shutdowns = [];
    });

    afterEach(async () => {
      for (const shutdown of shutdowns.reverse()) {
        await shutdown();
      }
    });

    async function serve(): Promise<number> {
      const running = await startServer({
        pool: makeMockPool(),
        planBootstrap: makeBootstrap(),
        listen: false,
      });
      shutdowns.push(running.shutdown);
      return listenEphemeral(running.server);
    }

    const planBody = { name: 'Metered', price: 1, currency: 'USD', billingCycle: 'monthly' };

    it('decrements the reported remaining quota on every metered response', async () => {
      const port = await serve();
      const key = `meter-${Date.now()}`;

      const first = await request(port, '/plans', 'POST', planBody, { 'x-api-key': key });
      const second = await request(port, '/plans', 'POST', planBody, { 'x-api-key': key });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      // Headers are set from usage recorded by the *previous* response, so a
      // flat 100 here is the signature of the metering bug.
      expect(first.headers['x-ratelimit-remaining']).toBe('100');
      expect(Number(second.headers['x-ratelimit-remaining'])).toBeLessThan(100);
    });

    it('throttles a key that drains its burst bucket', async () => {
      const port = await serve();
      const key = `exhaust-${Date.now()}`;
      const statuses: number[] = [];

      // A tight loop is bounded by the token bucket (20 tokens, 1/s refill on
      // the free tier) long before the 100/hour window cap, so this asserts the
      // bucket, not the window.
      for (let i = 0; i < 130; i++) {
        const res = await request(port, '/plans', 'POST', planBody, { 'x-api-key': key });
        statuses.push(res.status);
      }

      const created = statuses.filter((s) => s === 201).length;
      expect(created).toBeGreaterThan(0);
      expect(created).toBeLessThanOrEqual(25);
      expect(statuses.filter((s) => s === 429)).toHaveLength(130 - created);
    });

    it('throttles a key that passes its hourly cap', async () => {
      const port = await serve();
      const key = `hourly-${Date.now()}`;
      // A generous bucket isolates the window cap as the only binding limit.
      rateLimitingService.setCustomLimits(key, {
        hourlyLimit: 5,
        burstLimit: 50,
        refillRatePerSecond: 50,
      });

      try {
        const statuses: number[] = [];
        for (let i = 0; i < 8; i++) {
          const res = await request(port, '/plans', 'POST', planBody, { 'x-api-key': key });
          statuses.push(res.status);
        }

        expect(statuses.filter((s) => s === 201)).toHaveLength(5);
        expect(statuses.filter((s) => s === 429)).toHaveLength(3);
      } finally {
        rateLimitingService.clearCustomLimits(key);
      }
    });

    it('meters routes declared above the old rate limit call site', async () => {
      const port = await serve();
      const key = `quotaroute-${Date.now()}`;

      // Reaching a handler that used to sit above the applyRateLimit() call
      // proves the limiter now runs ahead of the whole route table.
      const res = await request(
        port,
        '/quota/check',
        'POST',
        { apiKey: key, tier: 'free' },
        { 'x-api-key': key },
      );

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ allowed: true });
    });

    it('leaves skip-listed observability endpoints unthrottled', async () => {
      const port = await serve();
      const key = `scrape-${Date.now()}`;

      for (let i = 0; i < 130; i++) {
        const res = await request(port, '/metrics/build', 'GET', undefined, {
          'x-api-key': key,
        });
        expect(res.status).toBe(200);
        // A skipped path never reaches the limiter, so it carries no quota
        // headers at all — which is what lets Prometheus scrape it freely.
        expect(res.headers['x-ratelimit-remaining']).toBeUndefined();
      }
    });

    it('never throttles a request with no API key', async () => {
      const port = await serve();

      for (let i = 0; i < 130; i++) {
        const res = await request(port, '/plans', 'POST', planBody);
        expect(res.status).toBe(201);
      }
    });
  });
});
