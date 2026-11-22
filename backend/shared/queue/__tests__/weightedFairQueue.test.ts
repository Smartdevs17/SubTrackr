import { PriorityQueue } from '../priorityQueue';
import {
  WeightedFairQueue,
  computeEffectiveWeights,
  resolveBackpressure,
  selectNextPriority,
} from '../weightedFairQueue';
import { DEFAULT_PRIORITY_WEIGHTS, type PriorityClass } from '../types';

function makeMockConnection() {
  return {} as never;
}

function makeQueues(maxSize = 100) {
  const store = new Map<string, Map<string, unknown>>();

  const factory = (priority: PriorityClass) => {
    if (!store.has(priority)) store.set(priority, new Map());
    const bucket = store.get(priority)!;

    return () => ({
      add: jest.fn(async (name: string, _data: unknown, opts?: { jobId?: string }) => {
        const id = opts?.jobId ?? `${priority}_${bucket.size + 1}`;
        bucket.set(id, { name });
        return { id };
      }),
      getJob: jest.fn(async (id: string) => {
        if (!bucket.has(id)) return undefined;
        return { remove: jest.fn(async (): Promise<void> => { bucket.delete(id); }) };
      }),
      getWaitingCount: jest.fn(async () => bucket.size),
      pause: jest.fn(async () => undefined),
      resume: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
    });
  };

  const make = (priority: PriorityClass) =>
    new PriorityQueue({
      connection: makeMockConnection(),
      baseQueueName: 'subtrackr',
      priority,
      maxSize,
      queueFactory: factory(priority),
    });

  return {
    critical: make('critical'),
    high: make('high'),
    normal: make('normal'),
    low: make('low'),
  };
}

describe('computeEffectiveWeights', () => {
  it('returns base weights when all queues have work', () => {
    const depths = { critical: 5, high: 3, normal: 2, low: 1 };
    const weights = computeEffectiveWeights(DEFAULT_PRIORITY_WEIGHTS, depths, new Set());
    expect(weights.critical).toBeCloseTo(50, 0);
    expect(weights.high).toBeCloseTo(25, 0);
    expect(weights.normal).toBeCloseTo(15, 0);
    expect(weights.low).toBeCloseTo(10, 0);
  });

  it('redistributes idle critical capacity to active queues', () => {
    const depths = { critical: 0, high: 10, normal: 5, low: 3 };
    const weights = computeEffectiveWeights(DEFAULT_PRIORITY_WEIGHTS, depths, new Set());

    expect(weights.critical).toBe(0);
    expect(weights.high).toBeGreaterThan(25);
    expect(weights.normal).toBeGreaterThan(15);
    expect(weights.low).toBeGreaterThan(10);
    expect(weights.high + weights.normal + weights.low).toBeCloseTo(100, 0);
  });

  it('guarantees low priority at least 1% when it has jobs', () => {
    const depths = { critical: 100, high: 100, normal: 100, low: 5 };
    const weights = computeEffectiveWeights(DEFAULT_PRIORITY_WEIGHTS, depths, new Set());
    const total = weights.critical + weights.high + weights.normal + weights.low;
    expect(weights.low / total).toBeGreaterThanOrEqual(0.01);
  });

  it('zeros paused queues', () => {
    const depths = { critical: 10, high: 10, normal: 10, low: 10 };
    const weights = computeEffectiveWeights(DEFAULT_PRIORITY_WEIGHTS, depths, new Set(['low']));
    expect(weights.low).toBe(0);
  });
});

describe('selectNextPriority', () => {
  it('favours critical jobs under default weights', () => {
    const deficits = { critical: 0, high: 0, normal: 0, low: 0 };
    const depths = { critical: 10, high: 10, normal: 10, low: 10 };
    const weights = { ...DEFAULT_PRIORITY_WEIGHTS };

    const picks: PriorityClass[] = [];
    for (let i = 0; i < 20; i++) {
      const next = selectNextPriority(deficits, depths, weights, new Set());
      if (next) picks.push(next);
    }

    const criticalCount = picks.filter((p) => p === 'critical').length;
    const lowCount = picks.filter((p) => p === 'low').length;
    expect(criticalCount).toBeGreaterThan(lowCount);
  });

  it('returns null when all queues are empty', () => {
    const deficits = { critical: 0, high: 0, normal: 0, low: 0 };
    const depths = { critical: 0, high: 0, normal: 0, low: 0 };
    const result = selectNextPriority(deficits, depths, DEFAULT_PRIORITY_WEIGHTS, new Set());
    expect(result).toBeNull();
  });

  it('skips paused queues', () => {
    const deficits = { critical: 0, high: 0, normal: 0, low: 0 };
    const depths = { critical: 5, high: 0, normal: 0, low: 10 };
    const result = selectNextPriority(deficits, depths, DEFAULT_PRIORITY_WEIGHTS, new Set(['low']));
    expect(result).toBe('critical');
  });
});

