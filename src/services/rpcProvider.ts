/**
 * rpcProvider.ts — Issue #941
 *
 * Client-side resilient JSON-RPC provider for walletService.ts.
 *
 * Wraps ethers.providers.JsonRpcProvider with:
 *   - Per-call AbortController timeout
 *   - Per-URL circuit breaker (closed → open → half-open → closed)
 *   - Ordered URL fallback (primary → fallback₁ → fallback₂ …)
 *   - Singleton registry: circuit state accumulates across calls
 *
 * This module is intentionally dependency-free of backend code so it runs
 * in the React Native / Expo environment.
 */

import { ethers } from 'ethers';
import { logger } from './logging';

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class RpcProviderTimeoutError extends Error {
  readonly code = 'RPC_PROVIDER_TIMEOUT' as const;
  readonly endpointUrl: string;
  readonly timeoutMs: number;

  constructor(endpointUrl: string, timeoutMs: number) {
    super(`RPC provider at ${endpointUrl} timed out after ${timeoutMs} ms`);
    this.name = 'RpcProviderTimeoutError';
    this.endpointUrl = endpointUrl;
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RpcProviderCircuitOpenError extends Error {
  readonly code = 'RPC_PROVIDER_CIRCUIT_OPEN' as const;
  readonly endpointUrl: string;

  constructor(endpointUrl: string) {
    super(`Circuit breaker OPEN for RPC provider: ${endpointUrl}`);
    this.name = 'RpcProviderCircuitOpenError';
    this.endpointUrl = endpointUrl;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AllRpcProvidersFailedError extends Error {
  readonly code = 'ALL_RPC_PROVIDERS_FAILED' as const;
  readonly chainId: number;
  readonly errors: { url: string; message: string }[];

  constructor(chainId: number, errors: { url: string; message: string }[]) {
    super(
      `All RPC providers failed for chain ${chainId}: ` +
        errors.map((e) => `[${e.url}] ${e.message}`).join(' | ')
    );
    this.name = 'AllRpcProvidersFailedError';
    this.chainId = chainId;
    this.errors = errors;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit-breaker state per URL
// ─────────────────────────────────────────────────────────────────────────────

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitEntry {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
  /** Consecutive successes observed while HALF-OPEN, used to close the circuit. */
  halfOpenSuccesses: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface ResilientProviderConfig {
  /** Per-call timeout in ms. Default: chain-dependent (10_000 / 15_000). */
  timeoutMs?: number;
  /** Random jitter added to timeoutMs to prevent thundering-herd (ms). Default: 500. */
  jitterMs?: number;
  /** Consecutive failures to trip the circuit. Default: 5. */
  failureThreshold?: number;
  /** Ms the circuit stays OPEN before transitioning to HALF-OPEN. Default: 30_000. */
  recoveryTimeoutMs?: number;
  /** Consecutive successes in HALF-OPEN before closing the circuit. Default: 2. */
  successThreshold?: number;
}

const DEFAULT_CONFIG: Required<ResilientProviderConfig> = {
  timeoutMs: 10_000,
  jitterMs: 500,
  failureThreshold: 5,
  recoveryTimeoutMs: 30_000,
  successThreshold: 2,
};

/** Returns a sensible timeout for EVM chains with higher RPC variance. */
export function defaultChainTimeoutMs(chainId: number): number {
  switch (chainId) {
    case 1:
      return 10_000;
    case 137:
      return 15_000;
    case 42161:
      return 15_000;
    case 10:
      return 15_000;
    case 8453:
      return 15_000;
    default:
      return 10_000;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ResilientJsonRpcProvider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drop-in replacement for `ethers.providers.JsonRpcProvider`.
 *
 * Adds timeout + circuit breaker + ordered URL fallback to every
 * `send()` call, which is the single gateway all ethers provider
 * methods (getBalance, getGasPrice, estimateGas, …) funnel through.
 */
export class ResilientJsonRpcProvider extends ethers.providers.JsonRpcProvider {
  private readonly _urls: string[];
  private readonly _chainId: number;
  private readonly _config: Required<ResilientProviderConfig>;
  private readonly _circuits = new Map<string, CircuitEntry>();

  /**
   * The base ethers provider talks to a single mutable `connection.url`, so
   * exactly one `send()` may be swapping that URL at a time. Without this
   * chain, two concurrent calls (e.g. `getBalancesAcrossChains`, which fans
   * out in parallel) interleave and one of them is sent to the other's
   * endpoint — which may be a node on an entirely different chain.
   */
  private _swapChain: Promise<unknown> = Promise.resolve();

  constructor(urls: string[], chainId: number, config: ResilientProviderConfig = {}) {
    super(urls[0], chainId);
    this._urls = urls;
    this._chainId = chainId;
    this._config = {
      timeoutMs: config.timeoutMs ?? defaultChainTimeoutMs(chainId),
      jitterMs: config.jitterMs ?? DEFAULT_CONFIG.jitterMs,
      failureThreshold: config.failureThreshold ?? DEFAULT_CONFIG.failureThreshold,
      recoveryTimeoutMs: config.recoveryTimeoutMs ?? DEFAULT_CONFIG.recoveryTimeoutMs,
      successThreshold: config.successThreshold ?? DEFAULT_CONFIG.successThreshold,
    };

    // Initialise circuit entries for every URL
    for (const url of this._urls) {
      this._circuits.set(url, {
        state: 'closed',
        consecutiveFailures: 0,
        openedAt: null,
        halfOpenSuccesses: 0,
      });
    }
  }

  // ── Override send() — all ethers methods funnel through here ──────────────

  override async send(method: string, params: Array<unknown>): Promise<unknown> {
    const errors: { url: string; message: string }[] = [];

    for (const url of this._urls) {
      const circuit = this._getCircuit(url);

      // Lazy OPEN → HALF-OPEN transition
      if (circuit.state === 'open') {
        const elapsed = Date.now() - (circuit.openedAt ?? 0);
        if (elapsed >= this._config.recoveryTimeoutMs) {
          circuit.state = 'half-open';
          circuit.halfOpenSuccesses = 0;
        } else {
          errors.push({ url, message: new RpcProviderCircuitOpenError(url).message });
          continue;
        }
      }

      try {
        const result = await this._callWithTimeout(url, method, params);
        this._recordSuccess(url);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Only transport-level problems indicate an unhealthy endpoint. A
        // legitimate JSON-RPC failure (revert, insufficient funds, invalid
        // params) means the node answered correctly, so counting it towards
        // the failure threshold would evict a perfectly healthy URL.
        if (isTransportFailure(err)) {
          this._recordFailure(url);
        } else {
          this._recordSuccess(url);
        }

        errors.push({ url, message });

        logger.warn(
          `[ResilientJsonRpcProvider] chain=${this._chainId} url=${url} failed: ${message}`
        );
      }
    }

    throw new AllRpcProvidersFailedError(this._chainId, errors);
  }

  // ── Circuit-breaker helpers ───────────────────────────────────────────────

  private _getCircuit(url: string): CircuitEntry {
    if (!this._circuits.has(url)) {
      this._circuits.set(url, {
        state: 'closed',
        consecutiveFailures: 0,
        openedAt: null,
        halfOpenSuccesses: 0,
      });
    }
    return this._circuits.get(url)!;
  }

  private _recordSuccess(url: string): void {
    const c = this._getCircuit(url);
    c.consecutiveFailures = 0;
    c.openedAt = null;

    if (c.state === 'half-open') {
      c.halfOpenSuccesses += 1;
      // Require consecutive successes before trusting a recovered endpoint
      // again, so a node that flaps does not ping-pong the circuit.
      if (c.halfOpenSuccesses >= this._config.successThreshold) {
        c.state = 'closed';
        c.halfOpenSuccesses = 0;
      }
      return;
    }

    c.state = 'closed';
    c.halfOpenSuccesses = 0;
  }

  private _recordFailure(url: string): void {
    const c = this._getCircuit(url);
    c.consecutiveFailures += 1;
    c.halfOpenSuccesses = 0;

    if (c.state === 'half-open') {
      // Failed probe — reopen
      c.state = 'open';
      c.openedAt = Date.now();
    } else if (c.consecutiveFailures >= this._config.failureThreshold) {
      c.state = 'open';
      c.openedAt = Date.now();
      logger.warn(
        `[ResilientJsonRpcProvider] Circuit OPENED for ${url} (chain ${this._chainId}) ` +
          `after ${c.consecutiveFailures} consecutive failures`
      );
    }
  }

  // ── Timeout implementation ────────────────────────────────────────────────

  private async _callWithTimeout(
    url: string,
    method: string,
    params: Array<unknown>
  ): Promise<unknown> {
    const jitter = Math.floor(Math.random() * this._config.jitterMs);
    const deadline = this._config.timeoutMs + jitter;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadline);

    // Serialise access to the shared `connection.url`. Each caller waits for
    // the previous swap-and-restore to complete before touching it.
    const run = this._swapChain.then(
      () => this._sendToUrl(url, method, params, controller.signal, deadline),
      () => this._sendToUrl(url, method, params, controller.signal, deadline)
    );

    this._swapChain = run.then(
      () => undefined,
      () => undefined
    );

    try {
      return await run;
    } finally {
      clearTimeout(timer);
    }
  }

  private async _sendToUrl(
    url: string,
    method: string,
    params: Array<unknown>,
    signal: AbortSignal,
    deadline: number
  ): Promise<unknown> {
    // The deadline starts when the caller enqueued, so a call that waited
    // behind another may already be expired. The abort event has already
    // fired in that case, so fail fast instead of waiting unbounded.
    if (signal.aborted) {
      throw new RpcProviderTimeoutError(url, deadline);
    }

    // We need to temporarily swap the underlying connection URL so the base
    // JsonRpcProvider sends to the right endpoint.
    const previousUrl = this.connection.url;
    (this as unknown as { connection: { url: string } }).connection.url = url;

    try {
      const callPromise = super.send(method, params);

      // Race the call against an abort-signal-aware timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(new RpcProviderTimeoutError(url, deadline));
          },
          { once: true }
        );
      });

      return await Promise.race([callPromise, timeoutPromise]);
    } finally {
      // Restore URL in case of future calls to this same provider instance
      (this as unknown as { connection: { url: string } }).connection.url = previousUrl;
    }
  }

  // ── Health / diagnostics ──────────────────────────────────────────────────

  /** Returns per-URL circuit state for monitoring. */
  getCircuitStates(): Record<string, { state: CircuitState; consecutiveFailures: number }> {
    const out: Record<string, { state: CircuitState; consecutiveFailures: number }> = {};
    for (const [url, entry] of this._circuits) {
      out[url] = { state: entry.state, consecutiveFailures: entry.consecutiveFailures };
    }
    return out;
  }

  /** Manually reset all circuits (operator use, e.g. after confirmed recovery). */
  resetAllCircuits(): void {
    for (const entry of this._circuits.values()) {
      entry.state = 'closed';
      entry.consecutiveFailures = 0;
      entry.openedAt = null;
      entry.halfOpenSuccesses = 0;
    }
    logger.info(`[ResilientJsonRpcProvider] All circuits reset for chain ${this._chainId}`);
  }
}

/**
 * True when an error indicates the endpoint itself is unreachable rather than
 * the request being rejected by a working node.
 *
 * This is what separates "this RPC URL is down" from "this transaction
 * reverted", and it is the difference between a circuit breaker that protects
 * the user and one that ejects healthy nodes during an incident.
 */
export function isTransportFailure(error: unknown): boolean {
  if (error instanceof RpcProviderTimeoutError) return true;
  if (error instanceof RpcProviderCircuitOpenError) return false;

  if (!error || typeof error !== 'object') return false;

  const err = error as {
    code?: unknown;
    error?: { code?: unknown };
    message?: unknown;
    reason?: unknown;
  };

  // ethers wraps server responses in `error.code` as a numeric JSON-RPC code.
  // Anything that reaches here with one of those is an application-level
  // answer from a live node.
  const codes = [err.code, err.error?.code];
  if (codes.some((code) => typeof code === 'number' || /^-?\d+$/.test(String(code)))) {
    return false;
  }

  const transportCodes = [
    'TIMEOUT',
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
    'ERR_NETWORK',
    'NETWORK_ERROR',
  ];
  if (codes.some((code) => typeof code === 'string' && transportCodes.includes(code))) {
    return true;
  }

  const text = [err.message, err.reason]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();

  return (
    text.includes('failed to fetch') ||
    text.includes('network error') ||
    text.includes('fetch failed') ||
    text.includes('econnrefused') ||
    text.includes('econnreset') ||
    text.includes('socket hang up') ||
    text.includes('getaddrinfo')
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton registry — circuit state persists across calls in the same session
// ─────────────────────────────────────────────────────────────────────────────

const _providerRegistry = new Map<string, ResilientJsonRpcProvider>();

/**
 * Returns a shared ResilientJsonRpcProvider for the given chain+URLs.
 * Re-using the same instance means the circuit breaker accumulates
 * meaningful failure data across multiple calls.
 */
export function getOrCreateResilientProvider(
  chainId: number,
  urls: string[],
  config?: ResilientProviderConfig
): ResilientJsonRpcProvider {
  const key = `${chainId}::${[...urls].sort().join(',')}`;
  if (!_providerRegistry.has(key)) {
    _providerRegistry.set(key, new ResilientJsonRpcProvider(urls, chainId, config));
  }
  return _providerRegistry.get(key)!;
}

/** Clear registry (testing / process teardown). */
export function clearResilientProviderRegistry(): void {
  _providerRegistry.clear();
}
