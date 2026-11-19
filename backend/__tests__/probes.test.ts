import http from 'node:http';
import { startServer } from '../server';
import type { Pool } from '../shared/db/connectionPool';
import { PlanCacheService } from '../subscription/domain/PlanCacheService';
import { InMemoryPlanRepository } from '../subscription/domain/PlanRepository';
import type { RedisClient } from '../shared/cache/types';
import { setPlanCacheService } from '../subscription/planCacheRegistry';

class FakeRedis implements RedisClient {
  public healthy = true;
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<'OK'> {
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
  async keys(): Promise<string[]> {
    return [];
  }
  async ping(): Promise<string> {
    if (!this.healthy) throw new Error('Redis connection refused');
    return 'PONG';
  }
  async quit(): Promise<'OK'> {
    return 'OK';
  }
}

function makeMockPool(healthy = true): Pool {
  return {
    query: jest.fn(async (sql: string) => {
      if (!healthy) throw new Error('Postgres connection timeout');
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
  } as unknown as Pool;
}

function makeBootstrap(redis = new FakeRedis()) {
  const planCache = new PlanCacheService(redis, new InMemoryPlanRepository());
  return { planCache, redis, repository: new InMemoryPlanRepository() };
}

function request(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function listenEphemeral(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

describe('Health and Readiness Probes (Issue #1795)', () => {
  afterEach(() => {
    setPlanCacheService(null);
  });

  it('responds with 200 and uptime on liveness probe endpoints (/health/live, /livez)', async () => {
    const pool = makeMockPool();
    const planBootstrap = makeBootstrap();
    const running = await startServer({ pool, planBootstrap, listen: false });
    const port = await listenEphemeral(running.server);

    const liveRes = await request(port, '/health/live');
    expect(liveRes.status).toBe(200);
    const liveJson = JSON.parse(liveRes.body);
    expect(liveJson.status).toBe('ok');
    expect(typeof liveJson.uptime).toBe('number');

    const livezRes = await request(port, '/livez');
    expect(livezRes.status).toBe(200);
    const livezJson = JSON.parse(livezRes.body);
    expect(livezJson.status).toBe('ok');

    running.removeSignalListeners?.();
    await running.shutdown();
  });

  it('responds with 200 when all dependencies (DB, Redis cache) are ready', async () => {
    const pool = makeMockPool(true);
    const planBootstrap = makeBootstrap();
    const running = await startServer({ pool, planBootstrap, listen: false });
    const port = await listenEphemeral(running.server);

    const readyRes = await request(port, '/health/ready');
    expect(readyRes.status).toBe(200);
    const readyJson = JSON.parse(readyRes.body);
    expect(readyJson.status).toBe('ok');
    expect(readyJson.ready).toBe(true);
    expect(readyJson.checks.database).toBe('ok');
    expect(readyJson.checks.cache).toBe('ok');

    const readyzRes = await request(port, '/readyz');
    expect(readyzRes.status).toBe(200);
    expect(JSON.parse(readyzRes.body).ready).toBe(true);

    running.removeSignalListeners?.();
    await running.shutdown();
  });

  it('responds with 503 degraded when database dependency check fails', async () => {
    const pool = makeMockPool(false); // failing DB query
    const planBootstrap = makeBootstrap();
    const running = await startServer({ pool, planBootstrap, listen: false });
    const port = await listenEphemeral(running.server);

    const readyRes = await request(port, '/health/ready');
    expect(readyRes.status).toBe(503);
    const readyJson = JSON.parse(readyRes.body);
    expect(readyJson.status).toBe('degraded');
    expect(readyJson.ready).toBe(false);
    expect(readyJson.checks.database).toBe('failed');
    expect(readyJson.checks.dbError).toContain('Postgres connection timeout');

    running.removeSignalListeners?.();
    await running.shutdown();
  });

  it('responds with 503 degraded when cache dependency check fails', async () => {
    const pool = makeMockPool(true);
    const fakeRedis = new FakeRedis();
    fakeRedis.healthy = false; // failing cache ping
    const planBootstrap = makeBootstrap(fakeRedis);
    const running = await startServer({ pool, planBootstrap, listen: false });
    const port = await listenEphemeral(running.server);

    const readyRes = await request(port, '/health/ready');
    expect(readyRes.status).toBe(503);
    const readyJson = JSON.parse(readyRes.body);
    expect(readyJson.status).toBe('degraded');
    expect(readyJson.ready).toBe(false);
    expect(readyJson.checks.cache).toBe('failed');

    running.removeSignalListeners?.();
    await running.shutdown();
  });

  it('transitions to draining status during shutdown and marks readiness as terminating', async () => {
    const pool = makeMockPool(true);
    const planBootstrap = makeBootstrap();
    const running = await startServer({ pool, planBootstrap, listen: false });
    const port = await listenEphemeral(running.server);

    // Initial readiness is ok
    const initialRes = await request(port, '/health/ready');
    expect(initialRes.status).toBe(200);
    expect(running.isDraining?.()).toBe(false);

    // Trigger shutdown
    const shutdownPromise = running.shutdown();
    expect(running.isDraining?.()).toBe(true);

    running.removeSignalListeners?.();
    await shutdownPromise;
  });


});
