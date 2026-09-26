/**
 * RPC Circuit Breaker & Timeout Module — Issue #RPC-CB
 *
 * Provides configurable timeout, circuit breaker, and provider fallback
 * for external blockchain RPC calls.
 */

// ── Configuration ────────────────────────────────────────────────────────────

export {
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_RPC_GLOBAL_CONFIG,
  DEFAULT_CHAIN_ENDPOINTS,
  DEFAULT_STELLAR_CHAIN_CONFIG,
  DEFAULT_ENDPOINT_TIMEOUT_MS,
  resolveEndpointUrl,
} from './rpcConfig';

export type {
  CircuitBreakerConfig,
  RpcEndpointConfig,
  RpcChainConfig,
  RpcGlobalConfig,
} from './rpcConfig';

// ── Circuit Breaker ──────────────────────────────────────────────────────────

export {
  CircuitBreaker,
  CircuitOpenError,
  RpcTimeoutError,
  AllProvidersFailedError,
} from './circuitBreaker';

export type {
  CircuitState,
  CircuitStateSnapshot,
  CircuitBreakerEvent,
} from './circuitBreaker';

// ── RPC Provider Fallback ────────────────────────────────────────────────────

export {
  RpcProviderFallback,
} from './rpcProviderFallback';

export type {
  RpcCallOptions,
  RpcCallResult,
} from './rpcProviderFallback';

// ── Monitor Service ──────────────────────────────────────────────────────────

export {
  RpcMonitorService,
  rpcMonitorService,
} from './rpcMonitorService';

export type {
  RpcMonitorMetrics,
  ChainHealthSummary,
  RpcMonitorDashboard,
  RpcDashboardQuery,
} from './rpcMonitorService';
