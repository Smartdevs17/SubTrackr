import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  SorobanRpcPool,
  SorobanRpcPoolError,
  createFetchSorobanConnector,
  prewarmSorobanRpcPoolAtBoot,
  resetSorobanRpcPoolForTests,
  sorobanEndpointsFromEnvironment,
  type SorobanRpcConnection,
  type SorobanRpcConnector,
  type SorobanRpcEndpoint,
  type SorobanRpcPoolMetrics,
} from '../pool.ts';

const endpoints: SorobanRpcEndpoint[] = [
  { id: 'rpc-a', url: 'https://rpc-a.example.com', network: 'mainnet' },
  { id: 'rpc-b', url: 'https://rpc-b.example.com', network: 'testnet' },
];

function fakeConnector(failing: string[] = []): {
  connector: SorobanRpcConnector;
  calls: string[];
} {
  const calls: string[] = [];
  const connector: SorobanRpcConnector = async (endpoint) => {
    calls.push(endpoint.id);
    if (failing.includes(endpoint.id)) throw new Error(`${endpoint.id} is down`);
    const connection: SorobanRpcConnection = {
      endpointId: endpoint.id,
      close: () => undefined,
    };
    return connection;
  };
  return { connector, calls };
}

afterEach(() => resetSorobanRpcPoolForTests());

test('pre-warms every endpoint before the first job and reuses idle connections', async () => {
  const { connector, calls } = fakeConnector();
  const emitted: SorobanRpcPoolMetrics[] = [];
  const pool = new SorobanRpcPool({
    endpoints,
    connector,
    onMetrics: (metrics) => emitted.push(metrics),
    now: () => 123,
  });

  const metrics = await pool.warmup();
  assert.equal(calls.length, 2);
  assert.equal(metrics.attempts, 2);
  assert.equal(metrics.warmed, 2);
  assert.equal(metrics.failed, 0);
  assert.equal(metrics.durationMs, 0);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].warmed, 2);

  const connection = await pool.acquire();
  assert.equal(calls.length, 2, 'acquire must not open a new connection');
  assert.equal(pool.stats().reused, 1);
  assert.equal(pool.stats().inUse, 1);
  pool.release(connection);
  assert.equal(pool.stats().idle, 2);
  pool.close();
});

test('a dead endpoint is recorded but does not fail boot or block the healthy one', async () => {
  const { connector } = fakeConnector(['rpc-b']);
  const warnings: string[] = [];
  const pool = new SorobanRpcPool({
    endpoints,
    connector,
    logger: {
      info: () => undefined,
      warn: (message) => warnings.push(message),
      error: () => undefined,
    },
  });

  const metrics = await pool.warmup();
  assert.equal(metrics.warmed, 1);
  assert.equal(metrics.failed, 1);
  assert.deepEqual(metrics.failedEndpoints, ['rpc-b']);
  assert.equal(warnings.length, 1);
  assert.equal(pool.stats().idle, 1);

  const connection = await pool.acquire();
  assert.equal(connection.endpointId, 'rpc-a');
  pool.release(connection);
  pool.close();
});

test('a hanging RPC connection times out, aborts, and is counted as failed', async () => {
  let signal: AbortSignal | undefined;
  const connector: SorobanRpcConnector = async (_endpoint, abortSignal) => {
    signal = abortSignal;
    return new Promise<SorobanRpcConnection>(() => undefined);
  };
  const pool = new SorobanRpcPool({
    endpoints: [endpoints[0]],
    connector,
    warmupTimeoutMs: 10,
  });

  const metrics = await pool.warmup();
  assert.equal(metrics.failed, 1);
  assert.equal(metrics.warmed, 0);
  assert.equal(signal?.aborted, true);
  pool.close();
});

test('boot pre-warm is idempotent and never rejects when a node is down', async () => {
  const { connector } = fakeConnector(['rpc-b']);
  const first = prewarmSorobanRpcPoolAtBoot({ endpoints, connector });
  const second = prewarmSorobanRpcPoolAtBoot({ endpoints, connector });

  assert.equal(first.pool, second.pool);
  assert.equal(first.warmup, second.warmup);
  const metrics = await first.warmup;
  assert.equal(metrics.warmed, 1);
  assert.equal(metrics.failed, 1);
  assert.equal(first.pool.stats().warmed, 1);
});

test('close drains connections and later acquisitions fail with CLOSED', async () => {
  const { connector } = fakeConnector();
  const pool = new SorobanRpcPool({ endpoints, connector });
  await pool.warmup();

  const connection = await pool.acquire();
  let closeCalls = 0;
  connection.close = () => {
    closeCalls += 1;
  };
  pool.close();
  pool.close();

  assert.equal(closeCalls, 1, 'close is idempotent');
  assert.equal(pool.stats().closed, true);
  assert.equal(pool.stats().idle, 0);
  await assert.rejects(
    () => pool.acquire(),
    (error: unknown) => error instanceof SorobanRpcPoolError && error.code === 'CLOSED',
  );
});

test('default connector sends a getHealth probe and surfaces bad responses', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;

  try {
    const pool = new SorobanRpcPool({
      endpoints: [endpoints[0]],
      connector: createFetchSorobanConnector(),
    });
    const metrics = await pool.warmup();
    assert.equal(metrics.warmed, 1);
    assert.equal(JSON.parse(bodies[0]).method, 'getHealth');

    pool.close();

    globalThis.fetch = (async () => ({ ok: false, status: 503 }) as Response) as typeof fetch;
    const failingPool = new SorobanRpcPool({
      endpoints: [endpoints[0]],
      connector: createFetchSorobanConnector(),
    });
    await assert.rejects(
      () => failingPool.acquire(),
      (error: unknown) => error instanceof SorobanRpcPoolError && error.code === 'CONNECT_FAILED',
    );
    failingPool.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('endpoint configuration is validated and env overrides are parsed', () => {
  assert.throws(
    () => new SorobanRpcPool({ endpoints: [] }),
    (error: unknown) => error instanceof SorobanRpcPoolError && error.code === 'INVALID_ENDPOINTS',
  );
  assert.throws(
    () => new SorobanRpcPool({ endpoints: [{ id: 'x', url: 'ftp://nope' }] }),
    (error: unknown) => error instanceof SorobanRpcPoolError && error.code === 'INVALID_ENDPOINTS',
  );

  const parsed = sorobanEndpointsFromEnvironment({
    SOROBAN_RPC_URLS: 'https://one.example.com, https://two.example.com',
    STELLAR_NETWORK: 'testnet',
  });
  assert.deepEqual(
    parsed.map((endpoint) => endpoint.url),
    ['https://one.example.com', 'https://two.example.com'],
  );
  assert.equal(parsed[0].network, 'testnet');
  assert.equal(sorobanEndpointsFromEnvironment({}).length, 2);
});
