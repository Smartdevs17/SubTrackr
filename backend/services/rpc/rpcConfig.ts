/**
 * RPC Endpoint & Circuit Breaker Configuration — Issue #RPC-CB
 *
 * Provides typed configuration for:
 *   - Timeout per RPC endpoint (ms)
 *   - Circuit breaker parameters (failure threshold, recovery timeout, half-open max requests)
 *   - Provider fallback ordering per chain
 *   - Graceful degradation behaviour
 */

// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before the circuit opens. Default: 5 */
  failureThreshold: number;
  /** Milliseconds to wait before transitioning from OPEN to HALF_OPEN. Default: 30_000 */
  recoveryTimeoutMs: number;
  /** Max requests allowed in HALF_OPEN state to probe the endpoint. Default: 3 */
  halfOpenMaxRequests: number;
  /** If true, the circuit automatically resets after recoveryTimeoutMs. Default: true */
  autoReset: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-endpoint configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface RpcEndpointConfig {
  /** Chain ID this endpoint serves (1 = Ethereum Mainnet, 137 = Polygon, etc.). */
  chainId: number;
  /** Human-readable label (e.g. 'Cloudflare Ethereum Public RPC'). */
  label: string;
  /** The RPC URL (https or wss). */
  url: string;
  /** Optional WebSocket URL for subscriptions (falls back to url if omitted). */
  wsUrl?: string;
  /** Request timeout in milliseconds. Default: 10_000 */
  timeoutMs: number;
  /** Optional custom headers to attach to every RPC request. */
  headers?: Record<string, string>;
  /** Circuit breaker settings for this endpoint. */
  circuitBreaker: CircuitBreakerConfig;
  /** Whether this endpoint supports read-only calls. Default: true */
  supportsRead: boolean;
  /** Whether this endpoint supports write (transaction submission). Default: true */
  supportsWrite: boolean;
  /** Max requests per second (soft rate-limit). 0 = unlimited. Default: 0 */
  maxRps: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain-level configuration (groups endpoints for a chain)
// ─────────────────────────────────────────────────────────────────────────────

export interface RpcChainConfig {
  /** Chain ID. */
  chainId: number;
  /** Human-readable chain name (e.g. 'Ethereum', 'Polygon'). */
  chainName: string;
  /** Ordered list of RPC endpoint configurations. First is primary, rest are fallbacks. */
  endpoints: RpcEndpointConfig[];
  /**
   * Behaviour when circuit is open and no fallback responds:
   *   - 'fail_fast'   — throw instantly (default)
   *   - 'cache_stale' — return last successful cached response (if available)
   *   - 'degraded'    — return a minimal degraded response
   */
  onCircuitOpen: 'fail_fast' | 'cache_stale' | 'degraded';
  /**
   * Behaviour when all providers have been exhausted:
   *   - 'fail_fast'  — throw instantly (default)
   *   - 'cache_stale' — return last successful cached response
   */
  onAllFailed: 'fail_fast' | 'cache_stale';
}

// ─────────────────────────────────────────────────────────────────────────────
// Global RPC configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface RpcGlobalConfig {
  /** Global default timeout applied to any endpoint without an explicit timeoutMs. */
  defaultTimeoutMs: number;
  /** Global default circuit breaker config applied when not specified per-endpoint. */
  defaultCircuitBreaker: CircuitBreakerConfig;
  /** Whether to enable circuit breaker logging. Default: true */
  enableLogging: boolean;
  /** Whether to emit metrics for Prometheus collection. Default: true */
  enableMetrics: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeoutMs: 30_000,
  halfOpenMaxRequests: 3,
  autoReset: true,
};

export const DEFAULT_RPC_GLOBAL_CONFIG: RpcGlobalConfig = {
  defaultTimeoutMs: 10_000,
  defaultCircuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG },
  enableLogging: true,
  enableMetrics: true,
};

export const DEFAULT_ENDPOINT_TIMEOUT_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// EVM chain defaults (mirrors src/config/evm.ts with fallback providers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Built-in RPC endpoint configs with primary + fallback providers per chain.
 * These mirror the existing EVM_RPC_URLS in src/config/evm.ts but add
 * fallback providers and timeout/circuit-breaker settings.
 */
