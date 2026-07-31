/**
 * RPC Provider with Fallback — Issue #RPC-CB
 *
 * Wraps the circuit breaker pattern around actual RPC calls with:
 *   - Configurable timeout per call
 *   - Automatic fallback to alternative providers on failure
 *   - Graceful degradation (cache_stale / degraded / fail_fast)
 *   - Request-level abort via AbortController
 *
 * Usage:
 *   const provider = new RpcProviderFallback(ethereumConfig, rpcMonitorService);
 *   const result = await provider.call('eth_blockNumber', [], { method: 'POST' });
 *   // Or for read calls that can tolerate stale data:
 *   const result = await provider.callWithFallback('eth_call', [tx], { method: 'POST', dataType: 'read' });
 */

import {
  type RpcChainConfig,
  type RpcEndpointConfig,
  resolveEndpointUrl,
  DEFAULT_ENDPOINT_TIMEOUT_MS,
} from './rpcConfig';
import {
  CircuitBreaker,
  RpcTimeoutError,
  AllProvidersFailedError,
} from './circuitBreaker';
import type { RpcMonitorService } from './rpcMonitorService';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RpcCallOptions {
  /** HTTP method. Default: 'POST' */
  method?: string;
  /** Optional custom headers beyond what the endpoint provides. */
  headers?: Record<string, string>;
  /**
   * Type of data being requested.
   *   'read'  — Read-only call, can fall back to cached data.
   *   'write' — Transaction submission, must attempt all providers.
   *   'query' — General query, follows standard fallback logic.
   */
  dataType?: 'read' | 'write' | 'query';
  /** Custom timeout override for this call (ms). */
  timeoutMs?: number;
  /** AbortSignal for cancelling the request externally. */
  signal?: AbortSignal;
}

