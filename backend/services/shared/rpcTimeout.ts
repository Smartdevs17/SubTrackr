/**
 * rpcTimeout.ts — Issue #912
 *
 * Production-grade timeout primitives for external blockchain RPC calls.
 *
 * Features:
 *   - AbortController-based cancellation (no leaked Promises)
 *   - Optional ±jitter to prevent thundering-herd on recovery
 *   - Composable: wraps any Promise or async function
 *   - Type-safe RpcTimeoutError carries metadata for metrics
 *   - Cancellation-safe: external AbortSignal is respected
 */

// ─────────────────────────────────────────────────────────────────────────────
// Error types
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when a timed RPC call exceeds its deadline. */
export class RpcCallTimeoutError extends Error {
  /** The RPC endpoint URL (if known). */
  readonly endpointUrl: string | null;
  /** The timeout that was applied (ms). */
  readonly timeoutMs: number;
  /** Elapsed time at the point of cancellation (ms). */
  readonly elapsedMs: number;
  readonly code = 'RPC_CALL_TIMEOUT' as const;

  constructor(opts: {
    timeoutMs: number;
    elapsedMs: number;
    endpointUrl?: string;
    cause?: unknown;
  }) {
    const url = opts.endpointUrl ? ` (${opts.endpointUrl})` : '';
    super(`RPC call${url} timed out after ${opts.timeoutMs} ms`);
    this.name = 'RpcCallTimeoutError';
    this.timeoutMs = opts.timeoutMs;
    this.elapsedMs = opts.elapsedMs;
    this.endpointUrl = opts.endpointUrl ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when an in-flight call is cancelled via an external AbortSignal. */
export class RpcCallCancelledError extends Error {
  readonly code = 'RPC_CALL_CANCELLED' as const;

  constructor(message = 'RPC call was cancelled by the caller') {
    super(message);
    this.name = 'RpcCallCancelledError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface RpcTimeoutOptions {
  /**
   * Maximum time (ms) to wait before aborting. Required.
   * Typical values: 5_000 (Ethereum mainnet), 15_000 (Polygon/Arbitrum).
   */
  timeoutMs: number;
  /**
   * Optional random jitter added to the timeout (ms).
   * Actual deadline = timeoutMs + random(0, jitterMs).
   * Helps prevent multiple callers retrying at exactly the same instant.
   * Default: 0
   */
  jitterMs?: number;
  /**
   * URL of the endpoint being called. Included in error metadata.
   */
  endpointUrl?: string;
  /**
   * External AbortSignal. If already aborted, the call is rejected immediately.
   * If aborted during the call, a RpcCallCancelledError is thrown.
   */
  signal?: AbortSignal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: withRpcTimeout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes `factory(signal)` with a deadline.
 *
 * The `factory` receives a merged AbortSignal that fires on either
 * the timeout or the optional external signal. No cleanup is needed
 * in the caller: the internal controller is always cleaned up.
 *
 * @example
 * const block = await withRpcTimeout(
 *   (sig) => provider.getBlock('latest', sig),
 *   { timeoutMs: 5_000, endpointUrl: 'https://cloudflare-eth.com' }
 * );
 */
export async function withRpcTimeout<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  opts: RpcTimeoutOptions,
): Promise<T> {
  const { timeoutMs, jitterMs = 0, endpointUrl, signal: externalSignal } = opts;

  // Reject immediately if the caller already cancelled
  if (externalSignal?.aborted) {
    throw new RpcCallCancelledError();
  }

  const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  const deadline = timeoutMs + jitter;

  const internalController = new AbortController();
  const startMs = Date.now();

  // Merge external signal: if caller aborts, we abort the internal controller too
  let externalAbortListener: (() => void) | null = null;
  if (externalSignal) {
    externalAbortListener = () => internalController.abort();
    externalSignal.addEventListener('abort', externalAbortListener, { once: true });
  }

  const timer = setTimeout(() => internalController.abort(), deadline);

  try {
    const result = await factory(internalController.signal);
    return result;
  } catch (err) {
    // Distinguish timeout from external cancellation
    if (internalController.signal.aborted) {
      const elapsedMs = Date.now() - startMs;

      if (externalSignal?.aborted) {
        throw new RpcCallCancelledError();
      }

      throw new RpcCallTimeoutError({ timeoutMs: deadline, elapsedMs, endpointUrl, cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal && externalAbortListener) {
      externalSignal.removeEventListener('abort', externalAbortListener);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: wrapWithTimeout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps an existing Promise (not signal-aware) with a timeout.
 *
 * The underlying Promise cannot be cancelled — prefer `withRpcTimeout` when
 * you control the factory. Use this for third-party calls that don't accept
 * an AbortSignal.
 *
 * @example
 * const balance = await wrapWithTimeout(
 *   provider.getBalance(address),
 *   { timeoutMs: 5_000, endpointUrl: url }
 * );
 */
export function wrapWithTimeout<T>(
  promise: Promise<T>,
  opts: Omit<RpcTimeoutOptions, 'signal'>,
): Promise<T> {
  const { timeoutMs, jitterMs = 0, endpointUrl } = opts;
  const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  const deadline = timeoutMs + jitter;
  const startMs = Date.now();

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutRace = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const elapsedMs = Date.now() - startMs;
      reject(new RpcCallTimeoutError({ timeoutMs: deadline, elapsedMs, endpointUrl }));
    }, deadline);
  });

  return Promise.race([promise, timeoutRace]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true iff `err` is a timeout thrown by this module. */
export function isRpcTimeout(err: unknown): err is RpcCallTimeoutError {
  return err instanceof RpcCallTimeoutError;
}

/** Returns true iff `err` is a cancellation thrown by this module. */
export function isRpcCancelled(err: unknown): err is RpcCallCancelledError {
  return err instanceof RpcCallCancelledError;
}

/**
 * Returns a sensible default timeout for a given EVM chainId.
 * Slower chains (Polygon, Arbitrum) get longer deadlines.
 */
export function defaultTimeoutForChain(chainId: number): number {
  switch (chainId) {
    case 1:     return 10_000;  // Ethereum mainnet
    case 137:   return 15_000;  // Polygon (higher variance)
    case 42161: return 15_000;  // Arbitrum
    case 10:    return 15_000;  // Optimism
    case 8453:  return 15_000;  // Base
    default:    return 10_000;
  }
}
