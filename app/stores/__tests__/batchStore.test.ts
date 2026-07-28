import {
  useBatchStore,
  estimateBatchGas,
  validateBatchSize,
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
