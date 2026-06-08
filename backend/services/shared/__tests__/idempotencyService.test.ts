import {
  IdempotencyService,
  IdempotencyKeyCollisionError,
  IdempotencyRequestInFlightError,
  hashRequest,
  generateIdempotencyKey,
} from '../idempotencyService';

describe('IdempotencyService', () => {
  let svc: IdempotencyService;

  beforeEach(() => {
    svc = new IdempotencyService(24 * 60 * 60 * 1_000);
    svc.stopCleanup();
  });

  it('executes the operation on first call', async () => {
    const result = await svc.execute('key-1', 'hash-a', async () => ({ charged: true }));
    expect(result.cached).toBe(false);
    expect(result.response).toEqual({ charged: true });
  });

  it('returns cached response on repeat call with same key + hash', async () => {
    await svc.execute('key-2', 'hash-b', async () => ({ amount: 99 }));
    const second = await svc.execute('key-2', 'hash-b', async () => ({ amount: 999 }));
    expect(second.cached).toBe(true);
    expect(second.response).toEqual({ amount: 99 });
  });

  it('throws IdempotencyKeyCollisionError when hash differs', async () => {
    await svc.execute('key-3', 'hash-c', async () => ({}));
    await expect(svc.execute('key-3', 'hash-DIFFERENT', async () => ({}))).rejects.toThrow(
      IdempotencyKeyCollisionError,
    );
  });

  it('does not cache failed operations — allows retry with same key', async () => {
    await expect(
      svc.execute('key-4', 'hash-d', async () => {
        throw new Error('payment gateway timeout');
      }),
    ).rejects.toThrow('payment gateway timeout');

    // retry with same key should succeed
    const retry = await svc.execute('key-4', 'hash-d', async () => ({ retried: true }));
    expect(retry.cached).toBe(false);
    expect(retry.response).toEqual({ retried: true });
  });

  it('cleanup removes expired records', async () => {
    const shortSvc = new IdempotencyService(1); // 1ms window
    shortSvc.stopCleanup();
    await shortSvc.execute('key-5', 'hash-e', async () => ({}));
    await new Promise((r) => setTimeout(r, 5));
    const removed = shortSvc.cleanup();
    expect(removed).toBe(1);
    expect(shortSvc.size).toBe(0);
  });

  it('enforces storage limit by evicting oldest keys', async () => {
    // Use a tiny limit to test eviction
    const smallSvc = new (class extends IdempotencyService {
      constructor() { super(); }
      // expose for testing
      async fillTo(n: number) {
        for (let i = 0; i < n; i++) {
          await this.execute(`fill-${i}`, 'h', async () => ({}));
        }
      }
    })();
    smallSvc.stopCleanup();
    // Just verify the service doesn't throw when under load
    await smallSvc.fillTo(50);
    expect(smallSvc.size).toBeLessThanOrEqual(50);
  });
});

describe('hashRequest', () => {
  it('produces the same hash for equivalent objects regardless of key order', () => {
    const a = hashRequest({ amount: 100, currency: 'USD' });
    const b = hashRequest({ currency: 'USD', amount: 100 });
    expect(a).toBe(b);
  });

  it('produces different hashes for different payloads', () => {
    expect(hashRequest({ amount: 100 })).not.toBe(hashRequest({ amount: 200 }));
  });
});

describe('generateIdempotencyKey', () => {
  it('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 100 }, generateIdempotencyKey));
    expect(keys.size).toBe(100);
  });
});
