import type { JobsOptions } from 'bullmq';
import { PriorityQueue } from '../priorityQueue';
import type { PriorityClass } from '../types';

function makeMockConnection() {
  return {} as never;
}

function makeMockQueueFactory() {
  const added: Array<{ name: string; data: unknown; opts?: JobsOptions; id: string }> = [];
  const store = new Map<string, { name: string; data: unknown }>();

  const factory = () => ({
    add: jest.fn(async (name: string, data: unknown, opts?: JobsOptions) => {
      const id = (opts?.jobId as string) ?? `job_${added.length + 1}`;
      added.push({ name, data, opts, id });
      store.set(id, { name, data });
      return { id };
    }),
    getJob: jest.fn(async (id: string) => {
      if (!store.has(id)) return undefined;
      return {
        remove: jest.fn(async () => {
          store.delete(id);
        }),
      };
    }),
    getWaitingCount: jest.fn(async () => store.size),
    pause: jest.fn(async () => undefined),
    resume: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  });

  return { factory, added, store };
}

describe('PriorityQueue', () => {
  it('enqueues with BullMQ priority mapped from class', async () => {
    const { factory, added } = makeMockQueueFactory();
    const queue = new PriorityQueue({
      connection: makeMockConnection(),
      baseQueueName: 'subtrackr',
      priority: 'critical',
      queueFactory: factory,
    });

    await queue.add('payment:confirm', { id: 'tx_1' });

    expect(added).toHaveLength(1);
    expect(added[0].opts?.priority).toBe(1);
    expect(queue.depth).toBe(1);
  });

  it('rejects spawnSubJob when parent priority does not match queue class', async () => {
    const { factory } = makeMockQueueFactory();
    const queue = new PriorityQueue({
      connection: makeMockConnection(),
      baseQueueName: 'subtrackr',
      priority: 'low',
      queueFactory: factory,
    });

    await expect(queue.spawnSubJob('child', { step: 2 }, 'critical')).rejects.toThrow(
      'Use WeightedFairQueue.spawnSubJob()',
    );
  });

  it('allows spawnSubJob when parent priority matches queue class', async () => {
    const { factory, added } = makeMockQueueFactory();
    const queue = new PriorityQueue({
      connection: makeMockConnection(),
      baseQueueName: 'subtrackr',
      priority: 'critical',
      queueFactory: factory,
    });

    await queue.spawnSubJob('child', { step: 2 }, 'critical');

    expect(added[0].opts?.priority).toBe(1);
    expect(queue.peek()?.priority).toBe('critical');
  });

  it('throws when queue is at capacity', async () => {
    const { factory } = makeMockQueueFactory();
    const queue = new PriorityQueue({
      connection: makeMockConnection(),
      baseQueueName: 'subtrackr',
      priority: 'normal',
      maxSize: 2,
      queueFactory: factory,
    });

    await queue.add('a', {});
    await queue.add('b', {});
    await expect(queue.add('c', {})).rejects.toThrow('at capacity');
  });

  it('rejects enqueue when paused', async () => {
    const { factory } = makeMockQueueFactory();
    const queue = new PriorityQueue({
      connection: makeMockConnection(),
      baseQueueName: 'subtrackr',
      priority: 'low',
      queueFactory: factory,
    });

    await queue.pause();
    await expect(queue.add('job', {})).rejects.toThrow('paused');
  });

  it('removes job from BullMQ when dequeued', async () => {
    const { factory, store } = makeMockQueueFactory();
    const queue = new PriorityQueue({
      connection: makeMockConnection(),
      baseQueueName: 'subtrackr',
      priority: 'critical',
      queueFactory: factory,
    });

    await queue.add('pay', { id: '1' });
    expect(store.size).toBe(1);

    const job = await queue.dequeue();
    expect(job).toBeDefined();
    expect(store.size).toBe(0);
    expect(queue.depth).toBe(0);
  });

  it('records SLO violations for critical jobs exceeding 30s wait', () => {
    const { factory } = makeMockQueueFactory();
    const queue = new PriorityQueue({
      connection: makeMockConnection(),
      baseQueueName: 'subtrackr',
      priority: 'critical',
      queueFactory: factory,
    });

    queue.recordProcessed(35_000, 500, 'critical');
    expect(queue.getStats().sloViolations).toBe(1);

    queue.recordProcessed(10_000, 200, 'critical');
    expect(queue.getStats().sloViolations).toBe(1);
  });

  it('pauses and resumes dequeue', async () => {
    const { factory } = makeMockQueueFactory();
    const queue = new PriorityQueue({
      connection: makeMockConnection(),
      baseQueueName: 'subtrackr',
      priority: 'low',
      queueFactory: factory,
    });

    await queue.add('job', {});
    await queue.pause();
    expect(await queue.dequeue()).toBeUndefined();

    await queue.resume();
    expect(await queue.dequeue()).toBeDefined();
  });

  it('maps each priority class to the correct BullMQ value', async () => {
    const expected: Record<PriorityClass, number> = {
      critical: 1,
      high: 2,
      normal: 3,
      low: 4,
    };

    for (const [cls, bullPriority] of Object.entries(expected) as [PriorityClass, number][]) {
      const { factory, added } = makeMockQueueFactory();
      const queue = new PriorityQueue({
        connection: makeMockConnection(),
        baseQueueName: 'subtrackr',
        priority: cls,
        queueFactory: factory,
      });
      await queue.add('test', {});
      expect(added[0].opts?.priority).toBe(bullPriority);
    }
  });
});
