import { QueryHttpError } from '../../queries/subscriptions';
import { createConsoleSyncTelemetry, SyncEngine } from '../engine';
import { SyncOutbox } from '../outbox';
import type {
  PendingUpdate,
  PushResult,
  RemoteSubscriptionRecord,
  SyncEvent,
  SyncStorage,
  SyncTransport,
} from '../types';

type Step =
  | PushResult
  | Error
  | ((update: PendingUpdate, signal: AbortSignal) => PushResult | Promise<PushResult>);

function applied(version: number): PushResult {
  return { status: 'applied', version };
}

function conflict(version: number): PushResult {
  return { status: 'conflict', remote: remote(version) };
}

function remote(version: number): RemoteSubscriptionRecord {
  return {
    id: 'sub-1',
    version,
    item: { id: 'sub-1', name: 'Netflix', status: 'active', price: 10, currency: 'USD' },
  };
}

function scriptedTransport(steps: Step[]) {
  const calls: PendingUpdate[] = [];
  const transport: SyncTransport = {
    pushUpdate: async (update, signal) => {
      calls.push({ ...update, patch: { ...update.patch } });
      const step = steps.shift();
      if (step === undefined) throw new Error('unscripted push');
      if (step instanceof Error) throw step;
      if (typeof step === 'function') return step(update, signal);
      return step;
    },
  };
  return { transport, calls };
}

function createStorage(): SyncStorage {
  const data = new Map<string, string>();
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
}

let idCounter = 0;

async function setup(
  steps: Step[],
  options: {
    pushTimeoutMs?: number;
    maxAttempts?: number;
    telemetry?: { emit(e: SyncEvent): void };
  } = {},
) {
  idCounter = 0;
  const outbox = await SyncOutbox.load(createStorage(), {
    now: () => 1000,
    createId: () => {
      idCounter += 1;
      return `m${idCounter}`;
    },
  });
  const { transport, calls } = scriptedTransport(steps);
  const engine = new SyncEngine({ outbox, transport, now: () => 1000, ...options });
  return { engine, outbox, calls };
}

