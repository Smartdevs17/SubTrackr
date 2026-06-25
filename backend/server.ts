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

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const { pathname } = url;
    const method = req.method ?? 'GET';

    try {
      if (pathname === '/health' && method === 'GET') {
        const cacheHealthy = await planBootstrap.planCache.isHealthy();
        sendJson(res, 200, {
          status: 'ok',
          planCache: cacheHealthy ? 'redis' : 'degraded',
        });
        return;
      }

      if (pathname === '/metrics/plan-cache' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(planBootstrap.planCache.prometheusMetrics());
        return;
      }

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
