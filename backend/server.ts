/**
 * SubTrackr backend HTTP server.
 *
 * Bootstraps:
 *   - PostgreSQL connection pool
 *   - Redis plan metadata cache + cache warming on deploy
 *   - GraphQL API at POST /graphql
 *   - Plan REST API at /plans/*
 *   - Prometheus plan cache metrics at GET /metrics/plan-cache
 *
 * Start locally:
 *   docker compose up -d redis postgres
 *   npm run server:start
 */

import http from 'node:http';
import { URL } from 'node:url';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { createHandler } from 'graphql-http/lib/use/node';

import { typeDefs } from './graphql/schema';
import { resolvers } from './graphql/resolvers';
import { createLoaderContext } from './graphql/dataloaders';
import { closePool, getPool, type Pool } from './shared/db/connectionPool';
import { createNullRedisClient } from './shared/cache/NullRedisClient';
import {
  bootstrapPlanCache,
  shutdownPlanCache,
  type PlanCacheBootstrap,
} from './subscription/bootstrap';
import { PlanCacheService } from './subscription/domain/PlanCacheService';
import { PostgresPlanRepository } from './subscription/domain/PostgresPlanRepository';
import { setPlanCacheService } from './subscription/planCacheRegistry';
import { createPlanController } from './subscription/controller/planController';
import { rateLimitingService } from './services/shared/rateLimitingService';
import { createRateLimitMiddleware, RATE_LIMIT_HEADERS } from './services/shared/rateLimitMiddleware';
import { applyCompression, compressionPrometheusMetrics } from './services/shared/compression';
import { wrapWithMonitor, type MonitoredPool } from './services/shared/poolMonitor';
import { applySecurityHeadersToResponse } from './shared/middleware/securityHeaders';
import { SubscriptionTier } from '../src/types/subscription';
import {
  processCorsRequest,
  upsertPolicy,
  getCorsAnalytics,
  getViolations,
} from './services/shared/corsMiddleware';

export interface StartServerOptions {
  port?: number;
  host?: string;
  pool?: Pool;
  /** Pre-built plan cache bootstrap (used in tests). */
  planBootstrap?: PlanCacheBootstrap;
  /** When true, binds to port (default). Set false in tests. */
  listen?: boolean;
}

export interface RunningServer {
  server: http.Server;
  pool: Pool;
  planBootstrap: PlanCacheBootstrap;
  monitoredPool: MonitoredPool;
  port: number;
  shutdown: () => Promise<void>;
}

async function ensurePlanCache(pool: Pool): Promise<PlanCacheBootstrap> {
  const bootstrapped = await bootstrapPlanCache({ pool, warmOnStart: true });
  if (bootstrapped) {
    return bootstrapped;
  }

  console.warn('[Server] Redis unavailable — running plan cache in DB-only fallback mode');
  const repository = new PostgresPlanRepository(pool);
  const nullRedis = createNullRedisClient();
  const planCache = new PlanCacheService(nullRedis, repository);
  setPlanCacheService(planCache);
  return { planCache, redis: nullRedis, repository };
}

// ---------------------------------------------------------------------------
// Rate-limit middleware factory
// ---------------------------------------------------------------------------

const SUBSCRIPTION_TIER_VALUES: string[] = Object.values(SubscriptionTier);

function parseSubscriptionTier(raw: string | null): SubscriptionTier | null {
  if (!raw) return SubscriptionTier.FREE;
  const value = raw.trim().toLowerCase();
  return SUBSCRIPTION_TIER_VALUES.includes(value) ? (value as SubscriptionTier) : null;
}

/** Extract the JWT `sub` (or userId) claim without verifying the signature. */
function decodeJwtSubject(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length < 2) return undefined;
  try {
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
      sub?: string;
      userId?: string;
      user_id?: string;
    };
    return payload.sub ?? payload.userId ?? payload.user_id;
  } catch {
    return undefined;
  }
}