describe('SyncEngine', () => {
  it('pushes a queued edit with its base version, acknowledges it, and reports idle', async () => {
    const { engine, outbox, calls } = await setup([applied(4)]);
    await engine.enqueueUpdate('sub-1', 3, { price: 12 });

    const summary = await engine.flush();

    expect(summary).toEqual({ applied: 1, conflicted: 0, rejected: 0, deferred: false });
    expect(calls[0].baseVersion).toBe(3);
    expect(outbox.pending()).toEqual([]);
    expect(engine.status()).toMatchObject({ state: 'idle', pending: 0, held: 0 });
  });

  it('holds a version conflict for the record and keeps other records syncing', async () => {
    const { engine, outbox } = await setup([conflict(5), applied(2)]);
    await engine.enqueueUpdate('sub-1', 3, { price: 12 });
    await engine.enqueueUpdate('sub-2', 1, { price: 1 });

    const summary = await engine.flush();

    expect(summary).toEqual({ applied: 1, conflicted: 1, rejected: 0, deferred: false });
    expect(outbox.held()[0]).toMatchObject({ reason: 'version_conflict', id: 'sub-1' });
    expect(outbox.held()[0].remote?.version).toBe(5);
    expect(engine.status()).toMatchObject({ state: 'conflict', pending: 0, held: 1 });
  });

  it('defers a transient failure and retries the same edit on the next flush', async () => {
    const { engine, outbox, calls } = await setup([new Error('network down'), applied(4)]);
    await engine.enqueueUpdate('sub-1', 3, { price: 12 });

    const first = await engine.flush();

    expect(first).toEqual({ applied: 0, conflicted: 0, rejected: 0, deferred: true });
    expect(engine.status()).toMatchObject({ state: 'error', pending: 1, lastError: 'network down' });
    expect(outbox.pending()[0].attempts).toBe(1);

    const second = await engine.flush();

    expect(second.applied).toBe(1);
    expect(calls.map((call) => call.baseVersion)).toEqual([3, 3]);
    expect(engine.status().state).toBe('idle');
  });

  it('holds a non-retryable rejection without blocking the rest of the queue', async () => {
    const { engine, outbox } = await setup([new QueryHttpError('HTTP 422', 422), applied(2)]);
    await engine.enqueueUpdate('sub-1', 3, { price: 0 });
    await engine.enqueueUpdate('sub-2', 1, { price: 1 });

    const summary = await engine.flush();

    expect(summary).toEqual({ applied: 1, conflicted: 0, rejected: 1, deferred: false });
    expect(outbox.held()[0]).toMatchObject({ reason: 'rejected', message: 'HTTP 422' });
    expect(engine.status().state).toBe('error');
  });

  it('holds an edit as rejected after maxAttempts transient failures', async () => {
    const { engine, outbox } = await setup(
      [new Error('network down'), new Error('network down')],
      { maxAttempts: 2 },
    );
    await engine.enqueueUpdate('sub-1', 3, { price: 12 });

    expect((await engine.flush()).deferred).toBe(true);
    const second = await engine.flush();

    expect(second).toMatchObject({ rejected: 1, deferred: false });
    expect(outbox.held()[0].message).toBe('gave up after 2 attempts: network down');
    expect(outbox.pending()).toEqual([]);
  });

  it('treats a conflict that does not differ from the base version as a protocol error', async () => {
    const { engine, outbox } = await setup([conflict(3), applied(4)]);
    await engine.enqueueUpdate('sub-1', 3, { price: 12 });

    const summary = await engine.flush();

    expect(summary.deferred).toBe(true);
    expect(summary.conflicted).toBe(0);
    expect(outbox.held()).toEqual([]);
    expect(outbox.pending()).toHaveLength(1);
    expect(engine.status().lastError).toContain('protocol violation');
  });

  it('treats an applied version that does not exceed the base version as a protocol error', async () => {
    const { engine, outbox } = await setup([applied(3), applied(4)]);
    await engine.enqueueUpdate('sub-1', 3, { price: 12 });

    const summary = await engine.flush();

    expect(summary.deferred).toBe(true);
    expect(outbox.pending()).toHaveLength(1);
  });

  it('aborts a push that exceeds the timeout and counts it as transient', async () => {
    const hang = (_update: PendingUpdate, signal: AbortSignal) =>
      new Promise<PushResult>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const { engine, outbox } = await setup([hang], { pushTimeoutMs: 1 });
    await engine.enqueueUpdate('sub-1', 3, { price: 12 });

    const summary = await engine.flush();

    expect(summary.deferred).toBe(true);
    expect(engine.status().lastError).toBe('aborted');
    expect(outbox.pending()).toHaveLength(1);
  });

  it('shares one pass between concurrent flush calls', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { engine, calls } = await setup([
      async () => {
        await gate;
        return applied(4);
      },
    ]);
    await engine.enqueueUpdate('sub-1', 3, { price: 12 });

    const first = engine.flush();
    const second = engine.flush();
    expect(second).toBe(first);
    release();
    await first;

    expect(calls).toHaveLength(1);
  });

  it('sends an edit made during an in-flight push after it, with the rebased base version', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const pushStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { engine, calls } = await setup([
      async () => {
        started();
        await gate;
        return applied(4);
      },
      applied(5),
    ]);
    await engine.enqueueUpdate('sub-1', 3, { price: 12 });

    const pass = engine.flush();
    await pushStarted;
    await engine.enqueueUpdate('sub-1', 3, { name: 'Renamed' });
    release();
    const summary = await pass;

    expect(summary.applied).toBe(2);
    expect(calls[0].patch).toEqual({ price: 12 });
    expect(calls[1]).toMatchObject({ baseVersion: 4, patch: { name: 'Renamed' } });
  });

  it('re-applies a held conflict and pushes it on top of the remote version', async () => {
    const { engine, outbox, calls } = await setup([conflict(5), applied(6)]);
    await engine.enqueueUpdate('sub-1', 3, { price: 12 });
    await engine.flush();
    const heldId = outbox.held()[0].heldId;

    const entry = await engine.reapplyHeld(heldId);
    const summary = await engine.flush();

    expect(entry.baseVersion).toBe(5);
    expect(summary.applied).toBe(1);
    expect(calls[1].baseVersion).toBe(5);
    expect(engine.status().state).toBe('idle');
  });

  it('emits ordered, identifier-only telemetry for a successful push', async () => {
    const events: SyncEvent[] = [];
    const { engine } = await setup([applied(4)], { telemetry: { emit: (e) => events.push(e) } });
    await engine.enqueueUpdate('sub-1', 3, { price: 12 });

    await engine.flush();

    expect(events.map((event) => event.type)).toEqual(['enqueued', 'push_start', 'push_success']);
    expect(events[2]).toMatchObject({ id: 'sub-1', version: 4 });
    expect(JSON.stringify(events)).not.toContain('"price"');
  });

  it('notifies subscribers when the queue or the status changes', async () => {
    const { engine } = await setup([applied(4)]);
    let notifications = 0;
    const unsubscribe = engine.subscribe(() => {
      notifications += 1;
    });

    await engine.enqueueUpdate('sub-1', 3, { price: 12 });
    await engine.flush();
    unsubscribe();
    const before = notifications;
    await engine.enqueueUpdate('sub-1', 4, { price: 13 });

    expect(before).toBeGreaterThan(0);
    expect(notifications).toBeGreaterThan(before);
  });
});

describe('createConsoleSyncTelemetry', () => {
  it('writes one JSON line per event tagged with kind sync', () => {
    const lines: string[] = [];
    const sink = createConsoleSyncTelemetry({ info: (message) => lines.push(message) });

    sink.emit({ type: 'enqueued', at: 1, id: 'sub-1' });

    expect(JSON.parse(lines[0])).toEqual({ kind: 'sync', type: 'enqueued', at: 1, id: 'sub-1' });
  });
});
