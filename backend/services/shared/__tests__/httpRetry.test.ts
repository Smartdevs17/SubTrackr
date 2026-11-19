import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_BASE_DELAY_MS,
  defaultSleep,
  isRetryableStatus,
  linearBackoff,
  parseJsonObject,
  resolveFetchImpl,
  resolveMaxAttempts,
  runWithRetries,
} from '../httpRetry';

describe('isRetryableStatus', () => {
  it('treats 429 and any 5xx as transient', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it('treats a 409 lock timeout as transient', () => {
    expect(isRetryableStatus(409, 'lock_timeout')).toBe(true);
  });

  it('treats client errors as terminal', () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });

  it('treats a plain 409 as terminal', () => {
    expect(isRetryableStatus(409)).toBe(false);
    expect(isRetryableStatus(409, 'some_other_error')).toBe(false);
  });
});

describe('linearBackoff', () => {
  it('grows the delay by one base interval per attempt', () => {
    expect(linearBackoff(1, 250)).toBe(250);
    expect(linearBackoff(2, 250)).toBe(500);
    expect(linearBackoff(3, 250)).toBe(750);
  });

  it('is a no-op when the base delay is zero', () => {
    expect(linearBackoff(1, 0)).toBe(0);
    expect(linearBackoff(5, 0)).toBe(0);
  });
});

describe('resolveMaxAttempts', () => {
  it('pins a non-retryable operation to a single attempt', () => {
    expect(resolveMaxAttempts(false, 5)).toBe(1);
  });

  it('keeps the configured budget for a retryable operation', () => {
    expect(resolveMaxAttempts(true, 5)).toBe(5);
  });

  it('never returns less than one attempt', () => {
    expect(resolveMaxAttempts(true, 0)).toBe(1);
    expect(resolveMaxAttempts(true, -3)).toBe(1);
  });
});

describe('parseJsonObject', () => {
  it('parses an object payload', () => {
    expect(parseJsonObject('{"data":{"id":1}}')).toEqual({ data: { id: 1 } });
  });

  it('returns null for malformed JSON', () => {
    expect(parseJsonObject('{not json')).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(parseJsonObject('')).toBeNull();
  });

  it('returns null for non-object payloads', () => {
    expect(parseJsonObject('null')).toBeNull();
    expect(parseJsonObject('"a string"')).toBeNull();
    expect(parseJsonObject('42')).toBeNull();
    expect(parseJsonObject('[1,2,3]')).toBeNull();
  });
});

describe('resolveFetchImpl', () => {
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;

  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
  });

  it('prefers the injected implementation', () => {
    const injected = jest.fn();
    (globalThis as { fetch?: unknown }).fetch = jest.fn();

    expect(resolveFetchImpl(injected as never)).toBe(injected);
  });

  it('falls back to the runtime global', () => {
    const runtimeFetch = jest.fn();
    (globalThis as { fetch?: unknown }).fetch = runtimeFetch;

    expect(resolveFetchImpl(undefined)).toBe(runtimeFetch);
  });

  it('returns undefined when neither is available', () => {
    (globalThis as { fetch?: unknown }).fetch = undefined;

    expect(resolveFetchImpl(undefined)).toBeUndefined();
  });

  it('ignores a non-callable global', () => {
    (globalThis as { fetch?: unknown }).fetch = 'not a function';

    expect(resolveFetchImpl(undefined)).toBeUndefined();
  });
});

