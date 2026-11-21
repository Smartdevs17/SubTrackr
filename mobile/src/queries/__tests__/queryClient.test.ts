import { isRetryableQueryError, queryErrorMessage, QueryClient } from '../queryClient';
import type { QueryEvent, QueryFetchOptions, QueryTelemetry } from '../types';

class RecordingTelemetry implements QueryTelemetry {
  events: QueryEvent[] = [];
  emit(event: QueryEvent): void {
    this.events.push(event);
  }
  types(): string[] {
    return this.events.map((event) => event.type);
  }
}

function options<T>(data: T, overrides: Partial<QueryFetchOptions<T>> = {}): QueryFetchOptions<T> {
  return {
    key: ['subscriptions', 'list', 'active'],
    fetcher: jest.fn(async () => data),
    ...overrides,
  };
}

describe('QueryClient', () => {
  let clock: number;
  let telemetry: RecordingTelemetry;
  let client: QueryClient;

  beforeEach(() => {
    clock = 0;
    telemetry = new RecordingTelemetry();
    client = new QueryClient({
      now: () => clock,
      sleep: async () => undefined,
      telemetry,
      logger: { warn: jest.fn() },
    });
  });

  it('serves fresh data from cache without fetching again', async () => {
    const query = options(['netflix']);
    const first = await client.fetch(query);
    const second = await client.fetch(query);

    expect(first.data).toEqual(['netflix']);
    expect(second.fromCache).toBe(true);
    expect(second.isFetching).toBe(false);
    expect(query.fetcher).toHaveBeenCalledTimes(1);
    expect(telemetry.types()).toContain('cache_hit');
  });

  it('deduplicates concurrent requests for the same key', async () => {
    let resolve!: (value: string[]) => void;
    const fetcher = jest.fn(
      () =>
        new Promise<string[]>((promiseResolve) => {
          resolve = promiseResolve;
        }),
    );
    const query = options([], { fetcher });
    const first = client.fetch(query);
    const second = client.fetch(query);
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolve(['a']);
    const [a, b] = await Promise.all([first, second]);
    expect(a.data).toEqual(['a']);
    expect(b.data).toEqual(['a']);
    expect(telemetry.types()).toContain('dedupe');
  });

  it('returns stale data immediately and revalidates in the background', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(['old'])
      .mockResolvedValueOnce(['new']);
    const query = options([], { fetcher, ttlMs: 10 });

    await client.fetch(query);
    clock = 20;
    const stale = await client.fetch(query);

    expect(stale.data).toEqual(['old']);
    expect(stale.isFetching).toBe(true);
    expect(stale.fromCache).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);

    await client.waitForIdle();
    expect(client.getSnapshot<string[]>(query.key)?.data).toEqual(['new']);
    expect(client.getSnapshot<string[]>(query.key)?.isFetching).toBe(false);
  });

  it('retries retryable failures with exponential backoff', async () => {
    const sleep = jest.fn(async () => undefined);
    client = new QueryClient({ now: () => clock, sleep, telemetry });
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce('ok');

    const result = await client.fetch(options('', { fetcher, retries: 2, retryDelayMs: 100 }));

    expect(result.status).toBe('success');
    expect(result.data).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(sleep).toHaveBeenCalledWith(100);
    expect(telemetry.types()).toContain('retry');
  });

  it('does not retry definite client errors', async () => {
    const sleep = jest.fn(async () => undefined);
    client = new QueryClient({ now: () => clock, sleep, telemetry });
    const fetcher = jest.fn(async () => {
      throw { status: 404 };
    });

    const result = await client.fetch(options('', { fetcher, retries: 3 }));

    expect(result.status).toBe('error');
    expect(result.attempts).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('aborts the fetcher when its timeout expires', async () => {
    const fetcher = jest.fn((context: { signal: AbortSignal }) =>
      new Promise<string>((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );

    const result = await client.fetch(options('', { fetcher, timeoutMs: 5, retries: 0 }));

    expect(result.status).toBe('error');
    expect(result.error).toEqual(new Error('aborted'));
    expect(telemetry.types()).toContain('fetch_error');
  });

  it('keeps stale data on a failed revalidation', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce('old')
      .mockRejectedValueOnce(new Error('offline'));
    const query = options('', { fetcher, ttlMs: 10, retries: 0 });
    await client.fetch(query);

    clock = 20;
    await client.fetch(query);
    await client.waitForIdle();

    const failed = client.getSnapshot<string>(query.key);
    expect(failed?.status).toBe('error');
    expect(failed?.data).toBe('old');
    expect(failed?.fromCache).toBe(true);
  });

  it('does not write an invalidated query back to the cache', async () => {
    let resolve!: (value: string) => void;
    const fetcher = jest.fn(
      () =>
        new Promise<string>((promiseResolve) => {
          resolve = promiseResolve;
        }),
    );
    const query = options('', { fetcher });
    const pending = client.fetch(query);
    client.invalidate({ key: query.key });
    resolve('late');
    await pending;

    expect(client.getSnapshot(query.key)).toBeUndefined();

    const refetched = await client.fetch(options('', { fetcher: async () => 'fresh' }));
    expect(refetched.data).toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('invalidates by prefix and by tag', async () => {
    await client.fetch(options('a', { key: ['subscriptions', 'list', 'a'], tags: ['subs'] }));
    await client.fetch(options('b', { key: ['subscriptions', 'detail', 'b'], tags: ['subs'] }));
    await client.fetch(options('c', { key: ['invoices'], tags: ['invoices'] }));

    expect(client.invalidate({ prefix: ['subscriptions'] })).toHaveLength(2);
    expect(client.getSnapshot(['invoices'])).toBeDefined();

    await client.fetch(options('d', { key: ['invoices'], tags: ['invoices'] }));
    expect(client.invalidate({ tag: 'invoices' })).toHaveLength(1);
    expect(telemetry.types().filter((type) => type === 'invalidate')).toHaveLength(3);
  });

  it('supports optimistic writes and subscriber notifications', async () => {
    const listener = jest.fn();
    const unsubscribe = client.subscribe(listener);
    const query = options(0);

    client.setQueryData(query.key, 7);
    expect(client.getSnapshot(query.key)?.data).toBe(7);
    expect(listener).toHaveBeenCalledTimes(1);

    const cached = await client.fetch(query);
    expect(cached.data).toBe(7);
    expect(query.fetcher).not.toHaveBeenCalled();

    unsubscribe();
    client.setQueryData(query.key, 8);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('classifies errors and formats messages', () => {
    expect(isRetryableQueryError({ status: 500 })).toBe(true);
    expect(isRetryableQueryError({ status: 429 })).toBe(true);
    expect(isRetryableQueryError({ status: 400 })).toBe(false);
    expect(isRetryableQueryError({ retryable: false })).toBe(false);
    expect(isRetryableQueryError(new Error('network'))).toBe(true);
    expect(queryErrorMessage(new Error('boom'))).toBe('boom');
  });
});