export interface RpcCallResult<T = unknown> {
  /** Parsed JSON response from the RPC provider. */
  data: T;
  /** Which endpoint URL served this request. */
  usedEndpoint: string;
  /** Which provider (index in the endpoints array) served this request. */
  usedProviderIndex: number;
  /** Total time taken including fallback attempts. */
  durationMs: number;
  /** Whether this was served from a degraded/cached source. */
  degraded: boolean;
  /** Error details if a fallback occurred. */
  fallbackErrors?: { endpoint: string; error: string; durationMs: number }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC Request/Response types
// ─────────────────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: unknown[];
  id: number;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

let jsonRpcIdCounter = 1;
function nextId(): number {
  return jsonRpcIdCounter++;
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC Provider Fallback
// ─────────────────────────────────────────────────────────────────────────────

export class RpcProviderFallback {
  private readonly chainConfig: RpcChainConfig;
  private readonly circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private readonly monitor: RpcMonitorService | null;

  /** Cache of last successful responses per JSON-RPC method (for degraded mode). */
  private lastSuccessfulCache = new Map<string, unknown>();
  private cacheTimestamps = new Map<string, number>();

  constructor(
    chainConfig: RpcChainConfig,
    monitor?: RpcMonitorService,
  ) {
    this.chainConfig = chainConfig;
    this.monitor = monitor ?? null;

    // Create a circuit breaker for each endpoint
    for (const endpoint of chainConfig.endpoints) {
      const cb = new CircuitBreaker(endpoint);
      cb.on('stateChange', (event) => {
        this.monitor?.recordCircuitEvent(event);
      });
      this.circuitBreakers.set(endpoint.url, cb);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Execute an RPC call on the chain, using circuit breaker and automatic
   * fallback across configured providers.
   *
   * @param method  JSON-RPC method (e.g. 'eth_blockNumber', 'eth_call')
   * @param params  Parameters array
   * @param options  Call options
   * @returns The RPC result
   * @throws CircuitOpenError — all circuits are open
   * @throws AllProvidersFailedError — all providers exhausted
   * @throws RpcTimeoutError — request timed out
   */
  async call<T = unknown>(
    method: string,
    params: unknown[],
    options: RpcCallOptions = {},
  ): Promise<RpcCallResult<T>> {
    const startTime = Date.now();
    const fallbackErrors: { endpoint: string; error: string; durationMs: number }[] = [];
    const cacheKey = this.cacheKey(method, params);

    // Determine which endpoints to try based on data type
    const endpointsToTry = this.getEligibleEndpoints(options.dataType ?? 'query');

    if (endpointsToTry.length === 0) {
      // All circuits are open — attempt degradation
      return this.handleDegraded<T>(cacheKey, method, Date.now() - startTime);
    }

    for (let i = 0; i < endpointsToTry.length; i++) {
      const endpoint = endpointsToTry[i];
      const cb = this.circuitBreakers.get(endpoint.url);

      // Check circuit breaker — allowRequest throws CircuitOpenError if fully open
      if (!cb) {
        fallbackErrors.push({
          endpoint: endpoint.url,
          error: 'No circuit breaker registered',
          durationMs: 0,
        });
        continue;
      }

      try {
        cb.allowRequest();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        fallbackErrors.push({
          endpoint: endpoint.url,
          error: errorMsg,
          durationMs: 0,
        });
        this.monitor?.recordSkippedCall(endpoint.url, this.chainConfig.chainId, cb.getState());
        continue;
      }

      const isProbe = cb.getState() === 'HALF_OPEN';
      const attemptStart = Date.now();

      try {
        const result = await this.executeSingleCall<T>(
          endpoint,
          method,
          params,
          options,
        );

        cb.recordSuccess(isProbe);
        this.cacheResponse(cacheKey, result);

        const elapsed = Date.now() - startTime;
        this.monitor?.recordSuccess(endpoint.url, this.chainConfig.chainId, elapsed);

        return {
          data: result,
          usedEndpoint: endpoint.url,
          usedProviderIndex: this.chainConfig.endpoints.indexOf(endpoint),
          durationMs: elapsed,
          degraded: false,
          fallbackErrors: fallbackErrors.length > 0 ? fallbackErrors : undefined,
        };
      } catch (err) {
        const attemptDuration = Date.now() - attemptStart;
        cb.recordFailure(isProbe);

        const errorMsg = err instanceof Error ? err.message : String(err);
        fallbackErrors.push({
          endpoint: endpoint.url,
          error: errorMsg,
          durationMs: attemptDuration,
        });

        this.monitor?.recordFailure(endpoint.url, this.chainConfig.chainId, errorMsg, attemptDuration);

        // Continue to next provider
      }
    }

    // All providers exhausted — handle degradation
    return this.handleDegraded<T>(cacheKey, method, Date.now() - startTime);
  }

  /**
   * Convenience method for read calls — uses 'read' data type.
   */
  async callRead<T = unknown>(
    method: string,
    params: unknown[],
    options: Omit<RpcCallOptions, 'dataType'> = {},
  ): Promise<RpcCallResult<T>> {
    return this.call<T>(method, params, { ...options, dataType: 'read' });
  }

  /**
   * Convenience method for write (transaction) calls — uses 'write' data type,
   * which will try all available endpoints even if partially degraded.
   */
  async callWrite<T = unknown>(
    method: string,
    params: unknown[],
    options: Omit<RpcCallOptions, 'dataType'> = {},
  ): Promise<RpcCallResult<T>> {
    return this.call<T>(method, params, { ...options, dataType: 'write' });
  }

  /**
   * Returns all circuit breaker snapshots for this chain's endpoints.
   */
  getCircuitStates(): ReturnType<CircuitBreaker['snapshot']>[] {
    return Array.from(this.circuitBreakers.values()).map((cb) => cb.snapshot());
  }

  /**
   * Manually reset the circuit breaker for a specific endpoint URL.
   */
  manualResetEndpoint(endpointUrl: string): boolean {
    const cb = this.circuitBreakers.get(endpointUrl);
    if (!cb) return false;
    cb.manualReset();
    return true;
  }

  /**
   * Manually reset all circuit breakers for this chain.
   */
  manualResetAll(): void {
    for (const cb of this.circuitBreakers.values()) {
      cb.manualReset();
    }
  }

  /**
   * Manually open the circuit for a specific endpoint URL.
   */
  manualOpenEndpoint(endpointUrl: string): boolean {
    const cb = this.circuitBreakers.get(endpointUrl);
    if (!cb) return false;
    cb.manualOpen();
    return true;
  }

  /** Update the chain configuration (hot-reload). */
  updateChainConfig(config: RpcChainConfig): void {
    this.chainConfig.endpoints = config.endpoints;
    // Add circuit breakers for any new endpoints
    for (const endpoint of config.endpoints) {
      if (!this.circuitBreakers.has(endpoint.url)) {
        const cb = new CircuitBreaker(endpoint);
        cb.on('stateChange', (event) => {
          this.monitor?.recordCircuitEvent(event);
        });
        this.circuitBreakers.set(endpoint.url, cb);
      }
    }
  }

  /** Get the chain ID. */
  getChainId(): number {
    return this.chainConfig.chainId;
  }

  /** Get the chain name. */
  getChainName(): string {
    return this.chainConfig.chainName;
  }

  /** Get the degradation policy for this chain. */
  getDegradationPolicy(): RpcChainConfig['onCircuitOpen'] {
    return this.chainConfig.onCircuitOpen;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Execute a single RPC call against an endpoint with timeout.
   */
  private async executeSingleCall<T>(
    endpoint: RpcEndpointConfig,
    method: string,
    params: unknown[],
    options: RpcCallOptions,
  ): Promise<T> {
    const url = resolveEndpointUrl(endpoint.url);
    const timeoutMs = options.timeoutMs ?? endpoint.timeoutMs ?? DEFAULT_ENDPOINT_TIMEOUT_MS;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Combine options.signal with our timeout
    const combinedSignal = options.signal
      ? this.combineSignals(options.signal, controller.signal)
      : controller.signal;

    // Handle abort from the caller
    if (options.signal?.aborted) {
      clearTimeout(timeoutId);
      throw new RpcTimeoutError(url, endpoint.chainId, timeoutMs);
    }

    const requestBody: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: nextId(),
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...endpoint.headers,
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        method: options.method ?? 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = (await response.json()) as JsonRpcResponse<T>;

      if (json.error) {
        throw new Error(`JSON-RPC error ${json.error.code}: ${json.error.message}`);
      }

      return json.result as T;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        throw new RpcTimeoutError(url, endpoint.chainId, timeoutMs);
      }

      throw err;
    }
  }

  /**
   * Returns endpoints eligible for the given data type (respects circuit state).
   * Callers must also check allowRequest() on each endpoint's circuit breaker.
   */
  private getEligibleEndpoints(dataType: 'read' | 'write' | 'query'): RpcEndpointConfig[] {
    const allEndpoints = this.chainConfig.endpoints;

    return allEndpoints.filter((ep) => {
      // Filter by read/write capability
      if (dataType === 'read' && !ep.supportsRead) return false;
      if (dataType === 'write' && !ep.supportsWrite) return false;
      return true;
    });
  }

  /**
   * Handle degradation when all providers fail.
   */
  private async handleDegraded<T>(
    cacheKey: string,
    method: string,
    totalDurationMs: number,
  ): Promise<RpcCallResult<T>> {

    // Attempt cache_stale or degraded response
    if (this.chainConfig.onAllFailed === 'cache_stale') {
      const cached = this.lastSuccessfulCache.get(cacheKey);
      if (cached !== undefined) {
        this.monitor?.recordDegradedResponse(this.chainConfig.chainId, method, 'cache_stale');

        return {
          data: cached as T,
          usedEndpoint: 'degraded_cache',
          usedProviderIndex: -1,
          durationMs: totalDurationMs,
          degraded: true,
          fallbackErrors: [
            { endpoint: 'all', error: 'All providers exhausted, serving stale cache', durationMs: totalDurationMs },
          ],
        };
      }
    }

    // If all providers failed and no cache fallback, throw
    this.monitor?.recordDegradedResponse(this.chainConfig.chainId, method, 'fail_fast');

    throw new AllProvidersFailedError(
      this.chainConfig.chainId,
      this.chainConfig.endpoints.map((e) => e.url),
    );
  }

  private cacheKey(method: string, params: unknown[]): string {
    return `${method}:${JSON.stringify(params)}`;
  }

  private cacheResponse(key: string, data: unknown): void {
    this.lastSuccessfulCache.set(key, data);
    this.cacheTimestamps.set(key, Date.now());

    // Prune cache if it grows too large (keep last 500 entries)
    if (this.lastSuccessfulCache.size > 500) {
      const oldestKey = this.cacheTimestamps.entries().next().value?.[0];
      if (oldestKey) {
        this.lastSuccessfulCache.delete(oldestKey);
        this.cacheTimestamps.delete(oldestKey);
      }
    }
  }

  private combineSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        return controller.signal;
      }
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
  }
}
