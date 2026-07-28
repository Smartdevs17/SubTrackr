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
import { applyETagToRawHandler } from './shared/middleware/etagMiddleware';
import { SubscriptionTier } from '../src/types/subscription';
import {
  rpcMonitorService,
  DEFAULT_CHAIN_ENDPOINTS,
  RpcProviderFallback,
} from './services/rpc';

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

function buildRateLimitMiddleware() {
  return createRateLimitMiddleware({
    service: rateLimitingService,
    // Bypass paths (health/metrics/rpc never throttled)
    bypassPaths: ['/health', '/metrics', '/metrics/plan-cache', '/metrics/rpc', '/rpc/dashboard', '/rpc/health', '/rpc/events'],
    // Tier resolver: reads x-subscription-tier header; defaults to FREE
    tierFn: (apiKey, _userId) => {
      // In production this would look up the tier from a DB / cache.
      // For now we use the header injected by an upstream auth layer.
      void apiKey;
      return SubscriptionTier.FREE;
    },
  });
}

/**
 * Apply rate limit middleware inline (no Express).
 * Returns true if the request should continue, false if a 429 was sent.
 */
function applyRateLimit(
  rl: ReturnType<typeof buildRateLimitMiddleware>,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
): boolean {
  let blocked = false;

  const pseudoReq = {
    method: req.method,
    path,
    url: req.url,
    headers: req.headers as Record<string, string | string[] | undefined>,
    ip: (req.socket as { remoteAddress?: string } | null)?.remoteAddress,
  };

  const pseudoRes = {
    setHeader: (name: string, value: string | number) => res.setHeader(name, value),
    writeHead: (status: number, headers?: Record<string, string>) => {
      res.writeHead(status, headers);
    },
    end: (body?: string) => {
      res.end(body);
      blocked = true;
    },
  };

  rl(pseudoReq, pseudoRes, () => {
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

function matchPlanId(pathname: string): string | null {
  const match = pathname.match(/^\/plans\/([^/]+)$/);
  return match?.[1] ?? null;
}
// ── RPC Provider Fallback instances (hot-reloadable) ─────────────────────────
const rpcProviders = new Map<number, RpcProviderFallback>();

function getOrCreateRpcProvider(chainId: number): RpcProviderFallback {
  let provider = rpcProviders.get(chainId);
  if (!provider) {
    const chainConfig = DEFAULT_CHAIN_ENDPOINTS[chainId];
    if (!chainConfig) {
      throw new Error(`No RPC configuration for chain ${chainId}`);
    }
    provider = new RpcProviderFallback(chainConfig, rpcMonitorService);
    rpcProviders.set(chainId, provider);

    // Register circuits with the monitor
    for (const snapshot of provider.getCircuitStates()) {
      rpcMonitorService.registerCircuit(snapshot);
    }
  }
  return provider;
}

function registerAllChainProviders(): void {
  for (const chainIdStr of Object.keys(DEFAULT_CHAIN_ENDPOINTS)) {
    const chainId = Number(chainIdStr);
    try {
      const provider = getOrCreateRpcProvider(chainId);
      for (const snapshot of provider.getCircuitStates()) {
        rpcMonitorService.registerCircuit(snapshot);
      }
    } catch (err) {
      console.warn(`[Server] Could not register RPC provider for chain ${chainId}:`, err);
    }
  }
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const pool = options.pool ?? (await getPool());
  const planBootstrap = options.planBootstrap ?? (await ensurePlanCache(pool));
  const planController = createPlanController({ planCache: planBootstrap.planCache });

  const schema = makeExecutableSchema({ typeDefs, resolvers });
  const graphqlHandler = createHandler({
    schema,
    context: async () => ({
      pool,
      loaders: await createLoaderContext(pool),
    }),
  });

  const rateLimitMw = buildRateLimitMiddleware();

  // Initialize all RPC providers at startup so the dashboard is ready immediately
  registerAllChainProviders();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const { pathname } = url;
    const method = req.method ?? 'GET';

    // Apply ETag caching to all GET requests (auth bypass is built-in)
    applyETagToRawHandler(req, res);

    try {
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
      // RPC Circuit Breaker Dashboard  GET /rpc/dashboard
      // -----------------------------------------------------------------
      if (pathname === '/rpc/dashboard' && method === 'GET') {
        const chainIdParam = url.searchParams.get('chainId');
        const endpointUrl = url.searchParams.get('endpointUrl');
        const eventLimit = url.searchParams.get('eventLimit');

        const query: { chainId?: number; endpointUrl?: string; eventLimit?: number } = {};
        if (chainIdParam) query.chainId = Number(chainIdParam);
        if (endpointUrl) query.endpointUrl = endpointUrl;
        if (eventLimit) query.eventLimit = Number(eventLimit);

        const dashboard = rpcMonitorService.getDashboard(query);
        sendJson(res, 200, dashboard);
        return;
      }

      // -----------------------------------------------------------------
      // RPC Chain Health  GET /rpc/health/:chainId
      // -----------------------------------------------------------------
      const rpcHealthMatch = pathname.match(/^\/rpc\/health\/(\d+)$/);
      if (rpcHealthMatch && method === 'GET') {
        const chainId = Number(rpcHealthMatch[1]);
        const health = rpcMonitorService.getChainHealth(chainId);
        if (!health) {
          sendJson(res, 404, { error: `No health data for chain ${chainId}` });
          return;
        }
        sendJson(res, 200, health);
        return;
      }

      // -----------------------------------------------------------------
      // RPC Circuit Reset  POST /rpc/reset
      // -----------------------------------------------------------------
      if (pathname === '/rpc/reset' && method === 'POST') {
        const body = (await readJsonBody(req)) as {
          chainId: number;
          endpointUrl?: string;
          action: 'reset' | 'open' | 'reset_all' | 'reset_metrics';
        };

        if (!body.chainId || !body.action) {
          sendJson(res, 400, { error: 'chainId and action are required' });
          return;
        }

        const provider = rpcProviders.get(body.chainId);
        if (!provider) {
          sendJson(res, 404, { error: `No RPC provider for chain ${body.chainId}` });
          return;
        }

        switch (body.action) {
          case 'reset':
            if (!body.endpointUrl) {
              sendJson(res, 400, { error: 'endpointUrl is required for reset action' });
              return;
            }
            provider.manualResetEndpoint(body.endpointUrl);
            sendJson(res, 200, { success: true, action: 'reset', endpointUrl: body.endpointUrl });
            return;
          case 'open':
            if (!body.endpointUrl) {
              sendJson(res, 400, { error: 'endpointUrl is required for open action' });
              return;
            }
            provider.manualOpenEndpoint(body.endpointUrl);
            sendJson(res, 200, { success: true, action: 'open', endpointUrl: body.endpointUrl });
            return;
          case 'reset_all':
            provider.manualResetAll();
            sendJson(res, 200, { success: true, action: 'reset_all', chainId: body.chainId });
            return;
          case 'reset_metrics':
            rpcMonitorService.resetAllMetrics();
            sendJson(res, 200, { success: true, action: 'reset_metrics' });
            return;
          default:
            sendJson(res, 400, { error: `Unknown action: ${body.action}` });
            return;
        }
      }

      // -----------------------------------------------------------------
      // RPC Prometheus metrics  GET /metrics/rpc
      // -----------------------------------------------------------------
      if (pathname === '/metrics/rpc' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(rpcMonitorService.getPrometheusMetrics());
        return;
      }

      // -----------------------------------------------------------------
      // RPC Events  GET /rpc/events
      // -----------------------------------------------------------------
      if (pathname === '/rpc/events' && method === 'GET') {
        const limit = url.searchParams.get('limit');
        const events = rpcMonitorService.getRecentEvents(limit ? Number(limit) : 50);
        sendJson(res, 200, { events, count: events.length });
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
      // DB performance dashboard  GET /metrics/db-performance
      // -----------------------------------------------------------------
      if (pathname === '/metrics/db-performance' && method === 'GET') {
        const fmt = url.searchParams.get('format');
        if (fmt === 'prometheus') {
          res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
          // If the pool has a QueryPerformanceMonitor attached, use it
          const monitor = (pool as Pool & { queryMonitor?: { prometheusMetrics(): string } }).queryMonitor;
          res.end(monitor ? monitor.prometheusMetrics() : '# No query monitor attached\n');
        } else {
          sendJson(res, 200, { message: 'Use ?format=prometheus for Prometheus metrics or attach a QueryPerformanceMonitor to pool.queryMonitor' });
        }
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
      const proceed = applyRateLimit(rateLimitMw, req, res, pathname);
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
        sendJson(res, result.success ? 200 : (result.status ?? 400), result);
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
        console.info(`[Server] RPC      → GET /rpc/dashboard`);
        console.info(`[Server] RPC      → GET /rpc/health/:chainId`);
        console.info(`[Server] RPC      → POST /rpc/reset`);
        console.info(`[Server] RPC      → GET /rpc/events`);
        console.info(`[Server] RPC      → GET /metrics/rpc`);
        console.info(`[Server] RateLimit → GET /rate-limits/analytics`);
        console.info(`[Server] RateLimit → GET /rate-limits/status?apiKey=...`);
        console.info(`[Server] RateLimit → POST /rate-limits/bypass`);
        console.info(`[Server] RateLimit → POST /rate-limits/config`);
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

  return { server, pool, planBootstrap, port, shutdown };
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  });
}
