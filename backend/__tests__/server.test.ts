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

function request(
  port: number,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : undefined,
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
});