describe('defaultSleep', () => {
  it('resolves after the delay elapses', async () => {
    jest.useFakeTimers();
    try {
      let resolved = false;
      const pending = defaultSleep(500).then(() => {
        resolved = true;
      });

      jest.advanceTimersByTime(499);
      await Promise.resolve();
      expect(resolved).toBe(false);

      jest.advanceTimersByTime(1);
      await pending;
      expect(resolved).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('runWithRetries', () => {
  const noSleep = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    noSleep.mockClear();
  });

  it('returns a settled value without sleeping', async () => {
    const attempt = jest.fn().mockResolvedValue({ done: true, value: 'ok' });

    const result = await runWithRetries(attempt, {
      maxAttempts: 3,
      baseDelayMs: 250,
      sleep: noSleep,
    });

    expect(result).toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('retries a transient outcome and returns the eventual success', async () => {
    const attempt = jest
      .fn()
      .mockResolvedValueOnce({ done: false, retry: true, value: 'transient' })
      .mockResolvedValueOnce({ done: true, value: 'recovered' });

    const result = await runWithRetries(attempt, {
      maxAttempts: 3,
      baseDelayMs: 250,
      sleep: noSleep,
    });

    expect(result).toBe('recovered');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('returns a terminal outcome immediately without spending the budget', async () => {
    const attempt = jest
      .fn()
      .mockResolvedValue({ done: false, retry: false, value: 'bad-request' });

    const result = await runWithRetries(attempt, {
      maxAttempts: 5,
      baseDelayMs: 250,
      sleep: noSleep,
    });

    expect(result).toBe('bad-request');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('returns the last transient value once the budget is exhausted', async () => {
    const attempt = jest
      .fn()
      .mockResolvedValue({ done: false, retry: true, value: 'still-failing' });

    const result = await runWithRetries(attempt, {
      maxAttempts: 3,
      baseDelayMs: 250,
      sleep: noSleep,
    });

    expect(result).toBe('still-failing');
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('applies linear backoff between attempts but not after the last', async () => {
    const attempt = jest
      .fn()
      .mockResolvedValue({ done: false, retry: true, value: 'transient' });

    await runWithRetries(attempt, {
      maxAttempts: 3,
      baseDelayMs: 250,
      sleep: noSleep,
    });

    // Two gaps between three attempts: base*1 then base*2. No trailing sleep.
    expect(noSleep.mock.calls).toEqual([[250], [500]]);
  });

  it('does not sleep at all for a single-attempt budget', async () => {
    const attempt = jest
      .fn()
      .mockResolvedValue({ done: false, retry: true, value: 'transient' });

    await runWithRetries(attempt, {
      maxAttempts: 1,
      baseDelayMs: 250,
      sleep: noSleep,
    });

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('clamps a zero budget to a single attempt', async () => {
    const attempt = jest
      .fn()
      .mockResolvedValue({ done: false, retry: true, value: 'transient' });

    await runWithRetries(attempt, { maxAttempts: 0, baseDelayMs: 250, sleep: noSleep });

    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('treats a thrown transport error as transient and retries it', async () => {
    const attempt = jest
      .fn()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({ done: true, value: 'recovered' });

    const result = await runWithRetries(attempt, {
      maxAttempts: 3,
      baseDelayMs: 250,
      sleep: noSleep,
    });

    expect(result).toBe('recovered');
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenCalledTimes(1);
  });

  it('rethrows the last thrown error when every attempt fails', async () => {
    const attempt = jest.fn().mockRejectedValue(new Error('connection refused'));

    await expect(
      runWithRetries(attempt, { maxAttempts: 2, baseDelayMs: 250, sleep: noSleep }),
    ).rejects.toThrow('connection refused');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('reports 1-based attempt numbers to the callback', async () => {
    const seen: number[] = [];
    const attempt = jest
      .fn()
      .mockResolvedValueOnce({ done: false, retry: true, value: 'transient' })
      .mockResolvedValueOnce({ done: true, value: 'ok' });

    await runWithRetries(attempt, {
      maxAttempts: 3,
      baseDelayMs: 250,
      sleep: noSleep,
      onRetry: ({ attempt: n }) => seen.push(n),
    });

    expect(seen).toEqual([1]);
    expect(attempt.mock.calls.map(([ctx]) => ctx.attempt)).toEqual([1, 2]);
  });

  it('passes the total budget to the callback', async () => {
    const attempt = jest
      .fn()
      .mockResolvedValueOnce({ done: false, retry: true, value: 'transient' })
      .mockResolvedValueOnce({ done: true, value: 'ok' });

    await runWithRetries(attempt, {
      maxAttempts: 4,
      baseDelayMs: 250,
      sleep: noSleep,
      onRetry: ({ maxAttempts }) => expect(maxAttempts).toBe(4),
    });

    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('honours a custom backoff', async () => {
    const attempt = jest
      .fn()
      .mockResolvedValue({ done: false, retry: true, value: 'transient' });

    await runWithRetries(attempt, {
      maxAttempts: 3,
      baseDelayMs: 250,
      sleep: noSleep,
      backoff: (n) => 10 * n,
    });

    expect(noSleep.mock.calls).toEqual([[10], [20]]);
  });
});

describe('shared gateway defaults', () => {
  it('keeps the attempt budget and base delay the adapters historically used', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(DEFAULT_RETRY_BASE_DELAY_MS).toBe(250);
  });
});
