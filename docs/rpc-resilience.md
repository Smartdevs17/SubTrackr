# RPC Resilience: Timeout & Circuit Breaker

Issue #941 — Production-ready timeout and circuit breaker protection for all external blockchain RPC calls in SubTrackr.

---

## Problem

Without this feature, any slow or down RPC endpoint (Ethereum, Polygon, Arbitrum, …) causes:

- **Indefinite hangs** — `provider.getBalance()` never rejects; the caller waits forever.
- **Cascading failures** — a single bad node blocks all dependent operations (gas estimation, balance checks, transaction submission).
- **No fallback** — a single RPC URL is hard-coded; there is no secondary provider.

---

## Solution

Three layers of protection wrap every RPC call:

```
walletService.getProvider(chainId)
    │
    └─► ResilientJsonRpcProvider  [src/services/rpcProvider.ts]
          ├─ Ordered URL list (primary + fallbacks from EVM_RPC_URLS)
          ├─ Per-URL circuit breaker  (closed → open → half-open → closed)
          └─ Per-call AbortController deadline (timeout + optional jitter)
                │
                └─► RpcCircuitBreakerService  [backend/services/rpcCircuitBreaker.ts]
                      ├─ Full state machine + audit log
                      ├─ Dashboard / monitoring
                      └─ Manual circuit reset
```

### Files

| File | Layer | Purpose |
|------|-------|---------|
| `backend/services/shared/rpcTimeout.ts` | Shared | `withRpcTimeout`, `wrapWithTimeout`, typed errors |
| `backend/services/shared/rpcResilienceMiddleware.ts` | Backend | `ResilientEthersProvider` factory + registry |
| `src/services/rpcProvider.ts` | Frontend | `ResilientJsonRpcProvider` — used by `walletService.ts` |
| `backend/services/rpcCircuitBreaker.ts` | Backend | Full `RpcCircuitBreakerService` with audit log |
| `backend/services/rpc/circuitBreaker.ts` | Backend | `CircuitBreaker` (EventEmitter, cumulative downtime) |
| `backend/services/rpc/rpcConfig.ts` | Config | Typed config + `DEFAULT_CHAIN_ENDPOINTS` |
| `backend/services/rpc/rpcProviderFallback.ts` | Backend | HTTP-level RPC fallback |
| `backend/services/rpc/rpcMonitorService.ts` | Backend | Cross-chain monitoring dashboard |
| `backend/services/shared/MonitoringJsonRpcProvider.ts` | Shared | ethers provider with circuit breaker + metrics |

---

## Circuit Breaker States

```
              ┌─────────────────────────────────┐
              │  N consecutive failures          │
  CLOSED ─────────────────────────────────► OPEN
     ▲         (failureThreshold = 5)           │
     │                                           │ recoveryTimeoutMs (30 s)
     │ probe succeeds                            ▼
     └──────────────────────────────── HALF-OPEN
                                          │
                                          │ probe fails → back to OPEN
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `failureThreshold` | 5 | Consecutive failures before circuit opens |
| `recoveryTimeoutMs` | 30 000 ms | How long OPEN before allowing a probe |
| `successThreshold` | 2 | Consecutive successes in HALF-OPEN to close |
| `defaultTimeoutMs` | chain-dependent | Per-call timeout |

---

## Timeout System

### `withRpcTimeout` — signal-aware

```typescript
import { withRpcTimeout } from 'backend/services/shared/rpcTimeout';

const balance = await withRpcTimeout(
  (signal) => fetch(url, { signal }).then(r => r.json()),
  { timeoutMs: 10_000, endpointUrl: url, jitterMs: 500 }
);
```

The factory receives an `AbortSignal`. If the deadline fires or an external signal aborts, the signal is triggered so the underlying fetch is cancelled — no leaked Promises.

### `wrapWithTimeout` — for third-party calls

```typescript
import { wrapWithTimeout } from 'backend/services/shared/rpcTimeout';

const gasPrice = await wrapWithTimeout(
  provider.getGasPrice(),
  { timeoutMs: 10_000 }
);
```

Uses `Promise.race`. The underlying Promise cannot be cancelled (use `withRpcTimeout` when possible).

### `defaultTimeoutForChain`

```typescript
import { defaultTimeoutForChain } from 'backend/services/shared/rpcTimeout';

defaultTimeoutForChain(1)     // 10_000 ms (Ethereum)
defaultTimeoutForChain(137)   // 15_000 ms (Polygon — higher variance)
defaultTimeoutForChain(42161) // 15_000 ms (Arbitrum)
```

---

## walletService Integration

`WalletServiceManager.getProvider()` now creates a resilient provider:

```typescript
// Before (#941)
private getProvider(chainId: number) {
  return new ethers.providers.JsonRpcProvider(getEvmRpcUrl(chainId));
}

// After (#941)
private getProvider(chainId: number) {
  const urls = getEvmRpcUrls(chainId); // ['https://primary', 'https://fallback']
  return getOrCreateResilientProvider(chainId, urls);
}
```

`getOrCreateResilientProvider` returns a singleton per chain, so circuit-breaker state accumulates meaningfully across all calls in a session.

---

## Backend API

### RpcCircuitBreakerService

```typescript
import { RpcCircuitBreakerService } from 'backend/services/rpcCircuitBreaker';

const svc = new RpcCircuitBreakerService(
  [
    { id: 'cloudflare', label: 'Cloudflare ETH', url: 'https://cloudflare-eth.com', priority: 0 },
    { id: 'infura',     label: 'Infura ETH',     url: 'https://mainnet.infura.io/v3/...', priority: 1 },
  ],
  { failureThreshold: 5, recoveryTimeoutMs: 30_000, defaultTimeoutMs: 10_000 }
);

