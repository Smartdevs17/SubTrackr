import {
  SubscriptionEditsErrorCode,
  SubscriptionEditsError,
  DEFAULT_SUBSCRIPTION_EDITS_CONFIG,
  createSubscriptionEditsApplier,
  applySubscriptionEditsBatch,
  noopSubscriptionEditsMetrics,
  noopSubscriptionEditsLogger,
  type SubscriptionEdit,
  type SubscriptionEditsStore,
  type SubscriptionEditsMetrics,
  type SubscriptionEditsLogger,
  type SubscriptionEditsBatchResult,
} from '../subscriptions';

interface Write { id: string; patch: Readonly<Record<string, unknown>>; expectedVersion: number }

function memoryStore(initial: Record<string, number> = {}, failIds: string[] = []): SubscriptionEditsStore & { writes: Write[] } {
  const versions = new Map<string, number>(Object.entries(initial));
  const writes: Write[] = [];
  return {
    writes,
    async load(id) {
      const version = versions.get(id);
      return version === undefined ? undefined : { version };
    },
    async commit(id, patch, expectedVersion) {
      if (failIds.includes(id)) throw new Error('disk unavailable');
      const current = versions.get(id) ?? 0;
      if (current !== expectedVersion) throw new Error('version mismatch');
      const version = expectedVersion + 1;
      versions.set(id, version);
      writes.push({ id, patch, expectedVersion });
      return { version };
    },
  };
}

function spyMetrics(): { metrics: SubscriptionEditsMetrics; log: { applied: string[]; skipped: string[]; failed: string[]; batches: number[] } } {
  const log = { applied: [] as string[], skipped: [] as string[], failed: [] as string[], batches: [] as number[] };
  const metrics: SubscriptionEditsMetrics = {
    batchCompleted: (_applied, _skipped, _failed, durationMs) => log.batches.push(durationMs),
    itemApplied: (id) => log.applied.push(id),
    itemSkipped: (id) => log.skipped.push(id),
    itemFailed: (id) => log.failed.push(id),
  };
  return { metrics, log };
}

function spyLogger(): { logger: SubscriptionEditsLogger; messages: string[] } {
  const messages: string[] = [];
  const logger: SubscriptionEditsLogger = {
    debug: (message) => messages.push(`debug:${message}`),
    warn: (message) => messages.push(`warn:${message}`),
    error: (message) => messages.push(`error:${message}`),
  };
  return { logger, messages };
}

function codeOf(fn: () => unknown): string {
  try { fn(); } catch (error) { return (error as SubscriptionEditsError).code; }
  throw new Error('expected fn to throw');
}

async function rejectionCode(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); } catch (error) { return (error as SubscriptionEditsError).code; }
  throw new Error('expected fn to reject');
}

describe('subscription edits vocabulary (#2266)', () => {
  it('exposes frozen, stable error codes', () => {
    expect(Object.isFrozen(SubscriptionEditsErrorCode)).toBe(true);
    expect(SubscriptionEditsErrorCode.INVALID_CONFIG).toBe('INVALID_CONFIG');
    expect(SubscriptionEditsErrorCode.INVALID_INPUT).toBe('INVALID_INPUT');
    expect(SubscriptionEditsErrorCode.VERSION_CONFLICT).toBe('VERSION_CONFLICT');
    expect(SubscriptionEditsErrorCode.STORE_ERROR).toBe('STORE_ERROR');
  });

  it('exposes a frozen config and frozen no-op hooks', () => {
    expect(Object.isFrozen(DEFAULT_SUBSCRIPTION_EDITS_CONFIG)).toBe(true);
    expect(DEFAULT_SUBSCRIPTION_EDITS_CONFIG.maxBatchSize).toBe(50);
    expect(DEFAULT_SUBSCRIPTION_EDITS_CONFIG.initialVersion).toBe(0);
    expect(Object.isFrozen(noopSubscriptionEditsMetrics)).toBe(true);
    expect(Object.isFrozen(noopSubscriptionEditsLogger)).toBe(true);
  });

  it('builds typed errors with frozen details', () => {
    const error = new SubscriptionEditsError(SubscriptionEditsErrorCode.INVALID_INPUT, 'bad batch', { count: 2 });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SubscriptionEditsError);
    expect(error.name).toBe('SubscriptionEditsError');
    expect(error.code).toBe('INVALID_INPUT');
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(error.details.count).toBe(2);
  });
});

