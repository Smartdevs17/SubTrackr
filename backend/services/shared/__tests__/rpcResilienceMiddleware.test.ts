/**
 * Unit tests for backend/services/shared/rpcResilienceMiddleware.ts — Issue #941
 *
 * Tests the ResilientEthersProvider, factory, and registry without hitting
 * real RPC endpoints (super.send is mocked).
 */

import { ethers } from 'ethers';
import {
  ResilientEthersProvider,
  createResilientProvider,
  getOrCreateResilientProvider,
  clearProviderRegistry,
} from '../rpcResilienceMiddleware';

// ─── Mock MonitoringJsonRpcProvider (parent class) ────────────────────────────

jest.mock('../MonitoringJsonRpcProvider', () => {
  const { ethers: _ethers } = jest.requireActual('ethers') as typeof import('ethers');
  class MockMonitoringJsonRpcProvider extends _ethers.providers.JsonRpcProvider {
    constructor(urls: string | string[], network?: _ethers.providers.Networkish) {
      const urlArr = Array.isArray(urls) ? urls : [urls];
      super(urlArr[0], network);
    }
    // Make send mockable per-test
    async send(method: string, params: unknown[]): Promise<unknown> {
      return `mock:${method}`;
    }
  }
  return { MonitoringJsonRpcProvider: MockMonitoringJsonRpcProvider };
});

jest.mock('../rpcCircuitBreaker', () => ({
  RpcCircuitBreakerService: jest.fn().mockImplementation(() => ({
    getDashboard: jest.fn().mockReturnValue({
      totalProviders: 1,
      closedCount: 1,
      openCount: 0,
      halfOpenCount: 0,
      totalCallsAllTime: 0,
      overallSuccessRate: 1,
      providers: [],
      recentEvents: [],
    }),
    resetAllCircuits: jest.fn(),
  })),
  RpcAllProvidersFailedError: class extends Error {
    readonly errors: { providerId: string; error: Error }[];
    constructor(errors: { providerId: string; error: Error }[]) {
      super('All providers failed');
      this.errors = errors;
    }
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

afterEach(() => clearProviderRegistry());

// ─── createResilientProvider ──────────────────────────────────────────────────

describe('createResilientProvider', () => {
  it('returns a ResilientEthersProvider instance', () => {
    const p = createResilientProvider(1, ['https://cloudflare-eth.com']);
    expect(p).toBeInstanceOf(ResilientEthersProvider);
  });

  it('throws when urls array is empty', () => {
    expect(() => createResilientProvider(1, [])).toThrow();
  });

  it('creates a provider for each supported chain', () => {
    for (const chainId of [1, 137, 42161, 10, 8453]) {
      expect(() =>
        createResilientProvider(chainId, [`https://rpc.example.com/${chainId}`])
      ).not.toThrow();
    }
  });
});

// ─── ResilientEthersProvider.send ─────────────────────────────────────────────

describe('ResilientEthersProvider.send', () => {
  it('delegates to super.send and returns result', async () => {
    const provider = createResilientProvider(1, ['https://cloudflare-eth.com'], {
      timeoutMs: 5_000,
    });
    const result = await provider.send('eth_blockNumber', []);
    expect(result).toBe('mock:eth_blockNumber');
  });

  it('applies per-call timeout — wraps super.send via wrapWithTimeout', async () => {
    // Override send on the parent mock to hang
    const provider = createResilientProvider(1, ['https://slow.example.com'], {
      timeoutMs: 50,
    });
    // Overwrite inherited send to simulate a hang
    jest.spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(provider)),
      'send',
    ).mockImplementation(
      () => new Promise(() => { /* never resolves */ })
    );

    await expect(provider.send('eth_getBalance', ['0x0', 'latest'])).rejects.toThrow();
  }, 500);
});

// ─── getOrCreateResilientProvider (registry) ─────────────────────────────────

describe('getOrCreateResilientProvider', () => {
  it('returns the same instance for the same chainId+urls', () => {
    const urls = ['https://cloudflare-eth.com'];
    const a = getOrCreateResilientProvider(1, urls);
    const b = getOrCreateResilientProvider(1, urls);
    expect(a).toBe(b);
  });

  it('returns different instances for different chains', () => {
    const a = getOrCreateResilientProvider(1, ['https://eth.example.com']);
    const b = getOrCreateResilientProvider(137, ['https://polygon.example.com']);
    expect(a).not.toBe(b);
  });

  it('returns same instance regardless of URL order (sorted key)', () => {
    const a = getOrCreateResilientProvider(1, ['https://a.example.com', 'https://b.example.com']);
    const b = getOrCreateResilientProvider(1, ['https://b.example.com', 'https://a.example.com']);
    expect(a).toBe(b);
  });

  it('clears registry — clearProviderRegistry creates fresh instance', () => {
    const urls = ['https://cloudflare-eth.com'];
    const a = getOrCreateResilientProvider(1, urls);
    clearProviderRegistry();
    const b = getOrCreateResilientProvider(1, urls);
    expect(a).not.toBe(b);
  });
});

// ─── ResilientEthersProvider.getHealth ───────────────────────────────────────

describe('ResilientEthersProvider.getHealth', () => {
  it('returns a snapshot with chainId', () => {
    const provider = createResilientProvider(137, ['https://polygon-rpc.com']);
    const health = provider.getHealth();
    expect(health.chainId).toBe(137);
    expect(typeof health.overallSuccessRate).toBe('number');
  });

  it('allOpen is false when providers have closed circuits', () => {
    const provider = createResilientProvider(1, ['https://cloudflare-eth.com']);
    const health = provider.getHealth();
    expect(health.allOpen).toBe(false);
  });
});

// ─── ResilientEthersProvider.resetCircuits ───────────────────────────────────

describe('ResilientEthersProvider.resetCircuits', () => {
  it('calls resetAllCircuits on the underlying service without throwing', () => {
    const provider = createResilientProvider(1, ['https://cloudflare-eth.com']);
    expect(() => provider.resetCircuits()).not.toThrow();
  });
});
