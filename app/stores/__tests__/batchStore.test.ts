import {
  useBatchStore,
  estimateBatchGas,
  validateBatchSize,
  getDefaultBatchConfig,
  BatchOperationType,
  BatchDraft,
  CancelReason,
} from '../batchStore';

const emptyDraft = (): BatchDraft => ({
  operationType: 'create' as BatchOperationType,
  atomic: false,
  createInputs: [],
  updateIds: [],
  updateParams: {},
  cancelIds: [],
  cancelReasons: [],
  chargeItems: [],
  csvContent: '',
  chunkSize: 50,
});

const reset = () =>
  useBatchStore.setState({
    draft: emptyDraft(),
    currentResult: null,
    history: [],
    configs: {
      create: getDefaultBatchConfig('create'),
      update: getDefaultBatchConfig('update'),
      charge: getDefaultBatchConfig('charge'),
      cancel: getDefaultBatchConfig('cancel'),
    },
    service: null,
    rollbackHandler: null,
    executor: async (_op, subscriptionId) => ({ subscriptionId, success: true }),
    isRunning: false,
    progress: null,
  });

beforeEach(reset);

describe('batch helpers', () => {
  it('estimates gas as base + per-op', () => {
    expect(estimateBatchGas(5)).toBe(550_000);
  });

  it('validates batch size bounds', () => {
    expect(validateBatchSize(0)).toBe(false);
    expect(validateBatchSize(1)).toBe(true);
    expect(validateBatchSize(501)).toBe(false);
  });
});

describe('CSV parsing', () => {
  it('parses create CSV and loads inputs', () => {
    useBatchStore.getState().loadCreateCsv(
      'name,description,category,price,currency,billingCycle\nNetflix,Streaming,streaming,15.99,USD,monthly',
    );
    const draft = useBatchStore.getState().draft;
    expect(draft.createInputs.length).toBe(1);
    expect(draft.createInputs[0].name).toBe('Netflix');
    expect(draft.createInputs[0].price).toBe(15.99);
  });

  it('parses cancel CSV with reasons', () => {
    useBatchStore.getState().loadCancelCsv(
      'subscriptionId,reason,notes\nsub_1,too_expensive,\nsub_2,other,Switched',
    );
    const draft = useBatchStore.getState().draft;
    expect(draft.cancelIds).toEqual(['sub_1', 'sub_2']);
    expect(draft.cancelReasons.length).toBe(2);
    expect(draft.cancelReasons[0].reason).toBe('too_expensive');
  });

  it('parses charge CSV with amounts', () => {
    useBatchStore.getState().loadChargeCsv(
      'subscriptionId,amount\nsub_1,1000\nsub_2,2000',
    );
    const draft = useBatchStore.getState().draft;
    expect(draft.chargeItems.length).toBe(2);
    expect(draft.chargeItems[0].amount).toBe(1000);
  });
});

describe('useBatchStore execution', () => {
  it('completes a fully successful charge batch', async () => {
    useBatchStore.getState().loadChargeCsv('subscriptionId,amount\nsub_1,100\nsub_2,100');
    const result = await useBatchStore.getState().executeBatch();
    expect(result?.state).toBe('completed');
    expect(result?.successfulItems).toBe(2);
    expect(result?.failedItems).toBe(0);
  });

  it('reports partial success in non-atomic mode', async () => {
    useBatchStore.getState().setExecutor(async (_op, id) => ({
      subscriptionId: id,
      success: id === 'sub_1',
    }));
    useBatchStore.getState().loadChargeCsv('subscriptionId,amount\nsub_1,100\nsub_2,100');
    const result = await useBatchStore.getState().executeBatch();
    expect(result?.state).toBe('partial');
    expect(result?.successfulItems).toBe(1);
    expect(result?.failedItems).toBe(1);
    expect(result?.rolledBack).toBe(false);
  });

  it('rolls back an atomic batch on any failure', async () => {
    useBatchStore.getState().setExecutor(async (_op, id) => ({
      subscriptionId: id,
      success: id === 'sub_1',
    }));
    useBatchStore.getState().loadChargeCsv('subscriptionId,amount\nsub_1,100\nsub_2,100');
    useBatchStore.getState().setDraft({ atomic: true });
    const result = await useBatchStore.getState().executeBatch();
    expect(result?.state).toBe('failed');
    expect(result?.rolledBack).toBe(true);
  });

  it('executes create batch from inputs', async () => {
    useBatchStore.getState().loadCreateCsv(
      'name,category,price,currency,billingCycle\nTest,streaming,9.99,USD,monthly',
    );
    const result = await useBatchStore.getState().executeBatch();
    expect(result?.state).toBe('completed');
    expect(result?.operationType).toBe('create');
  });

  it('appends executed batches to history', async () => {
    useBatchStore.getState().loadChargeCsv('subscriptionId,amount\nsub_1,100');
    await useBatchStore.getState().executeBatch();
    expect(useBatchStore.getState().history.length).toBeGreaterThan(0);
  });
});

