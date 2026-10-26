import {
  BatchTransactionService,
  DEFAULT_BATCH_CONFIGS,
  computeBatchAnalytics,
  getDefaultBatchConfig,
  toHistoryEntry,
  validateBatchSizeFor,
  clearBatchHistory,
  type BatchCreateInput,
  type BatchHistoryEntry,
  type CancelReason,
  type PerItemResult,
} from '../batchTransactionService';

const createInput = (name: string): BatchCreateInput => ({
  name,
  category: 'streaming',
  price: 9.99,
  currency: 'USD',
  billingCycle: 'monthly',
});

const chargeItems = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ subscriptionId: `sub_${i + 1}`, amount: 100 }));

const historyEntry = (patch: Partial<BatchHistoryEntry>): BatchHistoryEntry => ({
  batchId: patch.batchId ?? 'batch_1',
  operationType: patch.operationType ?? 'charge',
  state: patch.state ?? 'completed',
  totalItems: patch.totalItems ?? 10,
  successfulItems: patch.successfulItems ?? 10,
  failedItems: patch.failedItems ?? 0,
  timestamp: patch.timestamp ?? '2026-01-01T00:00:00.000Z',
  summary: patch.summary ?? 'charge: 10/10 succeeded',
  skippedItems: patch.skippedItems,
  durationMs: patch.durationMs,
  rolledBack: patch.rolledBack,
});

beforeEach(async () => {
  await clearBatchHistory();
});

describe('per-operation configuration', () => {
  it('applies conservative defaults to money movement', () => {
    expect(DEFAULT_BATCH_CONFIGS.charge.atomicDefault).toBe(true);
    expect(DEFAULT_BATCH_CONFIGS.charge.maxItems).toBe(50);
    // Cancellation is terminal and customer-visible, so it is not reversible.
    expect(DEFAULT_BATCH_CONFIGS.cancel.allowRollback).toBe(false);
    expect(DEFAULT_BATCH_CONFIGS.create.allowRollback).toBe(true);
  });

  it('hands out copies so callers cannot mutate the shared defaults', () => {
    const config = getDefaultBatchConfig('create');
    config.maxItems = 1;
    expect(DEFAULT_BATCH_CONFIGS.create.maxItems).toBe(100);
  });

  it('merges instance overrides over the defaults', () => {
    const service = new BatchTransactionService();
    service.setOperationConfig('charge', { maxItems: 5, atomicDefault: false });

    const config = service.getOperationConfig('charge');
    expect(config.maxItems).toBe(5);
    expect(config.atomicDefault).toBe(false);
    // Untouched fields keep their defaults.
    expect(config.retryDelayMs).toBe(DEFAULT_BATCH_CONFIGS.charge.retryDelayMs);
  });

  it('lets an explicit chunk size win over the configured one', () => {
    const service = new BatchTransactionService(7);
    service.setOperationConfig('charge', { chunkSize: 25 });
    expect(service.getOperationConfig('charge').chunkSize).toBe(7);
  });

  it('clamps chunk size into the supported range', () => {
    const service = new BatchTransactionService(0);
    expect(service.getOperationConfig('create').chunkSize).toBe(1);
    service.setChunkSize(9999);
    expect(service.getOperationConfig('create').chunkSize).toBe(200);
  });

  it('uses the configured atomicity when the caller states no preference', async () => {
    const service = new BatchTransactionService();
    const result = await service.executeBatchCharge(chargeItems(2), async (id) => ({
      success: id === 'sub_1',
      error: 'no such subscription',
    }));

    // charge defaults to atomic, so the successful item is discarded too.
    expect(result.atomic).toBe(true);
    expect(result.rolledBack).toBe(true);
    expect(result.successfulItems).toBe(0);
    expect(result.state).toBe('failed');
  });

  it('rejects a batch that exceeds the configured ceiling without applying anything', async () => {
    const service = new BatchTransactionService();
    service.setOperationConfig('charge', { maxItems: 2 });
    const applied: string[] = [];

    const result = await service.executeBatchCharge(chargeItems(3), async (id) => {
      applied.push(id);
      return { success: true };
    });

    expect(result.state).toBe('failed');
    expect(result.rejectionReason).toContain('limited to 2 items');
    expect(applied).toEqual([]);
  });

  it('validates item counts against a config', () => {
    expect(validateBatchSizeFor('create', 0).valid).toBe(false);
    expect(validateBatchSizeFor('create', 100).valid).toBe(true);
    expect(validateBatchSizeFor('create', 101).valid).toBe(false);
    expect(validateBatchSizeFor('charge', 51).reason).toContain('50 items');
  });
});