// Execute against best available provider
const blockNumber = await svc.call(async (url, signal) => {
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc:'2.0', method:'eth_blockNumber', params:[], id:1 }),
    signal,
  });
  return res.json();
});

// Manual operator reset
svc.resetCircuit('cloudflare');
svc.resetAllCircuits();

// Monitoring
const dash = svc.getDashboard();
// { totalProviders, closedCount, openCount, halfOpenCount, overallSuccessRate, providers[], recentEvents[] }

const status = svc.getCircuitStatus('cloudflare');
// { state, consecutiveFailures, totalCalls, successRate, avgLatencyMs, … }
```

### ResilientEthersProvider (backend, drop-in for MonitoringJsonRpcProvider)

```typescript
import { createResilientProvider, getOrCreateResilientProvider } from 'backend/services/shared';

const provider = getOrCreateResilientProvider(1, [
  'https://cloudflare-eth.com',
  'https://mainnet.infura.io/v3/...',
]);

const balance = await provider.getBalance('0x...');  // protected
const health  = provider.getHealth();                // ProviderHealthSnapshot
provider.resetCircuits();                            // operator reset
```

---

## Error Types

| Error | Module | When thrown |
|-------|--------|-------------|
| `RpcCallTimeoutError` | `rpcTimeout.ts` | Deadline exceeded in `withRpcTimeout` / `wrapWithTimeout` |
| `RpcCallCancelledError` | `rpcTimeout.ts` | External `AbortSignal` fired |
| `RpcTimeoutError` | `rpcCircuitBreaker.ts` | Provider-level timeout in `RpcCircuitBreakerService` |
| `RpcCircuitOpenError` | `rpcCircuitBreaker.ts` | Provider circuit is OPEN |
| `RpcAllProvidersFailedError` | `rpcCircuitBreaker.ts` | Every provider failed or has open circuit |
| `RpcProviderTimeoutError` | `rpcProvider.ts` (src) | Per-URL deadline in `ResilientJsonRpcProvider` |
| `AllRpcProvidersFailedError` | `rpcProvider.ts` (src) | All URLs failed in client-side provider |

All errors carry typed `.code` fields for structured error handling:

```typescript
import { isRpcTimeout, isRpcCancelled } from 'backend/services/shared/rpcTimeout';

try {
  const balance = await withRpcTimeout(fn, { timeoutMs: 10_000 });
} catch (err) {
  if (isRpcTimeout(err)) {
    // err.timeoutMs, err.elapsedMs, err.endpointUrl
    metrics.increment('rpc.timeout');
  } else if (isRpcCancelled(err)) {
    // caller cancelled — not an error
  } else {
    throw err;
  }
}
```

---

## Configuration Reference

### Per-chain timeout defaults

| Chain | chainId | defaultTimeoutMs |
|-------|---------|-----------------|
| Ethereum | 1 | 10 000 ms |
| Polygon | 137 | 15 000 ms |
| Arbitrum | 42161 | 15 000 ms |
| Optimism | 10 | 15 000 ms |
| Base | 8453 | 15 000 ms |

### EVM_RPC_URLS (src/config/evm.ts)

Multiple fallback URLs are configured per chain:

```typescript
EVM_RPC_URLS = {
  1:     ['https://cloudflare-eth.com', 'https://rpc.ankr.com/eth', 'https://eth.llamarpc.com'],
  137:   ['https://polygon-rpc.com', 'https://rpc.ankr.com/polygon'],
  42161: ['https://arb1.arbitrum.io/rpc', 'https://rpc.ankr.com/arbitrum'],
  10:    ['https://mainnet.optimism.io', 'https://rpc.ankr.com/optimism'],
  8453:  ['https://mainnet.base.org', 'https://developer-access-mainnet.base.org'],
}
```

---

## Tests

```bash
# Unit tests
npx jest --testPathPattern="rpcTimeout|rpcResilienceMiddleware"

# Integration tests
npx jest --testPathPattern="walletServiceRpc.integration"

# Performance benchmarks
npx jest --testPathPattern="rpcBenchmark"

# Or run the benchmark CLI directly
npx ts-node backend/benchmark/rpcBenchmark.ts
```

### Performance budgets

| Metric | Budget |
|--------|--------|
| `withRpcTimeout` overhead over baseline (avg) | < 1 ms |
| `wrapWithTimeout` overhead over baseline (avg) | < 1 ms |
| Circuit breaker closed-path (avg) | < 1 ms |
| p95 for all in-process operations | < 2 ms |
| `defaultTimeoutForChain` throughput | > 100 000 ops/s |

---

## Acceptance Criteria (Issue #941)

- [x] Feature implemented with full functionality — `rpcTimeout.ts`, `rpcResilienceMiddleware.ts`, `rpcProvider.ts`, `walletService.ts` integrated
- [x] Unit tests >80% coverage — `rpcTimeout.test.ts`, `rpcResilienceMiddleware.test.ts`
- [x] Integration tests for critical paths — `walletServiceRpc.integration.test.ts` (7 test suites: timeout, circuit breaker, fallback, per-URL circuit, registry, manual reset, audit trail)
- [x] No regression — `walletService.ts` API unchanged; `ResilientJsonRpcProvider` is a drop-in for `JsonRpcProvider`
- [x] Documentation updated — this file
- [x] Performance benchmarks — `backend/benchmark/rpcBenchmark.ts` with budget gating
