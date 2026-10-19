/**
 * Tests for the resilient RPC provider's registry and error surface.
 *
 * These deliberately avoid exercising real network I/O: the behaviour that
 * matters for this change (which errors count against a circuit, URL-swap
 * serialisation) is covered by `isTransportFailure` tests in
 * `transactionConfirmation.test.ts` and by the backend integration suite.
 *
 * @see src/services/rpcProvider.ts
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1683
 */

import {
  AllRpcProvidersFailedError,
  RpcProviderCircuitOpenError,
  RpcProviderTimeoutError,
  clearResilientProviderRegistry,
  defaultChainTimeoutMs,
  getOrCreateResilientProvider,
  isTransportFailure,
} from '../rpcProvider';

const PRIMARY = 'https://primary.example/rpc';
const FALLBACK = 'https://fallback.example/rpc';

describe('defaultChainTimeoutMs', () => {
  it('allows more headroom on high-variance L2 chains', () => {
    expect(defaultChainTimeoutMs(10)).toBe(15_000);
    expect(defaultChainTimeoutMs(137)).toBe(15_000);
    expect(defaultChainTimeoutMs(8453)).toBe(15_000);
  });

  it('uses the tighter default on Ethereum mainnet', () => {
    expect(defaultChainTimeoutMs(1)).toBe(10_000);
  });

  it('falls back to the default for unknown chains', () => {
    expect(defaultChainTimeoutMs(999999)).toBe(10_000);
  });
});

describe('getOrCreateResilientProvider', () => {
  beforeEach(() => {
    clearResilientProviderRegistry();
  });

  afterEach(() => {
    clearResilientProviderRegistry();
  });

  it('returns the same instance for the same chain and URL set', () => {
    const first = getOrCreateResilientProvider(1, [PRIMARY, FALLBACK]);
    const second = getOrCreateResilientProvider(1, [PRIMARY, FALLBACK]);
    expect(second).toBe(first);
  });

  it('ignores URL order so circuit state is not silently reset', () => {
    const first = getOrCreateResilientProvider(1, [PRIMARY, FALLBACK]);
    const second = getOrCreateResilientProvider(1, [FALLBACK, PRIMARY]);
    expect(second).toBe(first);
  });

  it('keeps separate instances per chain', () => {
    const mainnet = getOrCreateResilientProvider(1, [PRIMARY]);
    const polygon = getOrCreateResilientProvider(137, [PRIMARY]);
    expect(mainnet).not.toBe(polygon);
  });

  it('keeps separate instances for different URL sets', () => {
    const first = getOrCreateResilientProvider(1, [PRIMARY]);
    const second = getOrCreateResilientProvider(1, [PRIMARY, FALLBACK]);
    expect(first).not.toBe(second);
  });

  it('starts every circuit closed', () => {
    const provider = getOrCreateResilientProvider(1, [PRIMARY, FALLBACK]);
    const states = provider.getCircuitStates();

    expect(states[PRIMARY]).toEqual({ state: 'closed', consecutiveFailures: 0 });
    expect(states[FALLBACK]).toEqual({ state: 'closed', consecutiveFailures: 0 });
  });

  it('resets every circuit on demand', () => {
    const provider = getOrCreateResilientProvider(1, [PRIMARY, FALLBACK]);
    provider.resetAllCircuits();

    const states = provider.getCircuitStates();
    expect(states[PRIMARY].state).toBe('closed');
    expect(states[FALLBACK].state).toBe('closed');
  });

  it('drops every cached provider when the registry is cleared', () => {
    const first = getOrCreateResilientProvider(1, [PRIMARY]);
    clearResilientProviderRegistry();
    const second = getOrCreateResilientProvider(1, [PRIMARY]);

    expect(second).not.toBe(first);
  });
});

describe('isTransportFailure', () => {
  const withCode = (message: string, code: unknown): Error =>
    Object.assign(new Error(message), { code });

  it('classifies an explicit timeout as a transport failure', () => {
    expect(isTransportFailure(withCode('nope', 'TIMEOUT'))).toBe(true);
  });

  it('classifies connection-level errors as transport failures', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ERR_NETWORK']) {
      expect(isTransportFailure(withCode('x', code))).toBe(true);
    }
  });

  it('does not treat a JSON-RPC application error as a transport failure', () => {
    // A revert carries a numeric JSON-RPC code. The node answered correctly,
    // so counting it as a circuit failure would evict a healthy endpoint.
    expect(isTransportFailure(withCode('execution reverted', 3))).toBe(false);
  });

  it('does not treat insufficient funds as a transport failure', () => {
    const nested = Object.assign(new Error('insufficient funds'), {
      error: { code: -32000 },
    });
    expect(isTransportFailure(nested)).toBe(false);
  });

  it('treats fetch-level errors as transport failures', () => {
    expect(isTransportFailure(new TypeError('failed to fetch'))).toBe(true);
  });

  it('returns false for non-error values', () => {
    expect(isTransportFailure(null)).toBe(false);
    expect(isTransportFailure(undefined)).toBe(false);
    expect(isTransportFailure('nope')).toBe(false);
  });
});

describe('provider error types', () => {
  it('exposes a stable code and context for timeouts', () => {
    const error = new RpcProviderTimeoutError(PRIMARY, 100);
    expect(error.code).toBe('RPC_PROVIDER_TIMEOUT');
    expect(error.endpointUrl).toBe(PRIMARY);
    expect(error.timeoutMs).toBe(100);
    expect(error).toBeInstanceOf(Error);
  });

  it('exposes a stable code and context for an open circuit', () => {
    const error = new RpcProviderCircuitOpenError(FALLBACK);
    expect(error.code).toBe('RPC_PROVIDER_CIRCUIT_OPEN');
    expect(error.endpointUrl).toBe(FALLBACK);
  });

  it('reports every attempted endpoint when all of them fail', () => {
    const error = new AllRpcProvidersFailedError(1, [
      { url: PRIMARY, message: 'failed to fetch' },
      { url: FALLBACK, message: 'timed out' },
    ]);

    expect(error.code).toBe('ALL_RPC_PROVIDERS_FAILED');
    expect(error.chainId).toBe(1);
    expect(error.errors).toHaveLength(2);
    expect(error.message).toContain(PRIMARY);
    expect(error.message).toContain(FALLBACK);
  });
});
