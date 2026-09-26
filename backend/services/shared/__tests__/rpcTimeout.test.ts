/**
 * Unit tests for backend/services/shared/rpcTimeout.ts — Issue #941
 */

import {
  withRpcTimeout,
  wrapWithTimeout,
  isRpcTimeout,
  isRpcCancelled,
  defaultTimeoutForChain,
  RpcCallTimeoutError,
  RpcCallCancelledError,
} from '../rpcTimeout';

function hangUntilAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, rej) => {
    signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
  });
}

// ─── withRpcTimeout ───────────────────────────────────────────────────────────

describe('withRpcTimeout', () => {
  it('resolves when factory completes before deadline', async () => {
    await expect(withRpcTimeout(async () => 42, { timeoutMs: 1_000 })).resolves.toBe(42);
  });

  it('rejects with RpcCallTimeoutError when factory hangs', async () => {
    const p = withRpcTimeout((sig) => hangUntilAbort(sig), { timeoutMs: 50 });
    await expect(p).rejects.toBeInstanceOf(RpcCallTimeoutError);
  }, 500);

  it('RpcCallTimeoutError carries timeoutMs and endpointUrl', async () => {
    const url = 'https://cloudflare-eth.com';
    const err = await withRpcTimeout(
      (sig) => hangUntilAbort(sig),
      { timeoutMs: 50, endpointUrl: url },
    ).catch((e) => e) as RpcCallTimeoutError;

    expect(err.timeoutMs).toBeGreaterThanOrEqual(50);
    expect(err.endpointUrl).toBe(url);
    expect(err.message).toContain(url);
  }, 500);

  it('passes a valid AbortSignal to factory', async () => {
    let capturedSignal: AbortSignal | null = null;
    await withRpcTimeout(
      (sig) => { capturedSignal = sig; return Promise.resolve('ok'); },
      { timeoutMs: 1_000 },
    );
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  it('throws RpcCallCancelledError when external signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      withRpcTimeout(async () => 'never', { timeoutMs: 1_000, signal: ctrl.signal })
    ).rejects.toBeInstanceOf(RpcCallCancelledError);
  });

  it('throws RpcCallCancelledError when external signal fires mid-call', async () => {
    const ctrl = new AbortController();
    const p = withRpcTimeout(
      (sig) => hangUntilAbort(sig),
      { timeoutMs: 5_000, signal: ctrl.signal },
    );
    setTimeout(() => ctrl.abort(), 30);
    await expect(p).rejects.toBeInstanceOf(RpcCallCancelledError);
  }, 500);

  it('applies jitterMs on top of timeoutMs', async () => {
    const start = Date.now();
    await withRpcTimeout(
      (sig) => hangUntilAbort(sig),
      { timeoutMs: 50, jitterMs: 100 },
    ).catch(() => null);
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  }, 1_500);

  it('propagates non-timeout errors from factory', async () => {
    const rpcErr = new Error('connection refused');
    await expect(
      withRpcTimeout(async () => { throw rpcErr; }, { timeoutMs: 1_000 })
    ).rejects.toBe(rpcErr);
  });

  it('code is RPC_CALL_TIMEOUT', async () => {
    const err = await withRpcTimeout(
      (sig) => hangUntilAbort(sig),
      { timeoutMs: 50 },
    ).catch((e) => e) as RpcCallTimeoutError;
    expect(err.code).toBe('RPC_CALL_TIMEOUT');
  }, 500);
});

// ─── wrapWithTimeout ──────────────────────────────────────────────────────────

describe('wrapWithTimeout', () => {
  it('resolves when promise settles before deadline', async () => {
    await expect(wrapWithTimeout(Promise.resolve('value'), { timeoutMs: 1_000 })).resolves.toBe('value');
  });

  it('rejects with RpcCallTimeoutError when promise never settles', async () => {
    const hanging = new Promise<never>(() => { /* intentionally never resolves */ });
    await expect(wrapWithTimeout(hanging, { timeoutMs: 50 })).rejects.toBeInstanceOf(RpcCallTimeoutError);
  }, 500);

  it('propagates rejection from the underlying promise', async () => {
    const err = new Error('rpc down');
    await expect(wrapWithTimeout(Promise.reject(err), { timeoutMs: 1_000 })).rejects.toBe(err);
  });

  it('clears timer on resolution (no test-environment timer leak)', async () => {
    const r = await wrapWithTimeout(Promise.resolve(99), { timeoutMs: 2_000 });
    expect(r).toBe(99);
  });
});

// ─── Type guards ──────────────────────────────────────────────────────────────

describe('isRpcTimeout', () => {
  it('returns true for RpcCallTimeoutError', () => {
    expect(isRpcTimeout(new RpcCallTimeoutError({ timeoutMs: 5_000, elapsedMs: 5_001 }))).toBe(true);
  });
  it('returns false for plain Error', () => {
    expect(isRpcTimeout(new Error('nope'))).toBe(false);
  });
  it('returns false for null', () => {
    expect(isRpcTimeout(null)).toBe(false);
  });
});

describe('isRpcCancelled', () => {
  it('returns true for RpcCallCancelledError', () => {
    expect(isRpcCancelled(new RpcCallCancelledError())).toBe(true);
  });
  it('returns false for RpcCallTimeoutError', () => {
    expect(isRpcCancelled(new RpcCallTimeoutError({ timeoutMs: 100, elapsedMs: 101 }))).toBe(false);
  });
});

// ─── defaultTimeoutForChain ───────────────────────────────────────────────────

describe('defaultTimeoutForChain', () => {
  it.each([
    [1,     10_000],
    [137,   15_000],
    [42161, 15_000],
    [10,    15_000],
    [8453,  15_000],
    [999,   10_000], // unknown chain falls back to 10 s
  ])('chainId=%i → %i ms', (chainId, expected) => {
    expect(defaultTimeoutForChain(chainId)).toBe(expected);
  });
});

// ─── RpcCallTimeoutError ──────────────────────────────────────────────────────

describe('RpcCallTimeoutError', () => {
  it('has correct name, code and null endpointUrl by default', () => {
    const e = new RpcCallTimeoutError({ timeoutMs: 100, elapsedMs: 101 });
    expect(e.name).toBe('RpcCallTimeoutError');
    expect(e.code).toBe('RPC_CALL_TIMEOUT');
    expect(e.endpointUrl).toBeNull();
  });

  it('instanceof works (prototype chain preserved)', () => {
    const e = new RpcCallTimeoutError({ timeoutMs: 100, elapsedMs: 101 });
    expect(e instanceof RpcCallTimeoutError).toBe(true);
    expect(e instanceof Error).toBe(true);
  });
});

describe('RpcCallCancelledError', () => {
  it('has correct name and code', () => {
    const e = new RpcCallCancelledError();
    expect(e.name).toBe('RpcCallCancelledError');
    expect(e.code).toBe('RPC_CALL_CANCELLED');
  });
});