export const DEFAULT_CHAIN_ENDPOINTS: Record<number, RpcChainConfig> = {
  1: {
    chainId: 1,
    chainName: 'Ethereum Mainnet',
    endpoints: [
      {
        chainId: 1,
        label: 'Cloudflare Ethereum Gateway',
        url: 'https://cloudflare-eth.com',
        timeoutMs: 10_000,
        circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG },
        supportsRead: true,
        supportsWrite: false,
        maxRps: 100,
      },
      {
        chainId: 1,
        label: 'Ethereum Foundation (eth-mainnet)',
        url: 'https://mainnet.infura.io/v3/${INFURA_PROJECT_ID}',
        timeoutMs: 10_000,
        circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 15_000, halfOpenMaxRequests: 2, autoReset: true },
        supportsRead: true,
        supportsWrite: true,
        maxRps: 200,
      },
      {
        chainId: 1,
        label: 'Alchemy Ethereum (eth-mainnet)',
        url: 'https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}',
        timeoutMs: 10_000,
        circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 15_000, halfOpenMaxRequests: 2, autoReset: true },
        supportsRead: true,
        supportsWrite: true,
        maxRps: 200,
      },
    ],
    onCircuitOpen: 'cache_stale',
    onAllFailed: 'cache_stale',
  },
  137: {
    chainId: 137,
    chainName: 'Polygon Mainnet',
    endpoints: [
      {
        chainId: 137,
        label: 'Polygon Public RPC',
        url: 'https://polygon-rpc.com',
        timeoutMs: 15_000,
        circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG },
        supportsRead: true,
        supportsWrite: false,
        maxRps: 50,
      },
      {
        chainId: 137,
        label: 'Polygon Infura',
        url: 'https://polygon-mainnet.infura.io/v3/${INFURA_PROJECT_ID}',
        timeoutMs: 10_000,
        circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 15_000, halfOpenMaxRequests: 2, autoReset: true },
        supportsRead: true,
        supportsWrite: true,
        maxRps: 200,
      },
    ],
    onCircuitOpen: 'fail_fast',
    onAllFailed: 'cache_stale',
  },
  42161: {
    chainId: 42161,
    chainName: 'Arbitrum One',
    endpoints: [
      {
        chainId: 42161,
        label: 'Arbitrum Public RPC',
        url: 'https://arb1.arbitrum.io/rpc',
        timeoutMs: 15_000,
        circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG },
        supportsRead: true,
        supportsWrite: false,
        maxRps: 50,
      },
      {
        chainId: 42161,
        label: 'Arbitrum Infura',
        url: 'https://arbitrum-mainnet.infura.io/v3/${INFURA_PROJECT_ID}',
        timeoutMs: 10_000,
        circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 15_000, halfOpenMaxRequests: 2, autoReset: true },
        supportsRead: true,
        supportsWrite: true,
        maxRps: 200,
      },
    ],
    onCircuitOpen: 'fail_fast',
    onAllFailed: 'cache_stale',
  },
  10: {
    chainId: 10,
    chainName: 'Optimism',
    endpoints: [
      {
        chainId: 10,
        label: 'Optimism Public RPC',
        url: 'https://mainnet.optimism.io',
        timeoutMs: 15_000,
        circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG },
        supportsRead: true,
        supportsWrite: false,
        maxRps: 50,
      },
      {
        chainId: 10,
        label: 'Optimism Infura',
        url: 'https://optimism-mainnet.infura.io/v3/${INFURA_PROJECT_ID}',
        timeoutMs: 10_000,
        circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 15_000, halfOpenMaxRequests: 2, autoReset: true },
        supportsRead: true,
        supportsWrite: true,
        maxRps: 200,
      },
    ],
    onCircuitOpen: 'fail_fast',
    onAllFailed: 'cache_stale',
  },
  8453: {
    chainId: 8453,
    chainName: 'Base',
    endpoints: [
      {
        chainId: 8453,
        label: 'Base Public RPC',
        url: 'https://mainnet.base.org',
        timeoutMs: 15_000,
        circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG },
        supportsRead: true,
        supportsWrite: false,
        maxRps: 50,
      },
    ],
    onCircuitOpen: 'fail_fast',
    onAllFailed: 'cache_stale',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Stellar (Soroban) defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_STELLAR_CHAIN_CONFIG: RpcChainConfig = {
  chainId: 0x8000, // Stellar chain ID convention
  chainName: 'Stellar (Soroban)',
  endpoints: [
    {
      chainId: 0x8000,
      label: 'Stellar Soroban RPC',
      url: 'https://soroban-rpc.stellar.org',
      timeoutMs: 15_000,
      circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG },
      supportsRead: true,
      supportsWrite: true,
      maxRps: 100,
    },
    {
      chainId: 0x8000,
      label: 'Stellar Soroban Testnet',
      url: 'https://soroban-testnet.stellar.org',
      timeoutMs: 15_000,
      circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 15_000, halfOpenMaxRequests: 2, autoReset: true },
      supportsRead: true,
      supportsWrite: true,
      maxRps: 100,
    },
  ],
  onCircuitOpen: 'cache_stale',
  onAllFailed: 'cache_stale',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: resolve an endpoint URL with env var placeholders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replaces ${ENV_VAR_NAME} placeholders in a URL string with actual environment
 * variable values. Unknown variables are replaced with an empty string.
 */
export function resolveEndpointUrl(url: string): string {
  return url.replace(/\$\{(\w+)\}/g, (_match, varName) => {
    return process.env[varName] ?? '';
  });
}
