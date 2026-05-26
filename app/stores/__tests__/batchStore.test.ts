import {
  useBatchStore,
  parseCsvTemplate,
  validateBatch,
  estimateBatchGas,
  ItemExecutor,
} from '../batchStore';

const reset = () =>
  useBatchStore.setState({
    draft: { operationType: 'charge', subscriptionIds: [], params: [], atomic: false },
    current: undefined,
    history: [],
    executor: async (_op, subscriptionId) => ({ subscriptionId, success: true }),
  });

beforeEach(reset);

describe('batch helpers', () => {
  it('estimates gas as base + per-op', () => {
    expect(estimateBatchGas(5)).toBe(550_000);
  });

  it('validates batch size bounds', () => {
    expect(validateBatch({ operationType: 'charge', subscriptionIds: [], params: [], atomic: false })).toBe(false);
    expect(
      validateBatch({ operationType: 'charge', subscriptionIds: ['a'], params: [], atomic: false }),
    ).toBe(true);
    const big = Array.from({ length: 101 }, (_, i) => `s${i}`);
    expect(validateBatch({ operationType: 'charge', subscriptionIds: big, params: [], atomic: false })).toBe(false);
  });

  it('parses CSV templates and skips the header row', () => {
    const op = parseCsvTemplate('subscriptionId,amount\nsub_1,1000\nsub_2,2000', 'charge');
    expect(op.subscriptionIds).toEqual(['sub_1', 'sub_2']);
    expect(op.params).toEqual([1000, 2000]);
  });
});

describe('useBatchStore execution', () => {
  it('completes a fully successful batch', async () => {
    const store = useBatchStore.getState();
    store.loadFromCsv('sub_1,100\nsub_2,100', 'charge');
    store.createBatch();
    const result = await useBatchStore.getState().executeBatch();
    expect(result?.state).toBe('completed');
    expect(result?.succeeded).toBe(2);
    expect(result?.failed).toBe(0);
  });

  it('reports partial success in non-atomic mode', async () => {
    const executor: ItemExecutor = async (_op, id) => ({
      subscriptionId: id,
      success: id === 'sub_1',
    });
    useBatchStore.getState().setExecutor(executor);
    useBatchStore.getState().loadFromCsv('sub_1,100\nsub_2,100', 'charge', false);
    useBatchStore.getState().createBatch();
    const result = await useBatchStore.getState().executeBatch();
    expect(result?.state).toBe('partial');
    expect(result?.succeeded).toBe(1);
    expect(result?.failed).toBe(1);
    expect(result?.rolledBack).toBe(false);
  });

  it('rolls back an atomic batch on any failure', async () => {
    const executor: ItemExecutor = async (_op, id) => ({
      subscriptionId: id,
      success: id === 'sub_1',
    });
    useBatchStore.getState().setExecutor(executor);
    useBatchStore.getState().loadFromCsv('sub_1,100\nsub_2,100', 'charge', true);
    useBatchStore.getState().createBatch();
    const result = await useBatchStore.getState().executeBatch();
    expect(result?.state).toBe('failed');
    expect(result?.rolledBack).toBe(true);
    expect(result?.succeeded).toBe(0);
  });

  it('appends executed batches to history', async () => {
    const store = useBatchStore.getState();
    store.loadFromCsv('sub_1,100', 'charge');
    store.createBatch();
    await useBatchStore.getState().executeBatch();
    expect(useBatchStore.getState().history.length).toBe(1);
  });
});
