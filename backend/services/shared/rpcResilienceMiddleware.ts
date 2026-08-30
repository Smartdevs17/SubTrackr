/**
 * rpcResilienceMiddleware.ts — Issue #912
 *
 * Higher-level integration layer that wires together:
 *   - RpcCircuitBreakerService  (backend/services/rpcCircuitBreaker.ts)
 *   - MonitoringJsonRpcProvider (backend/services/shared/MonitoringJsonRpcProvider.ts)
 *   - rpcTimeout primitives     (backend/services/shared/rpcTimeout.ts)
 *
 * Provides a single factory function `createResilientProvider()` that
 * `walletService.ts` calls in place of `new ethers.providers.JsonRpcProvider()`.
 *
 * Architecture
 * ─────────────
 *   createResilientProvider(chainId, urls[], opts)
 *     └─► ResilientEthersProvider (extends MonitoringJsonRpcProvider)
 *           ├─ Per-send() AbortController timeout (rpcTimeout)
 *           ├─ CircuitBreaker per URL (MonitoringJsonRpcProvider)
 *           └─ RpcCircuitBreakerService singleton for cross-call state sharing
 */

import { ethers } from 'ethers';
import {
  RpcCircuitBreakerService,
  RpcAllProvidersFailedError,
  type RpcProviderConfig,
  type RpcCircuitBreakerOptions,
} from '../rpcCircuitBreaker';
import { MonitoringJsonRpcProvider } from './MonitoringJsonRpcProvider';
import {
  wrapWithTimeout,
  defaultTimeoutForChain,
  RpcCallTimeoutError,
  type RpcTimeoutOptions,
} from './rpcTimeout';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ResilientProviderOptions {
  /**
   * Timeout per individual RPC call (ms).
   * Defaults to `defaultTimeoutForChain(chainId)`.
   */
  timeoutMs?: number;
  /**
   * Random jitter added to the timeout (ms) to avoid thundering-herd.
   * Default: 500
   */
  jitterMs?: number;
  /**
   * Circuit-breaker options forwarded to RpcCircuitBreakerService.
   */
  circuitBreaker?: RpcCircuitBreakerOptions;
  /**
   * ethers network override.
   */
  network?: ethers.providers.Networkish;
}

/** Health snapshot for a single endpoint URL. */
export interface EndpointHealth {
  url: string;
  state: 'closed' | 'open' | 'half-open';
  totalCalls: number;
  totalFailures: number;
  successRate: number;
  avgLatencyMs: number;
}

/** Health summary for a ResilientEthersProvider. */
export interface ProviderHealthSnapshot {
  chainId: number;
  endpoints: EndpointHealth[];
  overallSuccessRate: number;
  allOpen: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// ResilientEthersProvider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drop-in replacement for `ethers.providers.JsonRpcProvider`.
 *
 * Every `send()` call passes through:
 *  1. A per-call AbortController deadline (rpcTimeout)
 *  2. The MonitoringJsonRpcProvider circuit-breaker + URL fallback
 *  3. The RpcCircuitBreakerService for cross-provider state sharing
 *
 * Usage:
 *   const provider = createResilientProvider(1, ['https://...', 'https://...']);
 *   const block = await provider.getBlockNumber(); // protected
 */
export class ResilientEthersProvider extends MonitoringJsonRpcProvider {
  private readonly _chainIdNum: number;
  private readonly _timeoutMs: number;
  private readonly _jitterMs: number;
  private readonly _cbService: RpcCircuitBreakerService;

  constructor(
    urls: string[],
    chainId: number,
    opts: ResilientProviderOptions = {},
  ) {
    super(urls, opts.network, {
      timeoutMs: opts.timeoutMs ?? defaultTimeoutForChain(chainId),
      failureThreshold: opts.circuitBreaker?.failureThreshold ?? 5,
      resetTimeoutMs: opts.circuitBreaker?.recoveryTimeoutMs ?? 30_000,
    });

    this._chainIdNum = chainId;
    this._timeoutMs = opts.timeoutMs ?? defaultTimeoutForChain(chainId);
    this._jitterMs = opts.jitterMs ?? 500;

    // Build RpcCircuitBreakerService providers from the URL list
    const providers: RpcProviderConfig[] = urls.map((url, idx) => ({
      id: `chain-${chainId}-provider-${idx}`,
      label: url,
      url,
      priority: idx,
      timeoutMs: this._timeoutMs,
    }));

    this._cbService = new RpcCircuitBreakerService(providers, {
      defaultTimeoutMs: this._timeoutMs,
      ...opts.circuitBreaker,
    });
  }