describe('useBatchStore draft validation', () => {
  it('counts items for the active operation type only', () => {
    useBatchStore.getState().loadChargeCsv('subscriptionId,amount\nsub_1,100\nsub_2,100');
    expect(useBatchStore.getState().itemCount()).toBe(2);

    useBatchStore.getState().setOperationType('create');
    expect(useBatchStore.getState().itemCount()).toBe(0);
  });

  it('rejects an empty draft', () => {
    expect(useBatchStore.getState().validateDraft().valid).toBe(false);
  });

  it('rejects a draft above the operation type ceiling', () => {
    useBatchStore.getState().setOperationConfig('charge', { maxItems: 1 });
    useBatchStore.getState().loadChargeCsv('subscriptionId,amount\nsub_1,100\nsub_2,100');

    const validation = useBatchStore.getState().validateDraft();
    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain('limited to 1 items');
  });

  it('estimates gas from the active item count', () => {
    useBatchStore.getState().loadChargeCsv('subscriptionId,amount\nsub_1,100\nsub_2,100');
    expect(useBatchStore.getState().gasEstimate()).toBe(estimateBatchGas(2));
  });
});

describe('useBatchStore configuration', () => {
  it('patches one operation type without touching the others', () => {
    useBatchStore.getState().setOperationConfig('cancel', { allowRollback: true });

    expect(useBatchStore.getState().configs.cancel.allowRollback).toBe(true);
    expect(useBatchStore.getState().configs.charge.allowRollback).toBe(true);
    expect(useBatchStore.getState().configs.cancel.maxItems).toBe(
      getDefaultBatchConfig('cancel').maxItems,
    );
  });

  it('restores an operation type to its defaults', () => {
    useBatchStore.getState().setOperationConfig('charge', { maxItems: 3 });
    useBatchStore.getState().resetOperationConfig('charge');
    expect(useBatchStore.getState().configs.charge).toEqual(getDefaultBatchConfig('charge'));
  });

  it('exposes the config for the drafted operation type', () => {
    useBatchStore.getState().setOperationType('cancel');
    expect(useBatchStore.getState().activeConfig()).toEqual(getDefaultBatchConfig('cancel'));
  });

  it('applies the configured retry budget to a run', async () => {
    useBatchStore.getState().setOperationConfig('charge', { maxRetries: 0, retryDelayMs: 0 });
    useBatchStore.getState().setExecutor(async (_op, id) => ({
      subscriptionId: id,
      success: false,
      error: 'declined',
    }));
    useBatchStore.getState().loadChargeCsv('subscriptionId,amount\nsub_1,100');
    await useBatchStore.getState().executeBatch();

    const retried = await useBatchStore.getState().retryFailed();
    expect(retried?.failedItems).toBe(1);
    expect(retried?.results[0].retryCount).toBe(0);
  });
});

describe('useBatchStore rollback', () => {
  const loadCommittedCharge = async () => {
    useBatchStore.getState().loadChargeCsv('subscriptionId,amount\nsub_1,100\nsub_2,100');
    return useBatchStore.getState().executeBatch();
  };

  it('is unavailable before any batch runs', () => {
    expect(useBatchStore.getState().canRollback()).toBe(false);
  });

  it('reverses a committed batch through the registered handler', async () => {
    await loadCommittedCharge();
    const reverted: string[] = [];
    useBatchStore.getState().setRollbackHandler(async (item) => {
      reverted.push(item.subscriptionId);
      return { success: true };
    });

    expect(useBatchStore.getState().canRollback()).toBe(true);
    const rollback = await useBatchStore.getState().rollbackBatch();

    expect(reverted).toEqual(['sub_1', 'sub_2']);
    expect(rollback?.reverted).toBe(2);
    expect(useBatchStore.getState().currentResult?.state).toBe('rolled_back');
  });

  it('returns null when no rollback handler is registered', async () => {
    await loadCommittedCharge();
    expect(await useBatchStore.getState().rollbackBatch()).toBeNull();
  });

  it('replaces the batch history entry rather than duplicating it', async () => {
    const result = await loadCommittedCharge();
    useBatchStore.getState().setRollbackHandler(async () => ({ success: true }));
    await useBatchStore.getState().rollbackBatch();

    const entries = useBatchStore.getState().history.filter((e) => e.batchId === result?.batchId);
    expect(entries.length).toBe(1);
    expect(entries[0].state).toBe('rolled_back');
  });
});

describe('useBatchStore analytics', () => {
  it('is empty before any batch runs', () => {
    expect(useBatchStore.getState().analytics().overall.batches).toBe(0);
  });

  it('summarizes executed batches by type', async () => {
    useBatchStore.getState().loadChargeCsv('subscriptionId,amount\nsub_1,100\nsub_2,100');
    await useBatchStore.getState().executeBatch();

    const analytics = useBatchStore.getState().analytics();
    expect(analytics.overall.batches).toBe(1);
    expect(analytics.overall.itemSuccessRate).toBe(1);
    expect(analytics.byOperationType.charge.batches).toBe(1);
    expect(analytics.byOperationType.create.batches).toBe(0);
  });

  it('reflects a partial run in the item success rate', async () => {
    useBatchStore.getState().setExecutor(async (_op, id) => ({
      subscriptionId: id,
      success: id === 'sub_1',
    }));
    useBatchStore.getState().loadChargeCsv('subscriptionId,amount\nsub_1,100\nsub_2,100');
    await useBatchStore.getState().executeBatch();

    const analytics = useBatchStore.getState().analytics();
    expect(analytics.overall.itemSuccessRate).toBe(0.5);
    expect(analytics.overall.batchSuccessRate).toBe(0);
    expect(analytics.overall.partial).toBe(1);
  });

  it('clears history and analytics together', async () => {
    useBatchStore.getState().loadChargeCsv('subscriptionId,amount\nsub_1,100');
    await useBatchStore.getState().executeBatch();
    await useBatchStore.getState().clearHistory();

    expect(useBatchStore.getState().history).toEqual([]);
    expect(useBatchStore.getState().analytics().overall.batches).toBe(0);
  });
});
