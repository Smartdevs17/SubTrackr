import http from 'node:http';
import { startServer } from '../server';
import type { Pool } from '../shared/db/connectionPool';
import { PlanCacheService } from '../subscription/domain/PlanCacheService';
import { InMemoryPlanRepository } from '../subscription/domain/PlanRepository';
import type { RedisClient } from '../shared/cache/types';
import { setPlanCacheService } from '../subscription/planCacheRegistry';

class FakeRedis implements RedisClient {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.store.get(key) ?? null; }
  async set(key: string, value: string): Promise<'OK'> { this.store.set(key, value); return 'OK'; }
  async del(): Promise<number> { return 1; }
  async keys(): Promise<string[]> { return []; }
  async ping(): Promise<string> { return 'PONG'; }
  async quit(): Promise<'OK'> { return 'OK'; }
}

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

function makeBootstrap() {
  const redis = new FakeRedis();
  const planCache = new PlanCacheService(redis, new InMemoryPlanRepository());
  return { planCache, redis, repository: new InMemoryPlanRepository() };
}

async function listenEphemeral(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

describe('Graceful Shutdown & Connection Draining (Issue #1792)', () => {
  afterEach(() => {
    setPlanCacheService(null);
  });

  it('drains in-flight requests and waits for completion before shutdown resolves', async () => {
    const pool = makeMockPool();
    const planBootstrap = makeBootstrap();
    const running = await startServer({
      pool,
      planBootstrap,
      listen: false,
      drainTimeoutMs: 5_000,
    });
    const port = await listenEphemeral(running.server);

    let requestCompleted = false;

    // Send a request to an endpoint
    const reqPromise = new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/health/live', method: 'GET' },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => {
            requestCompleted = true;
            resolve({ status: res.statusCode ?? 0 });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });

    const response = await reqPromise;
    expect(response.status).toBe(200);
    expect(requestCompleted).toBe(true);
    expect(running.getInFlightRequests?.()).toBe(0);

    running.removeSignalListeners?.();
    await running.shutdown();
  });

  it('forces socket closure when in-flight request exceeds drain timeout', async () => {
    const pool = makeMockPool();
    const planBootstrap = makeBootstrap();

    // Configure a short drain timeout (200ms)
    const running = await startServer({
      pool,
      planBootstrap,
      listen: false,
      drainTimeoutMs: 200,
    });
    const port = await listenEphemeral(running.server);

    // Open an uncompleted connection that stays active
    const client = http.request({
      host: '127.0.0.1',
      port,
      path: '/plans',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    // Swallow the expected ECONNRESET/socket hang up when the server forcefully closes the socket
    client.on('error', () => {});
    // Send partial body and do not end the stream yet to keep request in-flight
    client.write('{"name": "Hang');


    // Give the server 50ms to register the connection
    await new Promise((r) => setTimeout(r, 50));
    expect(running.getInFlightRequests?.()).toBeGreaterThanOrEqual(1);

    const start = Date.now();
    running.removeSignalListeners?.();
    // Shutdown should wait up to drainTimeoutMs (200ms) then force socket destruction
    await running.shutdown();
    const duration = Date.now() - start;

    expect(duration).toBeGreaterThanOrEqual(150);
    expect(running.isDraining?.()).toBe(true);

    client.destroy();
    await new Promise((r) => setTimeout(r, 50));
  });


  it('registers and removes signal listeners cleanly', async () => {
    const pool = makeMockPool();
    const planBootstrap = makeBootstrap();
    const running = await startServer({
      pool,
      planBootstrap,
      listen: false,
    });

    expect(typeof running.removeSignalListeners).toBe('function');
    // Remove signal listeners so process signal table is not polluted
    running.removeSignalListeners?.();

    await running.shutdown();
  });
});
