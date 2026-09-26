/**
 * Integration tests — RPC resilience critical paths — Issue #941
 *
 * Tests the full pipeline:
 *   ResilientJsonRpcProvider (src) → circuit breaker + timeout + fallback
 *   RpcCircuitBreakerService (backend) → state machine + audit log
 *   rpcTimeout → AbortController deadline
 *
 * All network I/O is stubbed.
 */

import {
  ResilientJsonRpcProvider,
  getOrCreateResilientProvider,
  clearResilientProviderRegistry,
  RpcProviderTimeoutError,
  AllRpcProvidersFailedError,
} from '../../../src/services/rpcProvider';

import {
  RpcCircuitBreakerService,
  RpcAllProvidersFailedError,
  RpcTimeoutError as BackendRpcTimeoutError,
  type RpcProviderConfig,
} from '../../services/rpcCircuitBreaker';

import {
  withRpcTimeout,
  wrapWithTimeout,
  RpcCallTimeoutError,
} from '../../services/shared/rpcTimeout';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeProvider(id: string, priority = 0, timeoutMs?: number): RpcProviderConfig {
  return {
    id,
    label: `Provider ${id}`,
    url: `https://${id}.example.com`,
    priority,
    timeoutMs,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

afterEach(() => {
  clearResilientProviderRegistry();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Timeout fires and bubbles as typed error
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: timeout enforcement', () => {
  it('withRpcTimeout fires and rejects as RpcCallTimeoutError', async () => {
    const hanging = new Promise<never>(() => { /* never resolves */ });
    const p = wrapWithTimeout(hanging, { timeoutMs: 50, endpointUrl: 'https://eth.example.com' });
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(RpcCallTimeoutError);
    expect(err.endpointUrl).toBe('https://eth.example.com');
  }, 500);

  it('RpcCircuitBreakerService fires RpcTimeoutError when provider hangs', async () => {
    const svc = new RpcCircuitBreakerService([makeProvider('slow', 0, 50)], {
      failureThreshold: 10,
    });
    const err = await svc.call(
      (_url, signal) => new Promise<never>((_, rej) => {
        signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
      })
    ).catch((e) => e) as RpcAllProvidersFailedError;

    expect(err).toBeInstanceOf(RpcAllProvidersFailedError);
    expect(err.errors[0].error).toBeInstanceOf(BackendRpcTimeoutError);
  }, 500);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Circuit breaker opens after threshold and skips provider
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: circuit breaker trips and recovers', () => {
  it('opens circuit after failureThreshold consecutive failures', async () => {
    const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
      failureThreshold: 3,
      defaultTimeoutMs: 200,
    });

    for (let i = 0; i < 3; i++) {
      await svc.call(async () => { throw new Error('rpc error'); }).catch(() => null);
    }

    expect(svc.getCircuitStatus('p1').state).toBe('open');
  });

  it('skips open circuit and falls through to secondary provider', async () => {
    const svc = new RpcCircuitBreakerService(
      [makeProvider('p1', 0), makeProvider('p2', 1)],
      { failureThreshold: 1, recoveryTimeoutMs: 60_000, defaultTimeoutMs: 200 },
    );

    // Trip p1 using url-discriminating fn
    await svc.call(async (url) => {
      if (url.includes('p1')) throw new Error('p1 down');
      return 'ok';
    }).catch(() => null);

    expect(svc.getCircuitStatus('p1').state).toBe('open');

    // p1 skipped; p2 responds
    const result = await svc.call(async () => 'p2-response');
    expect(result).toBe('p2-response');
  });

  it('transitions OPEN → HALF-OPEN → CLOSED after recoveryTimeoutMs', async () => {
    const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
      failureThreshold: 1,
      recoveryTimeoutMs: 50,
      successThreshold: 1,
      defaultTimeoutMs: 200,
    });

    await svc.call(async () => { throw new Error('fail'); }).catch(() => null);
    expect(svc.getCircuitStatus('p1').state).toBe('open');

    await sleep(70);
    await svc.call(async () => 'probe').catch(() => null);
    expect(svc.getCircuitStatus('p1').state).toBe('closed');
  }, 1_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Ordered URL fallback in ResilientJsonRpcProvider
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: ResilientJsonRpcProvider URL fallback', () => {
  it('tries URLs in order and succeeds on the second', async () => {
    const provider = new ResilientJsonRpcProvider(
      ['https://primary.example.com', 'https://fallback.example.com'],
      1,
      { timeoutMs: 5_000, failureThreshold: 1 },
    );

    const attempted: string[] = [];
    // Intercept the parent send
    jest.spyOn(provider as unknown as { _callWithTimeout: (...a: unknown[]) => unknown }, '_callWithTimeout')
      .mockImplementation(async (url: unknown, _method: unknown, _params: unknown) => {
        attempted.push(url as string);
        if ((url as string).includes('primary')) throw new Error('primary down');
        return 'fallback-ok';
      });

    const result = await provider.send('eth_blockNumber', []);
    expect(result).toBe('fallback-ok');
    expect(attempted[0]).toContain('primary');
    expect(attempted[1]).toContain('fallback');
  });

  it('throws AllRpcProvidersFailedError when all URLs fail', async () => {
    const provider = new ResilientJsonRpcProvider(
      ['https://a.example.com', 'https://b.example.com'],
      1,
      { timeoutMs: 5_000, failureThreshold: 10 },
    );

    jest.spyOn(provider as unknown as { _callWithTimeout: (...a: unknown[]) => unknown }, '_callWithTimeout')
      .mockRejectedValue(new Error('all down'));

    await expect(provider.send('eth_blockNumber', [])).rejects.toBeInstanceOf(AllRpcProvidersFailedError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Circuit breaker per URL in ResilientJsonRpcProvider
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: per-URL circuit in ResilientJsonRpcProvider', () => {
  it('marks URL circuit as open after failureThreshold failures', async () => {
    const url = 'https://flaky.example.com';
    const provider = new ResilientJsonRpcProvider([url], 1, {
      timeoutMs: 5_000,
      failureThreshold: 3,
    });

    jest.spyOn(provider as unknown as { _callWithTimeout: (...a: unknown[]) => unknown }, '_callWithTimeout')
      .mockRejectedValue(new Error('rpc down'));

    for (let i = 0; i < 3; i++) {
      await provider.send('eth_blockNumber', []).catch(() => null);
    }

    const states = provider.getCircuitStates();
    expect(states[url].state).toBe('open');
  });

  it('resetAllCircuits resets every URL to closed', async () => {
    const url = 'https://flaky.example.com';
    const provider = new ResilientJsonRpcProvider([url], 1, {
      timeoutMs: 5_000,
      failureThreshold: 1,
    });

    jest.spyOn(provider as unknown as { _callWithTimeout: (...a: unknown[]) => unknown }, '_callWithTimeout')
      .mockRejectedValue(new Error('down'));

    await provider.send('eth_blockNumber', []).catch(() => null);
    expect(provider.getCircuitStates()[url].state).toBe('open');

    provider.resetAllCircuits();
    expect(provider.getCircuitStates()[url].state).toBe('closed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Registry singleton behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: provider registry', () => {
  it('same chain+urls returns identical instance', () => {
    const a = getOrCreateResilientProvider(1, ['https://cloudflare-eth.com']);
    const b = getOrCreateResilientProvider(1, ['https://cloudflare-eth.com']);
    expect(a).toBe(b);
  });

  it('different chains return different instances', () => {
    const a = getOrCreateResilientProvider(1, ['https://eth.example.com']);
    const b = getOrCreateResilientProvider(137, ['https://polygon.example.com']);
    expect(a).not.toBe(b);
  });

  it('circuit state persists across calls via shared instance', async () => {
    const url = 'https://shared.example.com';
    const p1 = getOrCreateResilientProvider(1, [url], { failureThreshold: 2 });

    jest.spyOn(p1 as unknown as { _callWithTimeout: (...a: unknown[]) => unknown }, '_callWithTimeout')
      .mockRejectedValue(new Error('down'));

    // Two failures on the shared instance
    await p1.send('eth_blockNumber', []).catch(() => null);
    await p1.send('eth_blockNumber', []).catch(() => null);

    // Second reference to the same provider sees accumulated state
    const p2 = getOrCreateResilientProvider(1, [url], { failureThreshold: 2 });
    expect(p2.getCircuitStates()[url].state).toBe('open');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Manual circuit reset
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: manual circuit reset — RpcCircuitBreakerService', () => {
  it('resetCircuit allows successful call after open circuit', async () => {
    const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
      failureThreshold: 1,
      recoveryTimeoutMs: 60_000,
      defaultTimeoutMs: 200,
    });

    await svc.call(async () => { throw new Error('fail'); }).catch(() => null);
    expect(svc.getCircuitStatus('p1').state).toBe('open');

    svc.resetCircuit('p1');
    expect(svc.getCircuitStatus('p1').state).toBe('closed');

    const result = await svc.call(async () => 'success-after-reset');
    expect(result).toBe('success-after-reset');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Graceful degradation audit trail
// ─────────────────────────────────────────────────────────────────────────────

describe('Integration: audit log and dashboard', () => {
  it('dashboard reflects open/closed counts after failures', async () => {
    const svc = new RpcCircuitBreakerService(
      [makeProvider('p1', 0), makeProvider('p2', 1)],
      { failureThreshold: 1, recoveryTimeoutMs: 60_000, defaultTimeoutMs: 200 },
    );

    // Trip p1 only
    await svc.call(async (url) => {
      if (url.includes('p1')) throw new Error('p1 down');
      return 'ok';
    }).catch(() => null);

    const dash = svc.getDashboard();
    expect(dash.openCount).toBe(1);
    expect(dash.closedCount).toBe(1);
  });

  it('audit log contains state_change event when circuit opens', async () => {
    const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
      failureThreshold: 1,
      defaultTimeoutMs: 200,
    });

    await svc.call(async () => { throw new Error('boom'); }).catch(() => null);
    const log = svc.getAuditLog();
    expect(log.some((e) => e.type === 'state_change' && e.newState === 'open')).toBe(true);
  });
});
