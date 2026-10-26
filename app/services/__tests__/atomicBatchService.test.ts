/**
 * Tests for Issue #919 — Atomic batch execution service.
 */

import {
  AtomicBatchExecutor,
  validateAtomicBatch,
  deriveIdempotencyKey,
  type AtomicBatchItem,
} from '../../services/atomicBatchService';

// ── Helpers ───────────────────────────────────────────────────────────────

const makeItem = (id: string, subId: string): AtomicBatchItem => ({
  id,
  subscriptionId: subId,
  operation: 'charge',
  payload: {},
});

const noopExecute = async (_item: AtomicBatchItem) => {};
const noopSnapshot = async (item: AtomicBatchItem) => ({ subscriptionId: item.subscriptionId });
const noopRollback = async () => {};

// ── validateAtomicBatch ───────────────────────────────────────────────────

describe('validateAtomicBatch', () => {
  it('should pass with a valid set of items', () => {
    const items = [makeItem('1', 'sub_a'), makeItem('2', 'sub_b')];
    const result = validateAtomicBatch(items);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when the batch is empty', () => {
    const result = validateAtomicBatch([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Batch must contain at least one item.');
  });

  it('should fail when the batch exceeds 100 items', () => {
    const items = Array.from({ length: 101 }, (_, i) => makeItem(String(i), `sub_${i}`));
    const result = validateAtomicBatch(items);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('100'))).toBe(true);
  });

  it('should error on empty subscriptionId', () => {
    const items = [makeItem('1', '')];
    const result = validateAtomicBatch(items);
    expect(result.valid).toBe(false);
  });

  it('should warn on duplicate subscriptionIds', () => {
    const items = [makeItem('1', 'sub_a'), makeItem('2', 'sub_a')];
    const result = validateAtomicBatch(items);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('duplicate'))).toBe(true);
  });

  it('should warn when mixing create and cancel', () => {
    const items = [
      { ...makeItem('1', 'sub_a'), operation: 'create' as const },
      { ...makeItem('2', 'sub_b'), operation: 'cancel' as const },
    ];
    const result = validateAtomicBatch(items);
    expect(result.warnings.some((w) => w.includes('cancel'))).toBe(true);
  });
});

// ── deriveIdempotencyKey ──────────────────────────────────────────────────

describe('deriveIdempotencyKey', () => {
  it('should produce a consistent key for the same items', () => {
    const items = [makeItem('1', 'sub_a'), makeItem('2', 'sub_b')];
    expect(deriveIdempotencyKey(items)).toBe(deriveIdempotencyKey(items));
  });

  it('should produce different keys for different items', () => {
    const a = [makeItem('1', 'sub_a')];
    const b = [makeItem('1', 'sub_b')];
    expect(deriveIdempotencyKey(a)).not.toBe(deriveIdempotencyKey(b));
  });

  it('should start with "batch_"', () => {
    const key = deriveIdempotencyKey([makeItem('1', 'sub_a')]);
    expect(key.startsWith('batch_')).toBe(true);
  });
});

// ── AtomicBatchExecutor ───────────────────────────────────────────────────

describe('AtomicBatchExecutor', () => {
  // Use a fresh executor for each test to avoid idempotency key collisions.
  const makeExecutor = () => {
    // Work around the singleton for isolated tests.
    const executor = new (AtomicBatchExecutor as unknown as { new(): AtomicBatchExecutor })();
    return executor;
  };

  it('should return "committed" when all items succeed', async () => {
    const executor = makeExecutor();
    const items = [makeItem('1', 'sub_a'), makeItem('2', 'sub_b')];

    const report = await executor.execute(
      'batch_1',
      items,
      noopExecute,
      noopSnapshot,
      noopRollback
    );

    expect(report.status).toBe('committed');
    expect(report.succeededItems).toBe(2);
    expect(report.failedItems).toBe(0);
    expect(report.rolledBackItems).toBe(0);
  });

  it('should roll back previously succeeded items when failFast=true and one item fails', async () => {
    const executor = makeExecutor();
    const items = [makeItem('1', 'sub_a'), makeItem('2', 'sub_b'), makeItem('3', 'sub_c')];

    let executionCount = 0;
    const rollbackIds: string[] = [];

    const execute = async (item: AtomicBatchItem) => {
      executionCount += 1;
      if (item.id === '2') throw new Error('Payment declined');
    };

    const rollback = async (item: AtomicBatchItem) => {
      rollbackIds.push(item.id);
    };

    const report = await executor.execute(
      'batch_2',
      items,
      execute,
      noopSnapshot,
      rollback,
      undefined,
      { failFast: true }
    );

    expect(report.status).toBe('rolled_back');
    expect(report.rolledBackItems).toBeGreaterThan(0);
    expect(rollbackIds).toContain('1');
    expect(report.rollbackReason).toContain('Payment declined');
    // Item 3 should never have been executed.
    expect(executionCount).toBe(2);
  });

  it('should continue execution when failFast=false', async () => {
    const executor = makeExecutor();
    const items = [makeItem('1', 'sub_a'), makeItem('2', 'sub_b'), makeItem('3', 'sub_c')];

    const execute = async (item: AtomicBatchItem) => {
      if (item.id === '2') throw new Error('Soft failure');
    };

    const report = await executor.execute(
      'batch_3',
      items,
      execute,
      noopSnapshot,
      noopRollback,
      undefined,
      { failFast: false }
    );

    expect(report.status).toBe('committed');
    expect(report.failedItems).toBe(1);
    expect(report.succeededItems).toBe(2);
    expect(report.rolledBackItems).toBe(0);
  });

  it('should reject a duplicate idempotency key', async () => {
    const executor = makeExecutor();
    const items = [makeItem('1', 'sub_unique_idem')];

    await executor.execute('batch_idem', items, noopExecute, noopSnapshot, noopRollback);

    // Second attempt with identical items — same idempotency key.
    const second = await executor.execute('batch_idem', items, noopExecute, noopSnapshot, noopRollback);

    expect(second.status).toBe('failed');
    expect(second.rollbackReason).toContain('Duplicate batch');
  });

  it('should fail with validation errors for an empty batch', async () => {
    const executor = makeExecutor();

    const report = await executor.execute(
      'batch_empty',
      [],
      noopExecute,
      noopSnapshot,
      noopRollback
    );

    expect(report.status).toBe('failed');
    expect(report.rollbackReason).toContain('at least one item');
  });

  it('should invoke the progress callback for each item', async () => {
    const executor = makeExecutor();
    const items = [makeItem('1', 'sub_a'), makeItem('2', 'sub_b')];

    const progressUpdates: number[] = [];
    const onProgress = (completed: number) => progressUpdates.push(completed);

    await executor.execute(
      'batch_progress',
      items,
      noopExecute,
      noopSnapshot,
      noopRollback,
      onProgress
    );

    expect(progressUpdates).toEqual([1, 2]);
  });

  it('should record duration in the report', async () => {
    const executor = makeExecutor();
    const items = [makeItem('1', 'sub_timing')];

    const report = await executor.execute(
      'batch_timing',
      items,
      noopExecute,
      noopSnapshot,
      noopRollback
    );

    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.startedAt).toBeTruthy();
    expect(report.completedAt).toBeTruthy();
  });
});