describe('status tracking and timing', () => {
  it('reports processing while items are in flight and completed at the end', async () => {
    const service = new BatchTransactionService();
    const observed: string[] = [];

    const result = await service.executeBatchCreate(
      [createInput('Netflix'), createInput('Spotify')],
      async () => {
        observed.push(service.getProgress()!.state);
        return { success: true, id: 'sub_x' };
      },
    );

    expect(observed).toEqual(['processing', 'processing']);
    expect(result.state).toBe('completed');
  });

  it('records batch and per-item durations', async () => {
    const service = new BatchTransactionService();
    const result = await service.executeBatchCreate([createInput('Netflix')], async () => ({
      success: true,
    }));

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.results[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(result.completedAt).toBeDefined();
  });

  it('marks items after an atomic failure as skipped', async () => {
    const service = new BatchTransactionService();
    const result = await service.executeBatchCharge(
      chargeItems(4),
      async (id) => ({ success: id !== 'sub_2', error: 'declined' }),
      { atomic: true },
    );

    const statuses = result.results.map((r) => r.status);
    // sub_1 succeeded then was discarded, sub_2 failed, the rest never ran.
    expect(statuses).toEqual(['skipped', 'failed', 'skipped', 'skipped']);
    expect(result.successfulItems).toBe(0);
    expect(result.skippedItems).toBe(3);
    expect(result.failedItems).toBe(1);
  });
});

describe('idempotency', () => {
  it('skips a charge that already succeeded on this service instance', async () => {
    const service = new BatchTransactionService();
    const charged: string[] = [];
    const charge = async (id: string) => {
      charged.push(id);
      return { success: true };
    };

    await service.executeBatchCharge(chargeItems(2), charge, { atomic: false });
    const second = await service.executeBatchCharge(chargeItems(2), charge, { atomic: false });

    expect(charged).toEqual(['sub_1', 'sub_2']);
    expect(second.skippedItems).toBe(2);
    expect(second.successfulItems).toBe(0);
    expect(second.results[0].message).toContain('idempotency');
  });

  it('forgets successes discarded by an atomic rollback so a re-run can apply them', async () => {
    const service = new BatchTransactionService();
    let failFirstRun = true;
    const charge = async (id: string) => ({
      success: !(failFirstRun && id === 'sub_2'),
      error: 'declined',
    });

    await service.executeBatchCharge(chargeItems(2), charge, { atomic: true });
    failFirstRun = false;
    const second = await service.executeBatchCharge(chargeItems(2), charge, { atomic: true });

    expect(second.successfulItems).toBe(2);
    expect(second.skippedItems).toBe(0);
  });

  it('does not deduplicate creates, which may legitimately share a name', async () => {
    const service = new BatchTransactionService();
    const result = await service.executeBatchCreate(
      [createInput('Netflix'), createInput('Netflix')],
      async () => ({ success: true }),
    );

    expect(result.successfulItems).toBe(2);
    expect(result.skippedItems).toBe(0);
  });

  it('clears the idempotency ledger on request', async () => {
    const service = new BatchTransactionService();
    const charge = async () => ({ success: true });

    await service.executeBatchCharge(chargeItems(1), charge, { atomic: false });
    service.clearIdempotencyKeys();
    const second = await service.executeBatchCharge(chargeItems(1), charge, { atomic: false });

    expect(second.successfulItems).toBe(1);
  });
});

describe('rollback', () => {
  const cancelReasons: CancelReason[] = [{ subscriptionId: 'sub_1', reason: 'too_expensive' }];

  it('reverses every committed item and reports rolled_back', async () => {
    const service = new BatchTransactionService();
    await service.executeBatchCharge(chargeItems(3), async () => ({ success: true }), {
      atomic: false,
    });

    const reverted: string[] = [];
    const rollback = await service.rollbackBatch(async (item: PerItemResult) => {
      reverted.push(item.subscriptionId);
      return { success: true };
    });

    expect(reverted).toEqual(['sub_1', 'sub_2', 'sub_3']);
    expect(rollback).toMatchObject({ attempted: 3, reverted: 3, failed: 0 });
    expect(service.getLastResult()!.state).toBe('rolled_back');
    expect(service.getLastResult()!.successfulItems).toBe(0);
  });

  it('stays partial when some items could not be reversed', async () => {
    const service = new BatchTransactionService();
    await service.executeBatchCharge(chargeItems(2), async () => ({ success: true }), {
      atomic: false,
    });

    const rollback = await service.rollbackBatch(async (item) => ({
      success: item.subscriptionId === 'sub_1',
      error: 'refund window closed',
    }));

    expect(rollback).toMatchObject({ reverted: 1, failed: 1 });
    const result = service.getLastResult()!;
    expect(result.state).toBe('partial');
    expect(result.rolledBack).toBe(false);
    expect(result.successfulItems).toBe(1);
    expect(result.failedItems).toBe(1);
  });

  it('refuses to roll back an operation type configured against it', async () => {
    const service = new BatchTransactionService();
    await service.executeBatchCancel(
      ['sub_1'],
      cancelReasons,
      async () => ({ success: true }),
      { atomic: false },
    );

    expect(service.canRollback()).toBe(false);
    expect(await service.rollbackBatch(async () => ({ success: true }))).toBeNull();
  });

  it('refuses to roll back an atomic batch that committed nothing', async () => {
    const service = new BatchTransactionService();
    await service.executeBatchCharge(
      chargeItems(2),
      async (id) => ({ success: id === 'sub_1', error: 'declined' }),
      { atomic: true },
    );

    expect(service.canRollback()).toBe(false);
  });

  it('refuses to roll back twice', async () => {
    const service = new BatchTransactionService();
    await service.executeBatchCharge(chargeItems(1), async () => ({ success: true }), {
      atomic: false,
    });
    await service.rollbackBatch(async () => ({ success: true }));

    expect(service.canRollback()).toBe(false);
    expect(await service.rollbackBatch(async () => ({ success: true }))).toBeNull();
  });

  it('returns null when there is no batch to reverse', async () => {
    const service = new BatchTransactionService();
    expect(await service.rollbackBatch(async () => ({ success: true }))).toBeNull();
  });

  it('lets a reversed charge be applied again', async () => {
    const service = new BatchTransactionService();
    const charged: string[] = [];
    const charge = async (id: string) => {
      charged.push(id);
      return { success: true };
    };

    await service.executeBatchCharge(chargeItems(1), charge, { atomic: false });
    await service.rollbackBatch(async () => ({ success: true }));
    await service.executeBatchCharge(chargeItems(1), charge, { atomic: false });

    expect(charged).toEqual(['sub_1', 'sub_1']);
  });
});

describe('retry', () => {
  it('retries failed items up to the configured budget', async () => {
    const service = new BatchTransactionService();
    service.setOperationConfig('update', { maxRetries: 2, retryDelayMs: 0 });

    await service.executeBatchUpdate(
      ['sub_1', 'sub_2'],
      { price: 5 },
      async (id) => ({ success: id === 'sub_1', error: 'timeout' }),
      { atomic: false },
    );

    const result = await service.retryFailedItems(async () => ({ success: true }));
    expect(result!.state).toBe('completed');
    expect(result!.successfulItems).toBe(2);
    expect(result!.failedItems).toBe(0);
  });

  it('stops retrying once an item exhausts its budget', async () => {
    const service = new BatchTransactionService();
    service.setOperationConfig('update', { maxRetries: 1, retryDelayMs: 0 });

    await service.executeBatchUpdate(
      ['sub_1'],
      { price: 5 },
      async () => ({ success: false, error: 'timeout' }),
      { atomic: false },
    );

    await service.retryFailedItems(async () => ({ success: false, error: 'timeout' }));
    let attempts = 0;
    await service.retryFailedItems(async () => {
      attempts++;
      return { success: true };
    });

    expect(attempts).toBe(0);
  });
});

describe('analytics', () => {
  it('returns zeroed statistics for an empty history', () => {
    const analytics = computeBatchAnalytics([]);
    expect(analytics.overall.batches).toBe(0);
    expect(analytics.overall.itemSuccessRate).toBe(0);
    expect(analytics.overall.avgDurationMs).toBe(0);
    expect(analytics.byOperationType.charge.batches).toBe(0);
  });

  it('computes success rates over all batches', () => {
    const analytics = computeBatchAnalytics([
      historyEntry({ batchId: 'a', state: 'completed', totalItems: 4, successfulItems: 4 }),
      historyEntry({
        batchId: 'b',
        state: 'partial',
        totalItems: 6,
        successfulItems: 2,
        failedItems: 4,
      }),
    ]);

    expect(analytics.overall.batches).toBe(2);
    expect(analytics.overall.completed).toBe(1);
    expect(analytics.overall.partial).toBe(1);
    expect(analytics.overall.batchSuccessRate).toBe(0.5);
    expect(analytics.overall.itemSuccessRate).toBe(0.6);
  });

  it('computes timing statistics only from batches that recorded a duration', () => {
    const analytics = computeBatchAnalytics([
      historyEntry({ batchId: 'a', totalItems: 10, successfulItems: 10, durationMs: 1000 }),
      historyEntry({ batchId: 'b', totalItems: 10, successfulItems: 10, durationMs: 3000 }),
      // Persisted before timing was tracked, so it must not drag the average down.
      historyEntry({ batchId: 'c', totalItems: 10, successfulItems: 10 }),
    ]);

    expect(analytics.overall.avgDurationMs).toBe(2000);
    expect(analytics.overall.p95DurationMs).toBe(3000);
    expect(analytics.overall.avgItemDurationMs).toBe(200);
    expect(analytics.overall.throughputPerSecond).toBe(5);
  });

  it('partitions statistics by operation type', () => {
    const analytics = computeBatchAnalytics([
      historyEntry({ batchId: 'a', operationType: 'charge', totalItems: 2, successfulItems: 2 }),
      historyEntry({
        batchId: 'b',
        operationType: 'cancel',
        state: 'failed',
        totalItems: 2,
        successfulItems: 0,
        failedItems: 2,
      }),
    ]);

    expect(analytics.byOperationType.charge.itemSuccessRate).toBe(1);
    expect(analytics.byOperationType.cancel.itemSuccessRate).toBe(0);
    expect(analytics.byOperationType.cancel.failed).toBe(1);
    expect(analytics.byOperationType.update.batches).toBe(0);
  });

  it('counts rolled-back batches', () => {
    const analytics = computeBatchAnalytics([
      historyEntry({ batchId: 'a', state: 'rolled_back', successfulItems: 0, totalItems: 3 }),
      historyEntry({ batchId: 'b', state: 'failed', rolledBack: true, totalItems: 3 }),
    ]);

    expect(analytics.overall.rolledBack).toBe(2);
  });

  it('aggregates the service history it persisted', async () => {
    const service = new BatchTransactionService();
    await service.executeBatchCreate([createInput('Netflix')], async () => ({ success: true }));

    const analytics = await service.getAnalytics();
    expect(analytics.overall.batches).toBe(1);
    expect(analytics.byOperationType.create.itemSuccessRate).toBe(1);
  });
});

describe('history entries', () => {
  it('carries timing and rollback state into the history record', async () => {
    const service = new BatchTransactionService();
    const result = await service.executeBatchCreate([createInput('Netflix')], async () => ({
      success: true,
    }));

    const entry = toHistoryEntry(result);
    expect(entry.batchId).toBe(result.batchId);
    expect(entry.durationMs).toBe(result.durationMs);
    expect(entry.skippedItems).toBe(0);
    expect(entry.rolledBack).toBe(false);
    expect(entry.summary).toBe('create: 1/1 succeeded');
  });
});