/** Resolve the caller tier from the x-subscription-tier header (default FREE). */
function resolveTierFromRequest(
  req: { headers: Record<string, string | string[] | undefined> },
): SubscriptionTier {
  const raw = req.headers['x-subscription-tier'];
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return parseSubscriptionTier(value ?? null) ?? SubscriptionTier.FREE;
}

/**
 * Resolve a user identity for per-user aggregate limiting.
 * Prefers the x-user-id header (set by an upstream auth layer) and falls back
 * to the `sub`/`userId` claim of a Bearer JWT.
 */
function resolveUserIdFromRequest(
  req: { headers: Record<string, string | string[] | undefined> },
): string | undefined {
  const xUserId = req.headers['x-user-id'];
  if (typeof xUserId === 'string' && xUserId.trim()) {
    return xUserId.trim();
  }
  if (Array.isArray(xUserId) && xUserId[0]?.trim()) {
    return xUserId[0].trim();
  }
  const auth = req.headers['authorization'];
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token) {
    return decodeJwtSubject(token);
  }
  return undefined;
}

function buildRateLimitMiddleware() {
  return createRateLimitMiddleware({
    service: rateLimitingService,
    // Public/observability endpoints never throttle clients missing keys.
    allowMissingKey: true,
    skipPaths: ['/health', '/metrics/plan-cache', '/metrics/compression', '/metrics/pool'],
    // Per-key tier: read x-subscription-tier header; defaults to FREE.
    getTier: (apiKey, req) => {
      void apiKey;
      return resolveTierFromRequest(req);
    },
    // Per-user aggregate limiting: x-user-id header or Bearer JWT sub claim.
    getUserId: (req) => resolveUserIdFromRequest(req),
  });
}

/**
 * Apply rate limit middleware inline (no Express).
 * Returns true if the request should continue, false if a 429 was sent.
 */
