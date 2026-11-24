import { OUTBOX_STORAGE_KEY, OutboxCorruptError, SyncOutbox } from '../outbox';
import type { RemoteSubscriptionRecord, SyncStorage } from '../types';

function createStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(OUTBOX_STORAGE_KEY, initial);
  const control = { failWrites: false };
  const storage: SyncStorage = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      if (control.failWrites) throw new Error('disk full');
      data.set(key, value);
    },
  };
  return { data, storage, control };
}

function sequentialIds() {
  let counter = 0;
  return () => {
    counter += 1;
    return `m${counter}`;
  };
}

function remote(version: number): RemoteSubscriptionRecord {
  return {
    id: 'sub-1',
    version,
    item: { id: 'sub-1', name: 'Netflix', status: 'active', price: 10, currency: 'USD' },
  };
}

async function loadOutbox(storage: SyncStorage) {
  return SyncOutbox.load(storage, { now: () => 1000, createId: sequentialIds() });
}

describe('SyncOutbox', () => {
  it('persists an enqueued edit and reloads it', async () => {
    const { data, storage } = createStorage();
    const outbox = await loadOutbox(storage);

    const entry = await outbox.enqueue('sub-1', 3, { price: 12 });

    expect(entry).toMatchObject({
      mutationId: 'm1',
      id: 'sub-1',
      baseVersion: 3,
      patch: { price: 12 },
      attempts: 0,
    });
    expect(data.has(OUTBOX_STORAGE_KEY)).toBe(true);
    const reloaded = await loadOutbox(storage);
    expect(reloaded.pending()).toEqual([entry]);
  });

  it('coalesces pending edits for one record and keeps the earliest base version', async () => {
    const { storage } = createStorage();
    const outbox = await loadOutbox(storage);

    await outbox.enqueue('sub-1', 3, { price: 12 });
    await outbox.enqueue('sub-1', 5, { name: 'Hulu', price: 13 });

    const pending = outbox.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].baseVersion).toBe(3);
    expect(pending[0].patch).toEqual({ price: 13, name: 'Hulu' });
  });

  it('does not merge a new edit into the entry that is in flight', async () => {
    const { storage } = createStorage();
    const outbox = await loadOutbox(storage);
    const first = await outbox.enqueue('sub-1', 3, { price: 12 });
    outbox.markInFlight(first.mutationId);

    await outbox.enqueue('sub-1', 3, { name: 'Later' });

    const pending = outbox.pending();
    expect(pending).toHaveLength(2);
    expect(pending[0].patch).toEqual({ price: 12 });
    expect(pending[1].patch).toEqual({ name: 'Later' });
  });

  it('rebases later edits for the same base version when an entry is acknowledged', async () => {
    const { storage } = createStorage();
    const outbox = await loadOutbox(storage);
    const first = await outbox.enqueue('sub-1', 3, { price: 12 });
    outbox.markInFlight(first.mutationId);
    await outbox.enqueue('sub-1', 3, { name: 'Later' });

    await outbox.ack(first.mutationId, 4);

    const pending = outbox.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ baseVersion: 4, patch: { name: 'Later' } });
  });

  it('holds every pending edit for a conflicted record as one entry and keeps other records queued', async () => {
    const { storage } = createStorage();
    const outbox = await loadOutbox(storage);
    const first = await outbox.enqueue('sub-1', 3, { price: 12 });
    outbox.markInFlight(first.mutationId);
    await outbox.enqueue('sub-1', 3, { name: 'A' });
    await outbox.enqueue('sub-2', 1, { price: 1 });

    const held = await outbox.recordVersionConflict(first.mutationId, remote(5));

    expect(held).toMatchObject({
      reason: 'version_conflict',
      id: 'sub-1',
      baseVersion: 3,
      patch: { price: 12, name: 'A' },
    });
    expect(outbox.held()).toEqual([held]);
    expect(outbox.pending().map((entry) => entry.id)).toEqual(['sub-2']);
    expect(outbox.hasVersionConflict('sub-1')).toBe(true);
  });

  it('refuses new edits to a record with an unresolved version conflict', async () => {
    const { storage } = createStorage();
    const outbox = await loadOutbox(storage);
    const first = await outbox.enqueue('sub-1', 3, { price: 12 });
    await outbox.recordVersionConflict(first.mutationId, remote(5));

    await expect(outbox.enqueue('sub-1', 5, { price: 1 })).rejects.toMatchObject({
      name: 'RecordConflictedError',
    });
  });

  it('re-applies a held conflict on top of the remote version', async () => {
    const { storage } = createStorage();
    const outbox = await loadOutbox(storage);
    const first = await outbox.enqueue('sub-1', 3, { price: 12 });
    const held = await outbox.recordVersionConflict(first.mutationId, remote(5));

    const entry = await outbox.reapplyHeld(held.heldId);

    expect(entry).toMatchObject({ id: 'sub-1', baseVersion: 5, patch: { price: 12 } });
    expect(outbox.held()).toEqual([]);
    expect(outbox.hasVersionConflict('sub-1')).toBe(false);
  });

  it('discards a held conflict and keeps the server state', async () => {
    const { storage } = createStorage();
    const outbox = await loadOutbox(storage);
    const first = await outbox.enqueue('sub-1', 3, { price: 12 });
    const held = await outbox.recordVersionConflict(first.mutationId, remote(5));

    await outbox.discardHeld(held.heldId);

    expect(outbox.held()).toEqual([]);
    expect(outbox.pending()).toEqual([]);
  });

  it('moves only the rejected entry to held', async () => {
    const { storage } = createStorage();
    const outbox = await loadOutbox(storage);
    const first = await outbox.enqueue('sub-1', 3, { price: 12 });
    await outbox.enqueue('sub-2', 1, { price: 1 });

    const held = await outbox.recordRejected(first.mutationId, 'HTTP 422');

    expect(held).toMatchObject({ reason: 'rejected', message: 'HTTP 422', id: 'sub-1' });
    expect(outbox.pending().map((entry) => entry.id)).toEqual(['sub-2']);
  });

  it('counts transient attempts on the entry', async () => {
    const { storage } = createStorage();
    const outbox = await loadOutbox(storage);
    const first = await outbox.enqueue('sub-1', 3, { price: 12 });

    expect(await outbox.recordAttempt(first.mutationId)).toBe(1);
    expect(await outbox.recordAttempt(first.mutationId)).toBe(2);
    expect(outbox.pending()[0].attempts).toBe(2);
  });

  it('throws OutboxCorruptError on invalid JSON and never overwrites the stored value', async () => {
    const { data, storage } = createStorage('{not json');

    await expect(loadOutbox(storage)).rejects.toMatchObject({ name: 'OutboxCorruptError' });
    expect(data.get(OUTBOX_STORAGE_KEY)).toBe('{not json');
  });

  it('throws OutboxCorruptError on an unknown schema version', async () => {
    const { storage } = createStorage('{"schema":2,"pending":[],"held":[]}');

    await expect(loadOutbox(storage)).rejects.toBeInstanceOf(OutboxCorruptError);
  });

  it('leaves memory and storage unchanged when a write fails', async () => {
    const { data, storage, control } = createStorage();
    const outbox = await loadOutbox(storage);
    control.failWrites = true;

    await expect(outbox.enqueue('sub-1', 3, { price: 12 })).rejects.toThrow('disk full');

    expect(outbox.pending()).toEqual([]);
    expect(data.has(OUTBOX_STORAGE_KEY)).toBe(false);
  });

  it('rejects non-integer base versions and empty patches', async () => {
    const { storage } = createStorage();
    const outbox = await loadOutbox(storage);

    await expect(outbox.enqueue('sub-1', -1, { price: 1 })).rejects.toThrow(TypeError);
    await expect(outbox.enqueue('sub-1', 1, {})).rejects.toThrow(TypeError);
  });
});