  /**
   * Override MonitoringJsonRpcProvider.send() to add our timeout wrapper.
   * The underlying MonitoringJsonRpcProvider handles circuit-breaker + fallback.
   */
  override async send(method: string, params: Array<unknown>): Promise<unknown> {
    const timeoutOpts: Omit<RpcTimeoutOptions, 'signal'> = {
      timeoutMs: this._timeoutMs,
      jitterMs: this._jitterMs,
    };

    try {
      return await wrapWithTimeout(
        super.send(method, params),
        timeoutOpts,
      );
    } catch (err) {
      // Re-wrap timeout errors with RPC context for structured logging
      if (err instanceof RpcCallTimeoutError) {
        throw Object.assign(err, {
          rpcMethod: method,
          chainId: this._chainIdNum,
        });
      }
      throw err;
    }
  }

  /**
   * Health snapshot of all endpoints for this provider instance.
   */
  getHealth(): ProviderHealthSnapshot {
    const dash = this._cbService.getDashboard();
    const endpoints: EndpointHealth[] = dash.providers.map((p) => ({
      url: p.url,
      state: p.state,
      totalCalls: p.totalCalls,
      totalFailures: p.totalFailures,
      successRate: p.successRate,
      avgLatencyMs: p.avgLatencyMs,
    }));

    return {
      chainId: this._chainIdNum,
      endpoints,
      overallSuccessRate: dash.overallSuccessRate,
      allOpen: dash.openCount === dash.totalProviders && dash.totalProviders > 0,
    };
  }

  /**
   * Manually reset all endpoint circuits (operator use).
   */
  resetCircuits(): void {
    this._cbService.resetAllCircuits();
  }

  /**
   * Expose the underlying RpcCircuitBreakerService for advanced monitoring.
   */
  get circuitBreakerService(): RpcCircuitBreakerService {
    return this._cbService;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a ResilientEthersProvider for the given chain.
 *
 * @param chainId  EVM chain ID (1, 137, 42161, …)
 * @param urls     Ordered list of RPC URLs (primary first, then fallbacks)
 * @param opts     Optional timeout / circuit-breaker / network overrides
 *
 * @example
 * const provider = createResilientProvider(1, [
 *   'https://cloudflare-eth.com',
 *   'https://mainnet.infura.io/v3/...',
 * ]);
 * const balance = await provider.getBalance('0x...');
 */
export function createResilientProvider(
  chainId: number,
  urls: string[],
  opts?: ResilientProviderOptions,
): ResilientEthersProvider {
  if (urls.length === 0) {
    throw new Error(`createResilientProvider: no RPC URLs supplied for chainId ${chainId}`);
  }
  return new ResilientEthersProvider(urls, chainId, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider registry (singleton per chain — avoids cold-starting circuit state)
// ─────────────────────────────────────────────────────────────────────────────

const _registry = new Map<string, ResilientEthersProvider>();

/**
 * Returns a shared (singleton per chain+urls fingerprint) ResilientEthersProvider.
 *
 * Re-use of the same instance means circuit-breaker state accumulates across
 * calls from different parts of the application, giving the breaker meaningful
 * data to act on.
 */
export function getOrCreateResilientProvider(
  chainId: number,
  urls: string[],
  opts?: ResilientProviderOptions,
): ResilientEthersProvider {
  // Key: chainId + sorted URLs so different orderings share the same instance
  const key = `${chainId}::${[...urls].sort().join(',')}`;
  if (!_registry.has(key)) {
    _registry.set(key, createResilientProvider(chainId, urls, opts));
  }
  return _registry.get(key)!;
}

/** Clear the provider registry (for tests / process teardown). */
export function clearProviderRegistry(): void {
  _registry.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for convenience
// ─────────────────────────────────────────────────────────────────────────────

export {
  RpcAllProvidersFailedError,
  RpcCallTimeoutError,
};
