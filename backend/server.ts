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
import { tierQuotaService } from './services/shared/tierQuotaService';
import {
  ipWhitelistService,
  createIpWhitelistGate,
} from './services/shared/ipWhitelistService';
import { serverSessionService } from './services/auth/serverSessionService';

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

  // ---------------------------------------------------------------------------
  // IP whitelist gate (issue #1158)
  // ---------------------------------------------------------------------------
  const ipWhitelistGate = createIpWhitelistGate({
    service: ipWhitelistService,
    getTenantId: (req) => {
      const tid = req.headers['x-tenant-id'];
      return typeof tid === 'string' ? tid : 'default';
    },
    bypassPaths: ['/health', '/metrics/plan-cache', '/metrics/compression', '/metrics/pool'],
  });

  // ---------------------------------------------------------------------------
  // Session expiry sweep — every 5 minutes (issue #1160)
  // ---------------------------------------------------------------------------
  const sessionSweepTimer = setInterval(() => {
    serverSessionService.sweepExpiredSessions();
  }, 5 * 60 * 1000);
  sessionSweepTimer.unref();

  // ── IP Whitelist gate ────────────────────────────────────────────────────
  const checkIpAccess = createIpWhitelistGate({
    service: ipWhitelistService,
    getTenantId: (req) => {
      const tid = req.headers['x-tenant-id'];
      return (typeof tid === 'string' ? tid : undefined) ?? 'default';
    },
  });

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
      // IP Whitelist gate (issue #1158) — applied before all auth/rate-limit
      // -----------------------------------------------------------------
      const ipAllowed = ipWhitelistGate(req, res, pathname);
      if (!ipAllowed) return; // 403 already written

      // -----------------------------------------------------------------
      // IP Whitelist — enforced before rate limiting
      // -----------------------------------------------------------------
      const ipAllowed = checkIpAccess(req, res, pathname);
      if (!ipAllowed) return; // 403 already written

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

      // =================================================================
      // TIER QUOTA ROUTES  (issue #1155)
      // =================================================================

      // GET /quota/policies — list all tier policies
      if (pathname === '/quota/policies' && method === 'GET') {
        sendJson(res, 200, { policies: tierQuotaService.getAllPolicies() });
        return;
      }

      // GET /quota/policies/:tier — get single tier policy
      {
        const quotaPolicyMatch = pathname.match(/^\/quota\/policies\/([^/]+)$/);
        if (quotaPolicyMatch && method === 'GET') {
          const tier = quotaPolicyMatch[1] as SubscriptionTier;
          const policy = tierQuotaService.getPolicy(tier);
          sendJson(res, 200, { policy });
          return;
        }

        // PATCH /quota/policies/:tier — update a tier policy
        if (quotaPolicyMatch && method === 'PATCH') {
          const tier = quotaPolicyMatch[1] as SubscriptionTier;
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const updated = tierQuotaService.setPolicy(tier, body as any);
          sendJson(res, 200, { policy: updated });
          return;
        }
      }

      // GET /quota/status?apiKey=...&tier=... — usage snapshots
      if (pathname === '/quota/status' && method === 'GET') {
        const apiKey = url.searchParams.get('apiKey');
        const tier = (url.searchParams.get('tier') as SubscriptionTier) ?? SubscriptionTier.FREE;
        if (!apiKey) {
          sendJson(res, 400, { error: 'apiKey query param is required' });
          return;
        }
        const snapshots = tierQuotaService.getUsageSnapshot(apiKey, tier);
        const upgrade = tierQuotaService.getUpgradeRecommendation(apiKey, tier);
        sendJson(res, 200, { snapshots, upgrade });
        return;
      }

      // POST /quota/check — check without recording usage
      if (pathname === '/quota/check' && method === 'POST') {
        const body = (await readJsonBody(req)) as { apiKey?: string; tier?: string };
        const apiKey = body.apiKey;
        const tier = (body.tier as SubscriptionTier) ?? SubscriptionTier.FREE;
        if (!apiKey) {
          sendJson(res, 400, { error: 'apiKey is required' });
          return;
        }
        const result = tierQuotaService.checkQuota(apiKey, tier);
        sendJson(res, result.allowed ? 200 : 429, result);
        return;
      }

      // POST /quota/grants — create an entitlement grant
      if (pathname === '/quota/grants' && method === 'POST') {
        const body = (await readJsonBody(req)) as {
          apiKey?: string;
          tier?: string;
          extraHourly?: number;
          extraDaily?: number;
          extraMonthly?: number;
          expiresAt?: string | null;
          reason?: string;
          grantedBy?: string;
        };
        if (!body.apiKey) {
          sendJson(res, 400, { error: 'apiKey is required' });
          return;
        }
        const grant = tierQuotaService.grantQuota({
          apiKey: body.apiKey,
          tier: (body.tier as SubscriptionTier) ?? SubscriptionTier.FREE,
          extraHourly: body.extraHourly ?? 0,
          extraDaily: body.extraDaily ?? 0,
          extraMonthly: body.extraMonthly ?? 0,
          expiresAt: body.expiresAt ?? null,
          reason: body.reason ?? '',
          grantedBy: body.grantedBy ?? 'admin',
        });
        sendJson(res, 201, { grant });
        return;
      }

      // DELETE /quota/grants/:apiKey — revoke a grant
      {
        const grantDeleteMatch = pathname.match(/^\/quota\/grants\/([^/]+)$/);
        if (grantDeleteMatch && method === 'DELETE') {
          const apiKey = decodeURIComponent(grantDeleteMatch[1]);
          const revoked = tierQuotaService.revokeGrant(apiKey);
          sendJson(res, revoked ? 200 : 404, { revoked, apiKey });
          return;
        }
      }

      // GET /quota/grants — list active grants
      if (pathname === '/quota/grants' && method === 'GET') {
        sendJson(res, 200, { grants: tierQuotaService.listGrants() });
        return;
      }

      // GET /quota/metrics — summary metrics
      if (pathname === '/quota/metrics' && method === 'GET') {
        sendJson(res, 200, tierQuotaService.getMetrics());
        return;
      }

      // GET /metrics/quota — Prometheus text
      if (pathname === '/metrics/quota' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(tierQuotaService.prometheusMetrics());
        return;
      }

      // POST /quota/reset — reset usage for apiKey (admin)
      if (pathname === '/quota/reset' && method === 'POST') {
        const body = (await readJsonBody(req)) as { apiKey?: string; all?: boolean };
        if (body.all) {
          tierQuotaService.resetAllUsage();
          sendJson(res, 200, { reset: 'all' });
        } else if (body.apiKey) {
          tierQuotaService.resetUsage(body.apiKey);
          sendJson(res, 200, { reset: body.apiKey });
        } else {
          sendJson(res, 400, { error: 'apiKey or all:true required' });
        }
        return;
      }

      // =================================================================
      // IP WHITELIST ROUTES  (issue #1158)
      // =================================================================

      // GET /ip-whitelist/rules — list all rules
      if (pathname === '/ip-whitelist/rules' && method === 'GET') {
        const tenantId = url.searchParams.get('tenantId') ?? undefined;
        const rules = tenantId
          ? ipWhitelistService.getRulesForTenant(tenantId)
          : ipWhitelistService.getAllRules();
        sendJson(res, 200, { rules });
        return;
      }

      // POST /ip-whitelist/rules — add a rule
      if (pathname === '/ip-whitelist/rules' && method === 'POST') {
        const body = (await readJsonBody(req)) as {
          cidr?: string;
          type?: 'allow' | 'deny';
          tenantId?: string;
          description?: string;
          expiresAt?: number | null;
          priority?: number;
          createdBy?: string;
        };
        if (!body.cidr) {
          sendJson(res, 400, { error: 'cidr is required' });
          return;
        }
        const rule = ipWhitelistService.addRule({
          cidr: body.cidr,
          type: body.type ?? 'allow',
          tenantId: body.tenantId ?? 'default',
          description: body.description,
          expiresAt: body.expiresAt ?? null,
          priority: body.priority,
          createdBy: body.createdBy ?? 'admin',
          enabled: true,
        });
        sendJson(res, 201, { rule });
        return;
      }

      // PATCH /ip-whitelist/rules/:id — update a rule
      // DELETE /ip-whitelist/rules/:id — delete a rule
      {
        const ruleMatch = pathname.match(/^\/ip-whitelist\/rules\/([^/]+)$/);
        if (ruleMatch && method === 'PATCH') {
          const id = ruleMatch[1];
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const updated = ipWhitelistService.updateRule(id, body as any);
          if (!updated) { sendJson(res, 404, { error: 'Rule not found' }); return; }
          sendJson(res, 200, { rule: updated });
          return;
        }
        if (ruleMatch && method === 'DELETE') {
          const id = ruleMatch[1];
          const deleted = ipWhitelistService.deleteRule(id);
          sendJson(res, deleted ? 200 : 404, { deleted, id });
          return;
        }
      }

      // POST /ip-whitelist/check — test an IP against rules
      if (pathname === '/ip-whitelist/check' && method === 'POST') {
        const body = (await readJsonBody(req)) as { ip?: string; tenantId?: string; path?: string };
        if (!body.ip) {
          sendJson(res, 400, { error: 'ip is required' });
          return;
        }
        const decision = ipWhitelistService.decide(body.ip, body.tenantId ?? 'default', body.path ?? '/');
        sendJson(res, 200, { decision });
        return;
      }

      // GET /ip-whitelist/stats — stats
      if (pathname === '/ip-whitelist/stats' && method === 'GET') {
        sendJson(res, 200, ipWhitelistService.getStats());
        return;
      }

      // GET /ip-whitelist/audit-log — decision audit log
      if (pathname === '/ip-whitelist/audit-log' && method === 'GET') {
        const tenantId = url.searchParams.get('tenantId') ?? undefined;
        const ip = url.searchParams.get('ip') ?? undefined;
        const deniedOnly = url.searchParams.get('deniedOnly') === 'true';
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 500;
        const since = url.searchParams.get('since') ? Number(url.searchParams.get('since')) : undefined;
        sendJson(res, 200, {
          log: ipWhitelistService.getDecisionLog({ tenantId, ip, deniedOnly, since, limit }),
        });
        return;
      }

      // POST /ip-whitelist/purge-expired — purge expired rules
      if (pathname === '/ip-whitelist/purge-expired' && method === 'POST') {
        const count = ipWhitelistService.purgeExpiredRules();
        sendJson(res, 200, { purged: count });
        return;
      }

      // GET /ip-whitelist/trusted-networks — list trusted networks
      if (pathname === '/ip-whitelist/trusted-networks' && method === 'GET') {
        sendJson(res, 200, { trustedNetworks: (ipWhitelistService as any).trustedNetworks });
        return;
      }

      // POST /ip-whitelist/trusted-networks — add trusted network
      if (pathname === '/ip-whitelist/trusted-networks' && method === 'POST') {
        const body = (await readJsonBody(req)) as { cidr?: string };
        if (!body.cidr) { sendJson(res, 400, { error: 'cidr is required' }); return; }
        ipWhitelistService.addTrustedNetwork(body.cidr);
        sendJson(res, 200, { added: body.cidr });
        return;
      }

      // GET /metrics/ip-whitelist — Prometheus text
      if (pathname === '/metrics/ip-whitelist' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(ipWhitelistService.prometheusMetrics());
        return;
      }

      // =================================================================
      // SESSION MANAGEMENT ROUTES  (issue #1160)
      // =================================================================

      // POST /sessions — create a new session
      if (pathname === '/sessions' && method === 'POST') {
        const body = (await readJsonBody(req)) as {
          userId?: string;
          ttlMs?: number;
          metadata?: Record<string, unknown>;
        };
        if (!body.userId) {
          sendJson(res, 400, { error: 'userId is required' });
          return;
        }
        const session = serverSessionService.createSession({
          userId: body.userId,
          req,
          ttlMs: body.ttlMs,
          metadata: body.metadata,
        });
        // Never send the raw token back in body — send it in a header so callers
        // can store it securely; include session metadata only.
        res.setHeader('X-Session-Token', session.token);
        sendJson(res, 201, {
          id: session.id,
          userId: session.userId,
          device: session.device,
          geo: { country: session.geo.country, city: session.geo.city, region: session.geo.region },
          status: session.status,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          isSuspicious: session.isSuspicious,
          suspiciousReasons: session.suspiciousReasons,
        });
        return;
      }

      // GET /sessions/validate — validate token from X-Session-Token header
      if (pathname === '/sessions/validate' && method === 'GET') {
        const token = req.headers['x-session-token'] as string;
        if (!token) {
          sendJson(res, 400, { error: 'X-Session-Token header is required' });
          return;
        }
        const result = serverSessionService.validateSession(token, req);
        if (!result.valid) {
          sendJson(res, 401, { valid: false, reason: result.reason });
          return;
        }
        const s = result.session!;
        sendJson(res, 200, {
          valid: true,
          id: s.id,
          userId: s.userId,
          device: s.device,
          status: s.status,
          expiresAt: s.expiresAt,
          isSuspicious: s.isSuspicious,
          suspiciousReasons: s.suspiciousReasons,
        });
        return;
      }

      // POST /sessions/touch — extend session TTL
      if (pathname === '/sessions/touch' && method === 'POST') {
        const token = req.headers['x-session-token'] as string;
        if (!token) {
          sendJson(res, 400, { error: 'X-Session-Token header is required' });
          return;
        }
        const session = serverSessionService.touchSession(token);
        if (!session) {
          sendJson(res, 404, { error: 'Session not found or expired' });
          return;
        }
        sendJson(res, 200, { id: session.id, expiresAt: session.expiresAt, lastActiveAt: session.lastActiveAt });
        return;
      }

      // POST /sessions/revoke — revoke a specific session token
      if (pathname === '/sessions/revoke' && method === 'POST') {
        const body = (await readJsonBody(req)) as { token?: string; reason?: string };
        if (!body.token) {
          sendJson(res, 400, { error: 'token is required' });
          return;
        }
        const revoked = serverSessionService.revokeSession(body.token, body.reason);
        sendJson(res, revoked ? 200 : 404, { revoked });
        return;
      }

      // POST /sessions/revoke-all — revoke all sessions for a user
      if (pathname === '/sessions/revoke-all' && method === 'POST') {
        const body = (await readJsonBody(req)) as { userId?: string; reason?: string };
        if (!body.userId) {
          sendJson(res, 400, { error: 'userId is required' });
          return;
        }
        const count = serverSessionService.revokeAllSessions(body.userId, body.reason);
        sendJson(res, 200, { revoked: count });
        return;
      }

      // POST /sessions/revoke-others — revoke all other sessions for the token owner
      if (pathname === '/sessions/revoke-others' && method === 'POST') {
        const token = req.headers['x-session-token'] as string;
        if (!token) {
          sendJson(res, 400, { error: 'X-Session-Token header is required' });
          return;
        }
        const count = serverSessionService.revokeOtherSessions(token);
        sendJson(res, 200, { revoked: count });
        return;
      }

      // GET /sessions/user/:userId — list all sessions for a user
      {
        const userSessionMatch = pathname.match(/^\/sessions\/user\/([^/]+)$/);
        if (userSessionMatch && method === 'GET') {
          const userId = decodeURIComponent(userSessionMatch[1]);
          const activeOnly = url.searchParams.get('activeOnly') === 'true';
          const sessions = activeOnly
            ? serverSessionService.getActiveSessionsForUser(userId)
            : serverSessionService.getAllSessionsForUser(userId);
          // Strip raw tokens from list response
          sendJson(res, 200, {
            sessions: sessions.map((s) => ({
              id: s.id,
              userId: s.userId,
              device: s.device,
              geo: { country: s.geo.country, city: s.geo.city, region: s.geo.region },
              status: s.status,
              createdAt: s.createdAt,
              lastActiveAt: s.lastActiveAt,
              expiresAt: s.expiresAt,
              isSuspicious: s.isSuspicious,
              suspiciousReasons: s.suspiciousReasons,
            })),
          });
          return;
        }
      }

      // GET /sessions/suspicious — get suspicious sessions (optional ?userId=)
      if (pathname === '/sessions/suspicious' && method === 'GET') {
        const userId = url.searchParams.get('userId') ?? undefined;
        const sessions = serverSessionService.getSuspiciousSessions(userId);
        sendJson(res, 200, {
          sessions: sessions.map((s) => ({
            id: s.id,
            userId: s.userId,
            device: s.device,
            geo: { country: s.geo.country, city: s.geo.city, region: s.geo.region },
            status: s.status,
            isSuspicious: s.isSuspicious,
            suspiciousReasons: s.suspiciousReasons,
          })),
        });
        return;
      }

      // GET /sessions/stats — aggregate stats
      if (pathname === '/sessions/stats' && method === 'GET') {
        sendJson(res, 200, serverSessionService.getStats());
        return;
      }

      // GET /sessions/audit-log — audit log query
      if (pathname === '/sessions/audit-log' && method === 'GET') {
        const userId = url.searchParams.get('userId') ?? undefined;
        const sessionId = url.searchParams.get('sessionId') ?? undefined;
        const action = url.searchParams.get('action') as any;
        const since = url.searchParams.get('since') ? Number(url.searchParams.get('since')) : undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 200;
        sendJson(res, 200, {
          log: serverSessionService.getAuditLog({ userId, sessionId, action, since, limit }),
        });
        return;
      }

      // PATCH /sessions/config — update session service config
      if (pathname === '/sessions/config' && method === 'PATCH') {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const config = serverSessionService.updateConfig(body as any);
        sendJson(res, 200, { config });
        return;
      }

      // GET /sessions/config — get current config
      if (pathname === '/sessions/config' && method === 'GET') {
        sendJson(res, 200, { config: serverSessionService.getConfig() });
        return;
      }

      // POST /sessions/sweep — manually trigger expiry sweep
      if (pathname === '/sessions/sweep' && method === 'POST') {
        const count = serverSessionService.sweepExpiredSessions();
        sendJson(res, 200, { swept: count });
        return;
      }

      // GET /metrics/sessions — Prometheus text
      if (pathname === '/metrics/sessions' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(serverSessionService.prometheusMetrics());
        return;
      }

      // -----------------------------------------------------------------
      // Tier Quota — GET /quota/status?apiKey=...&tier=...
      // -----------------------------------------------------------------
      if (pathname === '/quota/status' && method === 'GET') {
        const apiKey = url.searchParams.get('apiKey');
        const tier = (url.searchParams.get('tier') as SubscriptionTier) ?? SubscriptionTier.FREE;
        if (!apiKey) {
          sendJson(res, 400, { error: 'apiKey query param required' });
          return;
        }
        const snapshots = tierQuotaService.getUsageSnapshot(apiKey, tier);
        const recommendation = tierQuotaService.getUpgradeRecommendation(apiKey, tier);
        sendJson(res, 200, { snapshots, recommendation });
        return;
      }

      // -----------------------------------------------------------------
      // Tier Quota — GET /quota/policies
      // -----------------------------------------------------------------
      if (pathname === '/quota/policies' && method === 'GET') {
        sendJson(res, 200, { policies: tierQuotaService.getAllPolicies() });
        return;
      }

      // -----------------------------------------------------------------
      // Tier Quota — PATCH /quota/policies/:tier
      // -----------------------------------------------------------------
      if (pathname.startsWith('/quota/policies/') && method === 'PATCH') {
        const tierParam = pathname.split('/')[3] as SubscriptionTier;
        if (!tierParam) {
          sendJson(res, 400, { error: 'tier path param required' });
          return;
        }
        const body = (await readJsonBody(req)) as Parameters<typeof tierQuotaService.setPolicy>[1];
        const policy = tierQuotaService.setPolicy(tierParam, body);
        sendJson(res, 200, { policy });
        return;
      }

      // -----------------------------------------------------------------
      // Tier Quota — POST /quota/grants
      // -----------------------------------------------------------------
      if (pathname === '/quota/grants' && method === 'POST') {
        const body = (await readJsonBody(req)) as Parameters<typeof tierQuotaService.grantQuota>[0];
        if (!body.apiKey || !body.tier) {
          sendJson(res, 400, { error: 'apiKey and tier are required' });
          return;
        }
        const grant = tierQuotaService.grantQuota(body);
        sendJson(res, 201, { grant });
        return;
      }

      // -----------------------------------------------------------------
      // Tier Quota — DELETE /quota/grants/:apiKey
      // -----------------------------------------------------------------
      if (pathname.startsWith('/quota/grants/') && method === 'DELETE') {
        const apiKey = decodeURIComponent(pathname.split('/')[3] ?? '');
        const ok = tierQuotaService.revokeGrant(apiKey);
        sendJson(res, ok ? 200 : 404, { success: ok });
        return;
      }

      // -----------------------------------------------------------------
      // Tier Quota — GET /quota/metrics
      // -----------------------------------------------------------------
      if (pathname === '/quota/metrics' && method === 'GET') {
        sendJson(res, 200, tierQuotaService.getMetrics());
        return;
      }

      // -----------------------------------------------------------------
      // Tier Quota — GET /metrics/quota (Prometheus)
      // -----------------------------------------------------------------
      if (pathname === '/metrics/quota' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(tierQuotaService.prometheusMetrics());
        return;
      }

      // -----------------------------------------------------------------
      // IP Whitelist — GET /ip-whitelist/rules
      // -----------------------------------------------------------------
      if (pathname === '/ip-whitelist/rules' && method === 'GET') {
        const tenantId = url.searchParams.get('tenantId') ?? undefined;
        const rules = tenantId
          ? ipWhitelistService.getRulesForTenant(tenantId)
          : ipWhitelistService.getAllRules();
        sendJson(res, 200, { rules });
        return;
      }

      // -----------------------------------------------------------------
      // IP Whitelist — POST /ip-whitelist/rules
      // -----------------------------------------------------------------
      if (pathname === '/ip-whitelist/rules' && method === 'POST') {
        const body = (await readJsonBody(req)) as Parameters<typeof ipWhitelistService.addRule>[0];
        if (!body.cidr || !body.type || !body.tenantId) {
          sendJson(res, 400, { error: 'cidr, type, and tenantId are required' });
          return;
        }
        const rule = ipWhitelistService.addRule({ ...body, createdBy: body.createdBy ?? 'api' });
        sendJson(res, 201, { rule });
        return;
      }

      // -----------------------------------------------------------------
      // IP Whitelist — PATCH /ip-whitelist/rules/:id
      // -----------------------------------------------------------------
      if (pathname.startsWith('/ip-whitelist/rules/') && method === 'PATCH') {
        const ruleId = pathname.split('/')[3];
        if (!ruleId) { sendJson(res, 400, { error: 'rule id required' }); return; }
        const body = (await readJsonBody(req)) as Parameters<typeof ipWhitelistService.updateRule>[1];
        const updated = ipWhitelistService.updateRule(ruleId, body);
        sendJson(res, updated ? 200 : 404, updated ?? { error: 'rule not found' });
        return;
      }

      // -----------------------------------------------------------------
      // IP Whitelist — DELETE /ip-whitelist/rules/:id
      // -----------------------------------------------------------------
      if (pathname.startsWith('/ip-whitelist/rules/') && method === 'DELETE') {
        const ruleId = pathname.split('/')[3];
        if (!ruleId) { sendJson(res, 400, { error: 'rule id required' }); return; }
        const ok = ipWhitelistService.deleteRule(ruleId);
        sendJson(res, ok ? 200 : 404, { success: ok });
        return;
      }

      // -----------------------------------------------------------------
      // IP Whitelist — POST /ip-whitelist/check
      // -----------------------------------------------------------------
      if (pathname === '/ip-whitelist/check' && method === 'POST') {
        const body = (await readJsonBody(req)) as { ip?: string; tenantId?: string };
        const ip = body.ip ?? extractClientIp(req);
        const tenantId = body.tenantId ?? 'default';
        const decision = ipWhitelistService.decide(ip, tenantId, pathname);
        sendJson(res, 200, { decision });
        return;
      }

      // -----------------------------------------------------------------
      // IP Whitelist — GET /ip-whitelist/stats
      // -----------------------------------------------------------------
      if (pathname === '/ip-whitelist/stats' && method === 'GET') {
        sendJson(res, 200, ipWhitelistService.getStats());
        return;
      }

      // -----------------------------------------------------------------
      // IP Whitelist — GET /ip-whitelist/audit
      // -----------------------------------------------------------------
      if (pathname === '/ip-whitelist/audit' && method === 'GET') {
        const tenantId = url.searchParams.get('tenantId') ?? undefined;
        const ip = url.searchParams.get('ip') ?? undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 200;
        const since = url.searchParams.get('since') ? Number(url.searchParams.get('since')) : undefined;
        const log = ipWhitelistService.getDecisionLog({ tenantId, ip, limit, since });
        sendJson(res, 200, { log });
        return;
      }

      // -----------------------------------------------------------------
      // IP Whitelist — GET /metrics/ip-whitelist (Prometheus)
      // -----------------------------------------------------------------
      if (pathname === '/metrics/ip-whitelist' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(ipWhitelistService.prometheusMetrics());
        return;
      }

      // -----------------------------------------------------------------
      // Sessions — POST /sessions  (create session)
      // -----------------------------------------------------------------
      if (pathname === '/sessions' && method === 'POST') {
        const body = (await readJsonBody(req)) as { userId?: string; ttlMs?: number; metadata?: Record<string, unknown> };
        if (!body.userId) {
          sendJson(res, 400, { error: 'userId is required' });
          return;
        }
        const session = serverSessionService.createSession({
          userId: body.userId,
          req,
          ttlMs: body.ttlMs,
          metadata: body.metadata,
        });
        // Don't expose raw token in response body — return only id + metadata
        sendJson(res, 201, {
          sessionId: session.id,
          token: session.token,
          expiresAt: session.expiresAt,
          device: session.device,
          isSuspicious: session.isSuspicious,
          suspiciousReasons: session.suspiciousReasons,
        });
        return;
      }

      // -----------------------------------------------------------------
      // Sessions — GET /sessions/validate  (token in Authorization: Bearer)
      // -----------------------------------------------------------------
      if (pathname === '/sessions/validate' && method === 'GET') {
        const authHeader = req.headers['authorization'];
        const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : url.searchParams.get('token') ?? '';
        if (!token) {
          sendJson(res, 400, { error: 'session token required in Authorization header' });
          return;
        }
        const result = serverSessionService.validateSession(token, req);
        if (!result.valid) {
          sendJson(res, 401, { valid: false, reason: result.reason });
          return;
        }
        const s = result.session!;
        sendJson(res, 200, {
          valid: true,
          sessionId: s.id,
          userId: s.userId,
          device: s.device,
          geo: s.geo,
          expiresAt: s.expiresAt,
          isSuspicious: s.isSuspicious,
          suspiciousReasons: s.suspiciousReasons,
        });
        return;
      }

      // -----------------------------------------------------------------
      // Sessions — GET /sessions/user/:userId
      // -----------------------------------------------------------------
      if (pathname.startsWith('/sessions/user/') && method === 'GET') {
        const userId = decodeURIComponent(pathname.split('/')[3] ?? '');
        if (!userId) { sendJson(res, 400, { error: 'userId required' }); return; }
        const sessions = serverSessionService.getAllSessionsForUser(userId).map((s) => ({
          id: s.id,
          device: s.device,
          geo: s.geo,
          status: s.status,
          createdAt: s.createdAt,
          lastActiveAt: s.lastActiveAt,
          expiresAt: s.expiresAt,
          isSuspicious: s.isSuspicious,
          suspiciousReasons: s.suspiciousReasons,
        }));
        sendJson(res, 200, { sessions });
        return;
      }

      // -----------------------------------------------------------------
      // Sessions — DELETE /sessions/:token  (revoke)
      // -----------------------------------------------------------------
      if (pathname.startsWith('/sessions/') && method === 'DELETE') {
        const token = decodeURIComponent(pathname.split('/')[2] ?? '');
        if (!token) { sendJson(res, 400, { error: 'session token required' }); return; }
        const body = (await readJsonBody(req)) as { reason?: string };
        const ok = serverSessionService.revokeSession(token, body.reason);
        sendJson(res, ok ? 200 : 404, { success: ok });
        return;
      }

      // -----------------------------------------------------------------
      // Sessions — POST /sessions/revoke-all  (revoke all for user)
      // -----------------------------------------------------------------
      if (pathname === '/sessions/revoke-all' && method === 'POST') {
        const body = (await readJsonBody(req)) as { userId?: string; reason?: string };
        if (!body.userId) { sendJson(res, 400, { error: 'userId required' }); return; }
        const count = serverSessionService.revokeAllSessions(body.userId, body.reason);
        sendJson(res, 200, { revokedCount: count });
        return;
      }

      // -----------------------------------------------------------------
      // Sessions — POST /sessions/revoke-others
      // -----------------------------------------------------------------
      if (pathname === '/sessions/revoke-others' && method === 'POST') {
        const body = (await readJsonBody(req)) as { token?: string; reason?: string };
        if (!body.token) { sendJson(res, 400, { error: 'current session token required' }); return; }
        const count = serverSessionService.revokeOtherSessions(body.token, body.reason);
        sendJson(res, 200, { revokedCount: count });
        return;
      }

      // -----------------------------------------------------------------
      // Sessions — GET /sessions/suspicious
      // -----------------------------------------------------------------
      if (pathname === '/sessions/suspicious' && method === 'GET') {
        const userId = url.searchParams.get('userId') ?? undefined;
        const suspicious = serverSessionService.getSuspiciousSessions(userId).map((s) => ({
          id: s.id,
          userId: s.userId,
          device: s.device,
          geo: s.geo,
          status: s.status,
          suspiciousReasons: s.suspiciousReasons,
          createdAt: s.createdAt,
          lastActiveAt: s.lastActiveAt,
        }));
        sendJson(res, 200, { suspicious });
        return;
      }

      // -----------------------------------------------------------------
      // Sessions — GET /sessions/stats
      // -----------------------------------------------------------------
      if (pathname === '/sessions/stats' && method === 'GET') {
        sendJson(res, 200, serverSessionService.getStats());
        return;
      }

      // -----------------------------------------------------------------
      // Sessions — GET /sessions/audit
      // -----------------------------------------------------------------
      if (pathname === '/sessions/audit' && method === 'GET') {
        const userId = url.searchParams.get('userId') ?? undefined;
        const sessionId = url.searchParams.get('sessionId') ?? undefined;
        const action = url.searchParams.get('action') as Parameters<typeof serverSessionService.getAuditLog>[0]['action'];
        const since = url.searchParams.get('since') ? Number(url.searchParams.get('since')) : undefined;
        const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 200;
        sendJson(res, 200, { log: serverSessionService.getAuditLog({ userId, sessionId, action, since, limit }) });
        return;
      }

      // -----------------------------------------------------------------
      // Sessions — PATCH /sessions/config
      // -----------------------------------------------------------------
      if (pathname === '/sessions/config' && method === 'PATCH') {
        const body = (await readJsonBody(req)) as Parameters<typeof serverSessionService.updateConfig>[0];
        const config = serverSessionService.updateConfig(body);
        sendJson(res, 200, { config });
        return;
      }

      // -----------------------------------------------------------------
      // Sessions — GET /metrics/sessions (Prometheus)
      // -----------------------------------------------------------------
      if (pathname === '/metrics/sessions' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(serverSessionService.prometheusMetrics());
        return;
      }

      // -----------------------------------------------------------------
      // HubSpot — POST /hubspot/contacts/sync
      // -----------------------------------------------------------------
      if (pathname === '/hubspot/contacts/sync' && method === 'POST') {
        const body = (await readJsonBody(req)) as { contacts?: unknown[]; contact?: unknown };
        const hubspot = getHubSpotService();
        if (Array.isArray(body.contacts)) {
          const results = await hubspot.syncContacts(body.contacts as Parameters<typeof hubspot.syncContacts>[0]);
          sendJson(res, 200, { results });
        } else if (body.contact) {
          const result = await hubspot.syncContact(body.contact as Parameters<typeof hubspot.syncContact>[0]);
          sendJson(res, result.success ? 200 : 502, { result });
        } else {
          sendJson(res, 400, { error: 'contact or contacts array required' });
        }
        return;
      }

      // -----------------------------------------------------------------
      // HubSpot — POST /hubspot/companies/sync
      // -----------------------------------------------------------------
      if (pathname === '/hubspot/companies/sync' && method === 'POST') {
        const body = (await readJsonBody(req)) as { companies?: unknown[]; company?: unknown };
        const hubspot = getHubSpotService();
        if (Array.isArray(body.companies)) {
          const results = await hubspot.syncCompanies(body.companies as Parameters<typeof hubspot.syncCompanies>[0]);
          sendJson(res, 200, { results });
        } else if (body.company) {
          const result = await hubspot.syncCompany(body.company as Parameters<typeof hubspot.syncCompany>[0]);
          sendJson(res, result.success ? 200 : 502, { result });
        } else {
          sendJson(res, 400, { error: 'company or companies array required' });
        }
        return;
      }

      // -----------------------------------------------------------------
      // HubSpot — POST /hubspot/deals/sync
      // -----------------------------------------------------------------
      if (pathname === '/hubspot/deals/sync' && method === 'POST') {
        const body = (await readJsonBody(req)) as { deals?: unknown[]; deal?: unknown };
        const hubspot = getHubSpotService();
        if (Array.isArray(body.deals)) {
          const results = await hubspot.syncDeals(body.deals as Parameters<typeof hubspot.syncDeals>[0]);
          sendJson(res, 200, { results });
        } else if (body.deal) {
          const result = await hubspot.syncDeal(body.deal as Parameters<typeof hubspot.syncDeal>[0]);
          sendJson(res, result.success ? 200 : 502, { result });
        } else {
          sendJson(res, 400, { error: 'deal or deals array required' });
        }
        return;
      }

      // -----------------------------------------------------------------
      // HubSpot — POST /hubspot/activities
      // -----------------------------------------------------------------
      if (pathname === '/hubspot/activities' && method === 'POST') {
        const body = (await readJsonBody(req)) as import('./services/crm/hubspotService').HubSpotActivity;
        const result = await getHubSpotService().trackActivity(body);
        sendJson(res, result.success ? 200 : 502, { result });
        return;
      }

      // -----------------------------------------------------------------
      // HubSpot — POST /hubspot/webhook  (ingest from HubSpot)
      // -----------------------------------------------------------------
      if (pathname === '/hubspot/webhook' && method === 'POST') {
        const rawBody = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          req.on('error', reject);
        });

        const hubspot = getHubSpotService();
        const sigHeader = req.headers['x-hubspot-signature-v3'] as string ?? '';
        const timestamp = req.headers['x-hubspot-request-timestamp'] as string ?? '';
        const reqUrl = `https://${req.headers['host'] ?? 'localhost'}${req.url ?? '/hubspot/webhook'}`;

        const verified = hubspot.verifyWebhookSignature({
          method: 'POST',
          url: reqUrl,
          rawBody,
          timestamp,
          signature: sigHeader,
        });

        if (!verified) {
          sendJson(res, 401, { error: 'webhook signature verification failed' });
          return;
        }

        let events: unknown[];
        try {
          events = JSON.parse(rawBody) as unknown[];
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' });
          return;
        }

        const stats = hubspot.ingestWebhookEvents(
          events as Parameters<typeof hubspot.ingestWebhookEvents>[0],
        );
        sendJson(res, 200, stats);
        return;
      }

      // -----------------------------------------------------------------
      // HubSpot — GET /hubspot/sync-status
      // -----------------------------------------------------------------
      if (pathname === '/hubspot/sync-status' && method === 'GET') {
        const objectType = url.searchParams.get('type') as import('./services/crm/hubspotService').HubSpotObjectType | null;
        const hubspot = getHubSpotService();
        const records = objectType
          ? hubspot.getSyncRecordsByType(objectType)
          : [
              ...hubspot.getSyncRecordsByType('contacts'),
              ...hubspot.getSyncRecordsByType('companies'),
              ...hubspot.getSyncRecordsByType('deals'),
            ];
        sendJson(res, 200, { records, failedSyncs: hubspot.getFailedSyncs() });
        return;
      }

      // -----------------------------------------------------------------
      // HubSpot — GET /hubspot/metrics (JSON)
      // -----------------------------------------------------------------
      if (pathname === '/hubspot/metrics' && method === 'GET') {
        sendJson(res, 200, getHubSpotService().getMetrics());
        return;
      }

      // -----------------------------------------------------------------
      // HubSpot — GET /metrics/hubspot (Prometheus)
      // -----------------------------------------------------------------
      if (pathname === '/metrics/hubspot' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(getHubSpotService().prometheusMetrics());
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
    clearInterval(sessionSweepTimer);
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
        console.info(`[Server] Quota    → GET /quota/policies`);
        console.info(`[Server] Quota    → GET /quota/status?apiKey=...&tier=...`);
        console.info(`[Server] Quota    → POST /quota/check`);
        console.info(`[Server] Quota    → POST /quota/grants`);
        console.info(`[Server] Quota    → GET /quota/metrics`);
        console.info(`[Server] Quota    → GET /metrics/quota`);
        console.info(`[Server] IPList   → GET /ip-whitelist/rules`);
        console.info(`[Server] IPList   → POST /ip-whitelist/rules`);
        console.info(`[Server] IPList   → POST /ip-whitelist/check`);
        console.info(`[Server] IPList   → GET /ip-whitelist/stats`);
        console.info(`[Server] IPList   → GET /ip-whitelist/audit-log`);
        console.info(`[Server] IPList   → GET /metrics/ip-whitelist`);
        console.info(`[Server] Session  → POST /sessions`);
        console.info(`[Server] Session  → GET /sessions/validate`);
        console.info(`[Server] Session  → POST /sessions/touch`);
        console.info(`[Server] Session  → POST /sessions/revoke`);
        console.info(`[Server] Session  → POST /sessions/revoke-all`);
        console.info(`[Server] Session  → POST /sessions/revoke-others`);
        console.info(`[Server] Session  → GET /sessions/user/:userId`);
        console.info(`[Server] Session  → GET /sessions/suspicious`);
        console.info(`[Server] Session  → GET /sessions/stats`);
        console.info(`[Server] Session  → GET /sessions/audit-log`);
        console.info(`[Server] Session  → GET /metrics/sessions`);
        console.info(`[Server] Quota    → GET /quota/status?apiKey=...`);
        console.info(`[Server] Quota    → GET /quota/policies`);
        console.info(`[Server] Quota    → PATCH /quota/policies/:tier`);
        console.info(`[Server] Quota    → POST /quota/grants`);
        console.info(`[Server] Quota    → DELETE /quota/grants/:apiKey`);
        console.info(`[Server] Quota    → GET /quota/metrics`);
        console.info(`[Server] IPWlist  → GET /ip-whitelist/rules`);
        console.info(`[Server] IPWlist  → POST /ip-whitelist/rules`);
        console.info(`[Server] IPWlist  → PATCH /ip-whitelist/rules/:id`);
        console.info(`[Server] IPWlist  → DELETE /ip-whitelist/rules/:id`);
        console.info(`[Server] IPWlist  → POST /ip-whitelist/check`);
        console.info(`[Server] IPWlist  → GET /ip-whitelist/stats`);
        console.info(`[Server] IPWlist  → GET /ip-whitelist/audit`);
        console.info(`[Server] Sessions → POST /sessions`);
        console.info(`[Server] Sessions → GET /sessions/validate`);
        console.info(`[Server] Sessions → GET /sessions/user/:userId`);
        console.info(`[Server] Sessions → DELETE /sessions/:token`);
        console.info(`[Server] Sessions → POST /sessions/revoke-all`);
        console.info(`[Server] Sessions → POST /sessions/revoke-others`);
        console.info(`[Server] Sessions → GET /sessions/suspicious`);
        console.info(`[Server] Sessions → GET /sessions/stats`);
        console.info(`[Server] Sessions → GET /sessions/audit`);
        console.info(`[Server] Sessions → PATCH /sessions/config`);
        console.info(`[Server] HubSpot  → POST /hubspot/contacts/sync`);
        console.info(`[Server] HubSpot  → POST /hubspot/companies/sync`);
        console.info(`[Server] HubSpot  → POST /hubspot/deals/sync`);
        console.info(`[Server] HubSpot  → POST /hubspot/activities`);
        console.info(`[Server] HubSpot  → POST /hubspot/webhook`);
        console.info(`[Server] HubSpot  → GET /hubspot/sync-status`);
        console.info(`[Server] HubSpot  → GET /hubspot/metrics`);
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
