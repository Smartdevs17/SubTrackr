import { compareCursors, decodeCursor, encodeCursor, isValidCursor } from '../cursor';
import { EventScannerError, SorobanEventScanner } from '../eventScanner';
import type {
  CheckpointStore,
  EventScanPage,
  IndexerCheckpoint,
  SorobanEvent,
} from '../types';

function event(id: string, ledger: number, cursor?: string): SorobanEvent {
  return { id, ledger, cursor: cursor ?? encodeCursor(ledger, Number(id.replace(/\D/g, ''))), type: 'payment' };
}

function page(
  events: SorobanEvent[],
  nextCursor: string | null,
  latestLedger = 100,
): EventScanPage {
  return { events, nextCursor, latestLedger };
}

function memoryStore(initial: IndexerCheckpoint | null = null): CheckpointStore & {
  saved: IndexerCheckpoint[];
} {
  let current = initial;
  const saved: IndexerCheckpoint[] = [];
  return {
    saved,
    async load() {
      return current ? { ...current } : null;
    },
    async save(checkpoint) {
      current = { ...checkpoint };
      saved.push({ ...checkpoint });
    },
  };
}

function silentLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('cursor helpers', () => {
  it('round-trips a ledger and sequence and sorts numerically', () => {
    const first = encodeCursor(9, 7);
    const second = encodeCursor(10, 2);

    expect(decodeCursor(first)).toEqual({ ledger: 9, sequence: '7' });
    expect(isValidCursor(first)).toBe(true);
    expect(compareCursors(first, second)).toBe(-1);
    expect(compareCursors(second, first)).toBe(1);
    expect(compareCursors(first, first)).toBe(0);
    expect(compareCursors(null, first)).toBe(-1);
  });

  it('rejects malformed cursors', () => {
    expect(isValidCursor('not-a-cursor')).toBe(false);
    expect(isValidCursor(null)).toBe(false);
    expect(decodeCursor('abc-def')).toBeNull();
  });
});