describe('coalesced batch application', () => {
  it('applies a new subscription with observability', async () => {
    const store = memoryStore();
    const { metrics, log } = spyMetrics();
    const { logger, messages } = spyLogger();
    const result: SubscriptionEditsBatchResult = await applySubscriptionEditsBatch(
      [{ id: 'sub_1', patch: { name: 'Netflix' }, version: 0 }],
      store,
      { metrics, logger, now: () => 1000 },
    );
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results[0].outcome).toBe('applied');
    expect(result.results[0].version).toBe(1);
    expect(result.durationMs).toBe(0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.results)).toBe(true);
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0].expectedVersion).toBe(0);
    expect(log.applied).toEqual(['sub_1']);
    expect(log.batches).toEqual([0]);
    expect(messages[0]).toBe('debug:subscription edit applied');
  });

  it('is idempotent by id and version across repeated calls', async () => {
    const store = memoryStore();
    const batch: SubscriptionEdit[] = [{ id: 'sub_1', patch: { amount: 10 }, version: 0 }];
    const first = await applySubscriptionEditsBatch(batch, store);
    const second = await applySubscriptionEditsBatch(batch, store);
    expect(first.applied).toBe(1);
    expect(second.applied).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.results[0].outcome).toBe('duplicate');
    expect(second.results[0].code).toBe(SubscriptionEditsErrorCode.VERSION_CONFLICT);
    expect(store.writes).toHaveLength(1);
  });

  it('shares idempotency state on an explicit applier', async () => {
    const store = memoryStore();
    const applier = createSubscriptionEditsApplier(store);
    const batch: SubscriptionEdit[] = [{ id: 'sub_1', patch: { amount: 10 } }];
    expect((await applier.apply(batch)).applied).toBe(1);
    expect((await applier.apply(batch)).skipped).toBe(1);
    expect(applier.seenKeys).toEqual(['sub_1@0']);
    expect(Object.isFrozen(applier)).toBe(true);
    expect(Object.isFrozen(applier.config)).toBe(true);
  });

  it('reports a version conflict without writing', async () => {
    const store = memoryStore({ sub_1: 3 });
    const result = await applySubscriptionEditsBatch(
      [{ id: 'sub_1', patch: { amount: 10 }, version: 1 }],
      store,
    );
    expect(result.results[0].outcome).toBe('conflict');
    expect(result.results[0].code).toBe(SubscriptionEditsErrorCode.VERSION_CONFLICT);
    expect(result.results[0].version).toBe(3);
    expect(result.skipped).toBe(1);
    expect(store.writes).toHaveLength(0);
  });

  it('captures store failures and keeps processing', async () => {
    const store = memoryStore({}, ['bad']);
    const { metrics, log } = spyMetrics();
    const { logger, messages } = spyLogger();
    const result = await applySubscriptionEditsBatch(
      [
        { id: 'bad', patch: { amount: 1 } },
        { id: 'good', patch: { amount: 2 } },
      ],
      store,
      { metrics, logger },
    );
    expect(result.failed).toBe(1);
    expect(result.applied).toBe(1);
    expect(result.results[0].outcome).toBe('error');
    expect(result.results[0].code).toBe(SubscriptionEditsErrorCode.STORE_ERROR);
    expect(result.results[1].outcome).toBe('applied');
    expect(log.failed).toEqual(['bad']);
    expect(messages[0]).toBe('error:subscription edit store failure');
  });

  it('rejects malformed items with typed codes', async () => {
    const store = memoryStore();
    const result = await applySubscriptionEditsBatch(
      [
        { id: '', patch: {} },
        { id: 'a', patch: [] as never },
        { id: 'b', patch: {}, version: -1 },
      ],
      store,
    );
    expect(result.failed).toBe(3);
    expect(result.results.map((item) => item.code)).toEqual(['INVALID_INPUT', 'INVALID_INPUT', 'INVALID_VERSION']);
    expect(store.writes).toHaveLength(0);
  });

  it('rejects oversized batches and invalid configuration', async () => {
    const store = memoryStore();
    const oversized: SubscriptionEdit[] = Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, patch: {} }));
    expect(await rejectionCode(() => applySubscriptionEditsBatch(oversized, store, { config: { maxBatchSize: 5 } }))).toBe(
      SubscriptionEditsErrorCode.BATCH_TOO_LARGE,
    );
    expect(codeOf(() => createSubscriptionEditsApplier(store, { config: { maxBatchSize: 0 } }))).toBe(
      SubscriptionEditsErrorCode.INVALID_CONFIG,
    );
  });

  it('rejects a non-array batch with a typed error', async () => {
    const store = memoryStore();
    expect(await rejectionCode(() => applySubscriptionEditsBatch(null as never, store))).toBe(
      SubscriptionEditsErrorCode.INVALID_INPUT,
    );
  });
});