describe('resolveBackpressure', () => {
  it('pauses low first when all queues are full', () => {
    const depths = { critical: 100, high: 100, normal: 100, low: 100 };
    const result = resolveBackpressure(depths, 100, new Set());
    expect(result).toBe('low');
  });

  it('pauses normal when low is already paused', () => {
    const depths = { critical: 100, high: 100, normal: 100, low: 100 };
    const result = resolveBackpressure(depths, 100, new Set(['low']));
    expect(result).toBe('normal');
  });

  it('returns null when queues are not all full', () => {
    const depths = { critical: 100, high: 50, normal: 100, low: 100 };
    const result = resolveBackpressure(depths, 100, new Set());
    expect(result).toBeNull();
  });

  it('never pauses critical', () => {
    const depths = { critical: 100, high: 100, normal: 100, low: 100 };
    const paused = new Set<PriorityClass>(['low', 'normal', 'high']);
    const result = resolveBackpressure(depths, 100, paused);
    expect(result).toBeNull();
  });
});

describe('WeightedFairQueue', () => {
  it('schedules jobs respecting WFQ weights', async () => {
    const queues = makeQueues();
    const wfq = new WeightedFairQueue(queues);

    for (let i = 0; i < 50; i++) await queues.critical.add('c', { i });
    for (let i = 0; i < 50; i++) await queues.low.add('l', { i });

    const picks: PriorityClass[] = [];
    for (let i = 0; i < 60; i++) {
      const next = await wfq.scheduleNext();
      if (next) picks.push(next.priority);
    }

    const criticalCount = picks.filter((p) => p === 'critical').length;
    const lowCount = picks.filter((p) => p === 'low').length;
    expect(criticalCount).toBeGreaterThan(lowCount * 2);
  });

  it('routes spawnSubJob to the correct priority queue', async () => {
    const queues = makeQueues();
    const wfq = new WeightedFairQueue(queues);

    await wfq.spawnSubJob('critical', 'urgent-child', { id: 1 });

    expect(queues.critical.depth).toBe(1);
    expect(queues.low.depth).toBe(0);

    const next = await wfq.scheduleNext();
    expect(next?.priority).toBe('critical');
    expect(next?.job.name).toBe('urgent-child');
  });

  it('auto-applies backpressure on enqueue when all queues full', async () => {
    const queues = makeQueues(2);
    const wfq = new WeightedFairQueue(queues, { maxQueueSize: 2 });

    await wfq.enqueue('critical', 'c1', {});
    await wfq.enqueue('critical', 'c2', {});
    await wfq.enqueue('high', 'h1', {});
    await wfq.enqueue('high', 'h2', {});
    await wfq.enqueue('normal', 'n1', {});
    await wfq.enqueue('normal', 'n2', {});
    await wfq.enqueue('low', 'l1', {});
    await wfq.enqueue('low', 'l2', {});

    await expect(wfq.enqueue('low', 'l3', {})).rejects.toThrow('paused');
    expect(queues.low.isPaused).toBe(true);
  });

  it('processNext executes handler and records metrics', async () => {
    const queues = makeQueues();
    const wfq = new WeightedFairQueue(queues);
    const handler = jest.fn(async () => undefined);

    await wfq.enqueue('critical', 'test:job', { value: 42 });

    const processed = await wfq.processNext({ 'test:job': handler });
    expect(processed).toBe(true);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ data: { value: 42 } }));
    expect(queues.critical.getStats().totalProcessed).toBe(1);
  });

  it('records completion metrics and SLO violations', async () => {
    const queues = makeQueues();
    const wfq = new WeightedFairQueue(queues);

    const job = await queues.critical.add('pay', { id: '1' });
    await wfq.scheduleNext();

    const enqueuedAt = Date.now() - 35_000;
    const staleJob = { ...job, enqueuedAt };
    wfq.recordCompletion('critical', staleJob, 200);

    expect(queues.critical.getStats().sloViolations).toBe(1);
    expect(queues.critical.getStats().lastProcessingTimeMs).toBe(200);
  });

  it('exposes scheduler snapshot with effective weights', async () => {
    const queues = makeQueues();
    const wfq = new WeightedFairQueue(queues);

    await queues.high.add('h', {});
    const snapshot = wfq.getSnapshot();

    expect(snapshot.depths.high).toBe(1);
    expect(snapshot.depths.critical).toBe(0);
    expect(snapshot.effectiveWeights.critical).toBe(0);
    expect(snapshot.effectiveWeights.high).toBeGreaterThan(25);
  });

  it('distributes capacity close to target weights over many rounds', () => {
    const deficits = { critical: 0, high: 0, normal: 0, low: 0 };
    const depths = { critical: 1000, high: 1000, normal: 1000, low: 1000 };
    const counts = { critical: 0, high: 0, normal: 0, low: 0 };

    for (let i = 0; i < 1000; i++) {
      const w = computeEffectiveWeights(DEFAULT_PRIORITY_WEIGHTS, depths, new Set());
      const p = selectNextPriority(deficits, depths, w, new Set());
      if (p) counts[p]++;
    }

    expect(counts.critical / 1000).toBeGreaterThan(0.4);
    expect(counts.high / 1000).toBeGreaterThan(0.15);
    expect(counts.low / 1000).toBeGreaterThan(0.05);
  });
});