describe('SorobanEventScanner', () => {
  it('persists events before advancing the checkpoint', async () => {
    const store = memoryStore();
    const order: string[] = [];
    const onEvents = jest.fn(async () => {
      order.push('persist');
    });
    const originalSave = store.save.bind(store);
    store.save = async (checkpoint) => {
      order.push('checkpoint');
      await originalSave(checkpoint);
    };

    const scanner = new SorobanEventScanner({
      scanEvents: jest.fn(async () => page([event('1', 10), event('2', 10)], encodeCursor(10, 3), 12)),
      onEvents,
      checkpointStore: store,
    });

    const result = await scanner.runBatch();

    expect(order).toEqual(['persist', 'checkpoint']);
    expect(result.processed).toBe(2);
    expect(result.reachedTip).toBe(false);
    expect(onEvents).toHaveBeenCalledTimes(1);
    expect(scanner.getCursor()).toBe(encodeCursor(10, 3));
    expect(scanner.getCheckpoint()?.ledger).toBe(10);
    expect(scanner.getMetrics().eventsTotal).toBe(2);
  });

  it('restores a stored checkpoint on initialise', async () => {
    const checkpoint: IndexerCheckpoint = {
      cursor: encodeCursor(42, 1),
      ledger: 42,
      savedAt: '2026-01-01T00:00:00.000Z',
    };
    const store = memoryStore(checkpoint);
    const scanEvents = jest.fn(async () => page([], null, 42));

    const scanner = new SorobanEventScanner({
      scanEvents,
      onEvents: jest.fn(async () => undefined),
      checkpointStore: store,
    });

    await scanner.initialise();
    await scanner.runBatch();

    expect(scanEvents).toHaveBeenCalledWith(checkpoint.cursor, 200);
    expect(scanner.getCheckpoint()?.cursor).toBe(checkpoint.cursor);
  });

  it('retries transient scan failures with backoff and advances after success', async () => {
    const scanEvents = jest
      .fn()
      .mockRejectedValueOnce(new Error('RPC timeout'))
      .mockResolvedValueOnce(page([event('1', 5)], null, 5));

    const scanner = new SorobanEventScanner({
      scanEvents,
      onEvents: jest.fn(async () => undefined),
      retryDelayMs: 0,
    });

    const result = await scanner.runBatch();

    expect(result.processed).toBe(1);
    expect(scanner.getMetrics().retriesTotal).toBe(1);
    expect(scanner.getMetrics().batchesFailed).toBe(0);
    expect(scanner.getCursor()).toBe(encodeCursor(5, 1));
  });

  it('does not checkpoint or mark events seen when persistence fails', async () => {
    const onEvents = jest
      .fn()
      .mockRejectedValueOnce(new Error('DB down'))
      .mockResolvedValueOnce(undefined);
    const store = memoryStore();

    const scanner = new SorobanEventScanner({
      scanEvents: jest.fn(async () => page([event('dup', 7)], null, 7)),
      onEvents,
      checkpointStore: store,
      retryDelayMs: 0,
    });

    const result = await scanner.runBatch();

    expect(result.processed).toBe(1);
    expect(onEvents).toHaveBeenCalledTimes(2);
    expect(store.saved).toHaveLength(1);
    expect(scanner.getMetrics().deduplicatedEvents).toBe(0);
  });

  it('surfaces a typed error when all retries are exhausted', async () => {
    const logger = silentLogger();
    const scanner = new SorobanEventScanner({
      scanEvents: jest.fn(async () => {
        throw new Error('permanent');
      }),
      onEvents: jest.fn(async () => undefined),
      maxRetries: 2,
      retryDelayMs: 0,
      logger,
    });

    await expect(scanner.runBatch()).rejects.toMatchObject({
      name: 'EventScannerError',
      code: 'SCAN_FAILED',
    });
    expect(scanner.getMetrics().batchesFailed).toBe(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it('de-duplicates events across overlapping pages', async () => {
    const shared = event('shared', 3);
    const pages = [
      page([shared, event('a', 3)], encodeCursor(3, 2)),
      page([shared, event('b', 3)], null),
    ];
    let index = 0;
    const scanner = new SorobanEventScanner({
      scanEvents: jest.fn(async () => pages[index++]),
      onEvents: jest.fn(async () => undefined),
    });

    const first = await scanner.runBatch();
    const second = await scanner.runBatch();

    expect(first.processed).toBe(2);
    expect(second.processed).toBe(1);
    expect(scanner.getMetrics().deduplicatedEvents).toBe(1);
  });

  it('drains to the tip and reports ledger lag', async () => {
    const pages = [
      page([event('1', 20)], encodeCursor(20, 1), 21),
      page([event('2', 21)], null, 21),
    ];
    let index = 0;
    const scanner = new SorobanEventScanner({
      scanEvents: jest.fn(async () => pages[index++]),
      onEvents: jest.fn(async () => undefined),
    });

    const processed = await scanner.runToTip(async () => 21, 5);

    expect(processed).toBe(2);
    expect(scanner.getCursor()).toBe(encodeCursor(21, 2));
    expect(scanner.getMetrics().lastBatchAt).not.toBeNull();
    expect(scanner.getMetrics().lagLedgers).toBe(0);
  });

  it('stops polling and rejects batches after close', async () => {
    const scanner = new SorobanEventScanner({
      scanEvents: jest.fn(async () => page([], null)),
      onEvents: jest.fn(async () => undefined),
    });

    await scanner.start(async () => 1, 1000);
    expect(scanner.getMetrics().isRunning).toBe(true);
    scanner.close();
    expect(scanner.getMetrics().isRunning).toBe(false);
    await expect(scanner.runBatch()).rejects.toBeInstanceOf(EventScannerError);
  });

  it('publishes metrics after every batch', async () => {
    const onMetrics = jest.fn();
    const scanner = new SorobanEventScanner({
      scanEvents: jest.fn(async () => page([], null)),
      onEvents: jest.fn(async () => undefined),
      onMetrics,
    });

    expect(onMetrics).not.toHaveBeenCalled();
    await scanner.runBatch();

    expect(onMetrics).toHaveBeenCalled();
    expect(onMetrics.mock.calls[0][0]).toMatchObject({ batchesTotal: 1 });
  });
});
