import {
  ExportService,
  ExportBatch,
  ExportSink,
  InMemoryWatermarkStore,
  ExternalRecordState,
} from '../exportService';
import {
  InMemorySubscriptionEventStore,
  SubscriptionSnapshot,
} from '../subscription/subscriptionEventStore';

const snap = (id: string, over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
  id,
  merchantId: 'm1',
  name: `Sub ${id}`,
  price: 9.99,
  currency: 'USD',
  billingCycle: 'monthly',
  status: 'active',
  nextBillingDate: '2024-02-01T00:00:00.000Z',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-15T00:00:00.000Z',
  ...over,
});

class RecordingSink implements ExportSink {
  batches: ExportBatch[] = [];
  failTimes = 0;
  async deliver(batch: ExportBatch): Promise<void> {
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      throw new Error('transient network error');
    }
    this.batches.push(batch);
  }
}

const noSleep = async () => undefined;

const makeService = (sink: ExportSink, store = new InMemorySubscriptionEventStore()) => {
  const watermarks = new InMemoryWatermarkStore();
  const service = new ExportService(store, watermarks, sink, { sleepImpl: noSleep, now: () => 0 });
  return { service, store, watermarks };
};

describe('ExportService — incremental CDC export', () => {
  it('exports only records changed since the last watermark', async () => {
    const sink = new RecordingSink();
    const { service, store } = makeService(sink);

    store.append({ operation: 'insert', entityId: 's1', occurredAt: 1, data: snap('s1') });
    store.append({ operation: 'insert', entityId: 's2', occurredAt: 2, data: snap('s2') });

    const first = await service.runIncremental({ channelId: 'erp', format: 'json' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.metrics.recordsExported).toBe(2);
    expect(first.data.watermark).toBe(2);

    // Nothing new → empty incremental run.
    const second = await service.runIncremental({ channelId: 'erp', format: 'json' });
    expect(second.ok && second.data.metrics.recordsExported).toBe(0);

    // One more change → only that record ships.
    store.append({ operation: 'update', entityId: 's1', occurredAt: 3, data: snap('s1', { price: 12 }) });
    const third = await service.runIncremental({ channelId: 'erp', format: 'json' });
    expect(third.ok && third.data.metrics.recordsExported).toBe(1);
  });

  it('is idempotent: same window produces byte-identical artifacts', async () => {
    const store = new InMemorySubscriptionEventStore();
    const e1 = store.append({ operation: 'insert', entityId: 's1', occurredAt: 1, data: snap('s1') });
    const e2 = store.append({ operation: 'insert', entityId: 's2', occurredAt: 2, data: snap('s2') });
    const { service } = makeService(new RecordingSink(), store);

    const a = service.exportWindow([e1, e2], 'csv');
    const b = service.exportWindow([e1, e2], 'csv');
    expect(a.artifact.content).toBe(b.artifact.content);
  });

  it('supports csv, json and parquet formats with a schema version', async () => {
    const store = new InMemorySubscriptionEventStore();
    const ev = store.append({ operation: 'insert', entityId: 's1', occurredAt: 1, data: snap('s1') });
    const { service } = makeService(new RecordingSink(), store);

    const csv = service.exportWindow([ev], 'csv').artifact;
    expect(csv.content.split('\n')[0]).toContain('id');
    expect(csv.contentType).toBe('text/csv');

    const json = JSON.parse(service.exportWindow([ev], 'json').artifact.content);
    expect(json.schemaVersion).toBe(1);
    expect(json.records).toHaveLength(1);

    const parquet = JSON.parse(service.exportWindow([ev], 'parquet').artifact.content);
    expect(parquet.format).toBe('parquet-columnar-v1');
    expect(parquet.columns.id).toEqual(['s1']);
  });

  it('collapses multiple changes and emits a tombstone for deletes', async () => {
    const store = new InMemorySubscriptionEventStore();
    const e1 = store.append({ operation: 'insert', entityId: 's1', occurredAt: 1, data: snap('s1') });
    const e2 = store.append({ operation: 'update', entityId: 's1', occurredAt: 2, data: snap('s1', { price: 20 }) });
    const e3 = store.append({ operation: 'delete', entityId: 's1', occurredAt: 3, data: null });
    const { service } = makeService(new RecordingSink(), store);

    const { records } = service.exportWindow([e1, e2, e3], 'json');
    expect(records).toHaveLength(1);
    expect(records[0].operation).toBe('delete');
    expect(records[0].id).toBe('s1');
  });

  it('resolves bidirectional conflicts per strategy', async () => {
    const store = new InMemorySubscriptionEventStore();
    const ev = store.append({ operation: 'update', entityId: 's1', occurredAt: 1, data: snap('s1') });
    const { service } = makeService(new RecordingSink(), store);
    const external = new Map<string, ExternalRecordState>([
      ['s1', { id: 's1', version: 5, updatedAt: '2024-06-01T00:00:00.000Z' }],
    ]);

    // version 1 < external 5 → skipped under version-wins
    const versionWins = service.exportWindow([ev], 'json', undefined, {
      conflictStrategy: 'version-wins',
      externalState: external,
    });
    expect(versionWins.records).toHaveLength(0);
    expect(versionWins.conflictsSkipped).toBe(1);

    // external-wins never overwrites
    const externalWins = service.exportWindow([ev], 'json', undefined, {
      conflictStrategy: 'external-wins',
      externalState: external,
    });
    expect(externalWins.records).toHaveLength(0);

    // source-wins always applies
    const sourceWins = service.exportWindow([ev], 'json', undefined, {
      conflictStrategy: 'source-wins',
      externalState: external,
    });
    expect(sourceWins.records).toHaveLength(1);
  });

  it('retries delivery with backoff then succeeds', async () => {
    const sink = new RecordingSink();
    sink.failTimes = 2; // fail twice, succeed on the third attempt
    const { service, store } = makeService(sink);
    store.append({ operation: 'insert', entityId: 's1', occurredAt: 1, data: snap('s1') });

    const result = await service.runIncremental({ channelId: 'erp', format: 'json' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.metrics.retries).toBe(2);
    expect(sink.batches).toHaveLength(1);
  });

  it('keeps the watermark at the last good batch on exhausted retries', async () => {
    const sink = new RecordingSink();
    sink.failTimes = 99; // always fail
    const { service, store, watermarks } = makeService(sink);
    store.append({ operation: 'insert', entityId: 's1', occurredAt: 1, data: snap('s1') });

    const result = await service.runIncremental({ channelId: 'erp', format: 'json' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('export_delivery_failed');
    expect(await watermarks.get('erp')).toBe(0); // not advanced
  });

  it('processes a large log in bounded batches', async () => {
    const sink = new RecordingSink();
    const { service, store } = makeService(sink);
    for (let i = 0; i < 25; i += 1) {
      store.append({ operation: 'insert', entityId: `s${i}`, occurredAt: i, data: snap(`s${i}`) });
    }

    const result = await service.runIncremental({ channelId: 'erp', format: 'json', batchSize: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metrics.batches).toBe(3); // 10 + 10 + 5
      expect(result.data.metrics.recordsExported).toBe(25);
    }
  });

  it('guards against concurrent runs on the same channel', async () => {
    // A sink that blocks until released, to hold the first run in-flight.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blockingSink: ExportSink = { deliver: () => gate };

    const store = new InMemorySubscriptionEventStore();
    store.append({ operation: 'insert', entityId: 's1', occurredAt: 1, data: snap('s1') });
    const watermarks = new InMemoryWatermarkStore();
    const service = new ExportService(store, watermarks, blockingSink, { sleepImpl: noSleep });

    const inFlight = service.runIncremental({ channelId: 'erp', format: 'json' });
    // Second run while the first holds the lock.
    const blocked = await service.runIncremental({ channelId: 'erp', format: 'json' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('export_in_progress');

    release();
    await inFlight;
  });
});
