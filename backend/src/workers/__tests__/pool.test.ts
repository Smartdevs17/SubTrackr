import type { Pool, PoolClient } from '../../../shared/db/connectionPool';
import { WorkerPoolError, WorkerPoolManager, closeWorkerPoolManager, getWorkerPoolManager } from '../pool';

function makeMockPool() {
  const released = jest.fn();
  const client: PoolClient = {
    query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
    release: released,
  };
  const pool = {
    totalCount: 4,
    idleCount: 2,
    waitingCount: 1,
    max: 20,
    query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: jest.fn(async () => client),
    end: jest.fn(async () => undefined),
    on: jest.fn(),
  } as unknown as Pool;
  return { pool, client, released };
}

describe('WorkerPoolManager', () => {
  it('shares one pool across concurrent callers', async () => {
    const { pool } = makeMockPool();
    const createPool = jest.fn(async () => pool);
    const manager = new WorkerPoolManager({ createPool });

    const [first, second] = await Promise.all([manager.getPool(), manager.getPool()]);

    expect(first).toBe(pool);
    expect(second).toBe(pool);
    expect(createPool).toHaveBeenCalledTimes(1);
  });

  it('retries pool creation after a transient failure', async () => {
    const { pool } = makeMockPool();
    const createPool = jest
      .fn()
      .mockRejectedValueOnce(new Error('startup'))
      .mockResolvedValueOnce(pool);
    const manager = new WorkerPoolManager({ createPool });

    await expect(manager.getPool()).rejects.toMatchObject({
      name: 'WorkerPoolError',
      code: 'POOL_FAILED',
    });
    await expect(manager.getPool()).resolves.toBe(pool);
    expect(createPool).toHaveBeenCalledTimes(2);
  });

  it('registers workers idempotently and enforces the limit', () => {
    const { pool } = makeMockPool();
    const manager = new WorkerPoolManager({ createPool: async () => pool, maxWorkers: 1 });

    const first = manager.registerWorker('job-a');
    expect(manager.registerWorker('job-a')).toBe(first);
    expect(() => manager.registerWorker('job-b')).toThrow(WorkerPoolError);
    expect(() => manager.registerWorker('')).toThrow(WorkerPoolError);
    expect(manager.stats().registeredWorkers).toBe(1);
    expect(manager.stats().peakWorkers).toBe(1);
  });

  it('always releases a borrowed client, including on errors', async () => {
    const { pool, released } = makeMockPool();
    const manager = new WorkerPoolManager({ createPool: async () => pool });

    await manager.withClient(async () => 'ok');
    await expect(
      manager.withClient(async () => {
        throw new Error('query failed');
      }),
    ).rejects.toThrow('query failed');

    expect(released).toHaveBeenCalledTimes(2);
    expect(manager.stats().acquisitions).toBe(2);
    expect(manager.stats().releases).toBe(2);
  });

  it('drains registered workers before closing the pool', async () => {
    const { pool } = makeMockPool();
    const manager = new WorkerPoolManager({
      createPool: async () => pool,
      drainTimeoutMs: 5000,
    });
    await manager.getPool();
    manager.registerWorker('job-a');

    const closing = manager.close();
    expect(manager.stats().closing).toBe(true);
    expect(pool.end).not.toHaveBeenCalled();

    manager.unregisterWorker('job-a');
    await closing;

    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(manager.stats().closing).toBe(true);
    expect(() => manager.registerWorker('job-b')).toThrow(WorkerPoolError);
  });

  it('returns immediately from a second close', async () => {
    const { pool } = makeMockPool();
    const manager = new WorkerPoolManager({ createPool: async () => pool, drainTimeoutMs: 0 });

    await manager.close();
    await manager.close();

    expect(pool.end).not.toHaveBeenCalled();
  });

  it('closes the pool only once for concurrent callers', async () => {
    const { pool } = makeMockPool();
    const manager = new WorkerPoolManager({ createPool: async () => pool, drainTimeoutMs: 0 });
    await manager.getPool();

    await Promise.all([manager.close(), manager.close()]);

    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('publishes metrics and emits lifecycle events', async () => {
    const { pool } = makeMockPool();
    const onMetrics = jest.fn();
    const manager = new WorkerPoolManager({
      createPool: async () => pool,
      onMetrics,
    });
    const events: string[] = [];
    manager.on('pool:created', () => events.push('pool:created'));
    manager.on('worker:registered', () => events.push('worker:registered'));
    manager.on('worker:unregistered', () => events.push('worker:unregistered'));
    manager.on('drain:start', () => events.push('drain:start'));
    manager.on('closed', () => events.push('closed'));

    await manager.getPool();
    manager.registerWorker('job-a');
    manager.unregisterWorker('job-a');
    await manager.close();

    expect(events).toEqual([
      'pool:created',
      'worker:registered',
      'worker:unregistered',
      'drain:start',
      'closed',
    ]);
    expect(onMetrics).toHaveBeenCalled();
    expect(onMetrics.mock.calls[onMetrics.mock.calls.length - 1][0]).toMatchObject({
      registeredWorkers: 0,
    });
  });

  it('rejects getPool after close', async () => {
    const { pool } = makeMockPool();
    const manager = new WorkerPoolManager({ createPool: async () => pool, drainTimeoutMs: 0 });
    await manager.close();

    await expect(manager.getPool()).rejects.toMatchObject({ code: 'CLOSED' });
  });

  it('exposes a process-wide singleton', async () => {
    await closeWorkerPoolManager();
    const first = getWorkerPoolManager();
    expect(getWorkerPoolManager()).toBe(first);
    await closeWorkerPoolManager();
  });
});