async function applyRateLimit(
  rl: ReturnType<typeof buildRateLimitMiddleware>,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
): Promise<boolean> {
  let blocked = false;

  const pseudoReq = {
    method: req.method,
    path,
    url: req.url,
    headers: req.headers as Record<string, string | string[] | undefined>,
    ip: (req.socket as { remoteAddress?: string } | null)?.remoteAddress,
  };

  // Minimal Response adapter: the middleware speaks Express-style (status/json)
  // while the raw http server only exposes writeHead/end.
  const pseudoRes = {
    _statusCode: 200,
    setHeader(name: string, value: string | number) {
      res.setHeader(name, String(value));
    },
    header(name: string, value: string) {
      res.setHeader(name, value);
      return this;
    },
    set(name: string, value: string) {
      res.setHeader(name, value);
      return this;
    },
    status(code: number) {
      this._statusCode = code;
      return this;
    },
    writeHead(status: number, headers?: Record<string, string>) {
      res.writeHead(status, headers);
    },
    end(body?: string) {
      res.end(body);
      blocked = true;
    },
    json(body: unknown) {
      res.writeHead(this._statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      blocked = true;
    },
  };

  await rl(pseudoReq, pseudoRes, () => {
    /* proceed */
  });

  return !blocked;
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Compressed JSON response — uses Brotli/gzip when the client supports it */
async function sendJsonCompressed(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  body: unknown,
  cacheControl?: string,
): Promise<void> {
  const json = JSON.stringify(body);
  if (status !== 200) {
    // Non-200 responses skip compression to keep error handling simple
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(json);
    return;
  }
  await applyCompression(req, res, json, { 'Content-Type': 'application/json' }, {
    defaultCacheControl: cacheControl,
  });
}

function matchPlanId(pathname: string): string | null {
  const match = pathname.match(/^\/plans\/([^/]+)$/);
  return match?.[1] ?? null;
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const pool = options.pool ?? (await getPool());
  const planBootstrap = options.planBootstrap ?? (await ensurePlanCache(pool));
  const planController = createPlanController({ planCache: planBootstrap.planCache });

  // Wrap pool with monitoring
  const monitoredPool = wrapWithMonitor(pool, {
    name: 'primary',
    maxConnections: Number(process.env['DB_POOL_MAX'] ?? 20),
    pollIntervalMs: 5_000,
    exhaustionThreshold: 5,
    leakThresholdMs: 30_000,
    queryTimeoutMs: 30_000,
    onExhaustion: (stats) => {
      console.warn('[Server] DB pool exhaustion', stats);
    },
    onLeak: (leak) => {
      console.warn('[Server] DB connection leak', leak);
    },
  });

  const schema = makeExecutableSchema({ typeDefs, resolvers });
  const graphqlHandler = createHandler({
    schema,
    context: async () => ({
      pool,
      loaders: await createLoaderContext(pool),
    }),
  });

  const rateLimitMw = buildRateLimitMiddleware();

  // Seed a default permissive CORS policy for the server's own tenant.
  // In production, policies should be loaded from the database per-tenant.
  upsertPolicy('default', {
    allowedOrigins: [
      { origin: process.env['CORS_ALLOWED_ORIGIN'] ?? '*', isWildcard: true },
    ],
    allowCredentials: false,
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Api-Key',
      'X-Request-Id',
      'X-Subscription-Tier',
    ],
    active: true,
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const { pathname } = url;
    const method = req.method ?? 'GET';

    applySecurityHeadersToResponse(res);

    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = ((statusCode: number, statusMessage?: string | Record<string, string>) => {
      if (!res.headersSent) {
        applySecurityHeadersToResponse(res);
      }
      if (typeof statusMessage === 'string') {
        return originalWriteHead(statusCode, statusMessage);
      }
      return originalWriteHead(statusCode, statusMessage);
    }) as typeof res.writeHead;

    try {
      // -----------------------------------------------------------------
      // CORS – applied to every request before routing
      // -----------------------------------------------------------------
      const origin = typeof req.headers['origin'] === 'string' ? req.headers['origin'] : undefined;
      const requestHeaders = typeof req.headers['access-control-request-headers'] === 'string'
        ? req.headers['access-control-request-headers']
        : undefined;
      const { headers: corsHeaders, allowed: corsAllowed } = processCorsRequest({
        origin,
        method,
        requestHeaders,
        tenantId: 'default',
      });

      for (const [name, value] of Object.entries(corsHeaders)) {
        if (value !== null) res.setHeader(name, value);
      }

      // Short-circuit OPTIONS preflight
      if (method === 'OPTIONS') {
        res.writeHead(corsAllowed ? 204 : 403);
        res.end();
        return;
      }

      // -----------------------------------------------------------------
      // Health (bypass rate limiting)
      // -----------------------------------------------------------------
      if (pathname === '/health' && method === 'GET') {
        const cacheHealthy = await planBootstrap.planCache.isHealthy();
        sendJson(res, 200, {
          status: 'ok',
          planCache: cacheHealthy ? 'redis' : 'degraded',
        });
        return;
      }

      // -----------------------------------------------------------------
      // Prometheus metrics (bypass rate limiting)
      // -----------------------------------------------------------------
      if (pathname === '/metrics/plan-cache' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(planBootstrap.planCache.prometheusMetrics());
        return;
      }

      // -----------------------------------------------------------------
      // Compression metrics  GET /metrics/compression
      // -----------------------------------------------------------------
      if (pathname === '/metrics/compression' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(compressionPrometheusMetrics());
        return;
      }

      // -----------------------------------------------------------------
      // Pool metrics  GET /metrics/pool
      // -----------------------------------------------------------------
      if (pathname === '/metrics/pool' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(monitoredPool.prometheusMetrics());
        return;
      }

      // -----------------------------------------------------------------
      // Pool dashboard  GET /pool/stats
      // -----------------------------------------------------------------
      if (pathname === '/pool/stats' && method === 'GET') {
        sendJson(res, 200, {
          stats: monitoredPool.getStats(),
          tuning: monitoredPool.getTuningRecommendation(),
          history: monitoredPool.getHistory().slice(-10),
        });
        return;
      }

      // -----------------------------------------------------------------
      // CORS analytics  GET /cors/analytics
      // -----------------------------------------------------------------
      if (pathname === '/cors/analytics' && method === 'GET') {
        sendJson(res, 200, getCorsAnalytics());
        return;
      }

      // -----------------------------------------------------------------
      // CORS violations  GET /cors/violations
      // -----------------------------------------------------------------
      if (pathname === '/cors/violations' && method === 'GET') {
        const tenantId = url.searchParams.get('tenantId') ?? undefined;
        const origin = url.searchParams.get('origin') ?? undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 100;
        const since = url.searchParams.get('since') ?? undefined;
        sendJson(res, 200, getViolations({ tenantId, origin, limit, since }));
        return;
      }

      // -----------------------------------------------------------------
      // Rate-limit analytics  GET /rate-limits/analytics
      // -----------------------------------------------------------------
      if (pathname === '/rate-limits/analytics' && method === 'GET') {
        const tier = url.searchParams.get('tier') as SubscriptionTier | null;
        const analytics = rateLimitingService.getRateLimitAnalytics();
        const general = tier
          ? rateLimitingService.getAnalytics(tier)
          : rateLimitingService.getAnalytics();
        sendJson(res, 200, { rateLimits: analytics, usage: general });
        return;
      }

      // -----------------------------------------------------------------
      // Rate-limit status  GET /rate-limits/status?apiKey=...&tier=...
      // -----------------------------------------------------------------
      if (pathname === '/rate-limits/status' && method === 'GET') {
        const apiKey = url.searchParams.get('apiKey');
        const tier = (url.searchParams.get('tier') as SubscriptionTier) ?? SubscriptionTier.FREE;
        if (!apiKey) {
          sendJson(res, 400, { error: 'apiKey query param is required' });
          return;
        }
        const status = rateLimitingService.getRateLimitStatus(apiKey, tier);
        sendJson(res, 200, status);
        return;
      }

      // -----------------------------------------------------------------
      // Per-user rate-limit status  GET /rate-limits/status/user?userId=...&tier=...
      // -----------------------------------------------------------------
      if (pathname === '/rate-limits/status/user' && method === 'GET') {
        const userId = url.searchParams.get('userId');
        const tier = parseSubscriptionTier(url.searchParams.get('tier'));
        if (!userId) {
          sendJson(res, 400, { error: 'userId query param is required' });
          return;
        }
        if (!tier) {
          sendJson(res, 400, { error: 'invalid tier' });
          return;
        }
        const status = rateLimitingService.getUserRateLimitStatus(`user:${userId}`, tier);
        sendJson(res, 200, status);
        return;
      }

      // -----------------------------------------------------------------
      // Bypass management  POST /rate-limits/bypass
      // -----------------------------------------------------------------
      if (pathname === '/rate-limits/bypass' && method === 'POST') {
        const body = (await readJsonBody(req)) as {
          type: 'key' | 'user';
          value: string;
          action: 'add' | 'remove';
        };
        if (!body.type || !body.value || !body.action) {
          sendJson(res, 400, { error: 'type, value, and action are required' });
          return;
        }
        if (body.type === 'key') {
          body.action === 'add'
            ? rateLimitingService.addBypassKey(body.value)
            : rateLimitingService.removeBypassKey(body.value);
        } else {
          body.action === 'add'
            ? rateLimitingService.addBypassUser(body.value)
            : rateLimitingService.removeBypassUser(body.value);
        }
        sendJson(res, 200, {
          bypassKeys: rateLimitingService.listBypassKeys(),
          bypassUsers: rateLimitingService.listBypassUsers(),
        });
        return;
      }

      // -----------------------------------------------------------------
      // Custom limits  POST /rate-limits/config
      // -----------------------------------------------------------------
      if (pathname === '/rate-limits/config' && method === 'POST') {
        const body = (await readJsonBody(req)) as {
          apiKey: string;
          limits: {
            hourlyLimit?: number;
            dailyLimit?: number;
            monthlyLimit?: number;
            burstLimit?: number;
            concurrentLimit?: number;
          };
        };
        if (!body.apiKey) {
          sendJson(res, 400, { error: 'apiKey is required' });
          return;
        }
        rateLimitingService.setCustomLimits(body.apiKey, body.limits ?? {});
        sendJson(res, 200, { success: true, apiKey: body.apiKey, limits: body.limits });
        return;
      }

      // -----------------------------------------------------------------
      // Apply rate limiting to all other routes
      // -----------------------------------------------------------------
      const proceed = await applyRateLimit(rateLimitMw, req, res, pathname);
      if (!proceed) return; // 429 already sent

      // -----------------------------------------------------------------
      // GraphQL
      // -----------------------------------------------------------------
      if (pathname === '/graphql' && (method === 'POST' || method === 'GET')) {
        const [handled] = await graphqlHandler(req, res);
        if (!handled) {
          sendJson(res, 404, { error: 'GraphQL handler could not process request' });
        }
        return;
      }

      const planId = matchPlanId(pathname);

      if (pathname === '/plans' && method === 'POST') {
        const body = (await readJsonBody(req)) as Parameters<typeof planController.createPlan>[0];
        const result = await planController.createPlan(body);
        sendJson(res, result.success ? 201 : (result.status ?? 400), result);
        return;
      }

      if (planId && method === 'GET') {
        const result = await planController.getPlan(planId);
        await sendJsonCompressed(req, res, result.success ? 200 : (result.status ?? 400), result,
          result.success ? 'public, s-maxage=300, stale-while-revalidate=60' : undefined);
        return;
      }

      if (planId && method === 'PATCH') {
        const body = (await readJsonBody(req)) as Parameters<typeof planController.updatePlan>[1];
        const result = await planController.updatePlan(planId, body);
        sendJson(res, result.success ? 200 : (result.status ?? 400), result);
        return;
      }

      if (planId && method === 'DELETE') {
        const result = await planController.deactivatePlan(planId);
        sendJson(res, result.success ? 200 : (result.status ?? 400), result);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('[Server] Request error:', err);
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });

  const port = options.port ?? Number(process.env.PORT ?? 3001);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';

  const shutdown = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await shutdownPlanCache(planBootstrap);
    if (!options.pool) {
      await closePool();
    }
  };

  if (options.listen !== false) {
    await new Promise<void>((resolve) => {
      server.listen(port, host, () => {
        console.info(`[Server] Listening on http://${host}:${port}`);
        console.info(`[Server] GraphQL  → POST /graphql`);
        console.info(`[Server] Plans    → /plans`);
        console.info(`[Server] Metrics  → GET /metrics/plan-cache`);
        console.info(`[Server] RateLimit → GET /rate-limits/analytics`);
        console.info(`[Server] RateLimit → GET /rate-limits/status?apiKey=...`);
        console.info(`[Server] RateLimit → GET /rate-limits/status/user?userId=...`);
        console.info(`[Server] RateLimit → POST /rate-limits/bypass`);
        console.info(`[Server] RateLimit → POST /rate-limits/config`);
        console.info(`[Server] CORS     → GET /cors/analytics`);
        console.info(`[Server] CORS     → GET /cors/violations`);
        resolve();
      });
    });
  }

  const handleSignal = (signal: string) => {
    console.info(`[Server] Received ${signal}, shutting down…`);
    shutdown()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('[Server] Shutdown error:', err);
        process.exit(1);
      });
  };

  process.once('SIGTERM', () => handleSignal('SIGTERM'));
  process.once('SIGINT', () => handleSignal('SIGINT'));

  return { server, pool, planBootstrap, monitoredPool, port, shutdown };
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  });
}
