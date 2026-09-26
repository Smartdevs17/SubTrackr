# Payment Method Management & Fallback Chains

Issue #951 — Production-ready implementation of payment method CRUD, ordered fallback chains, expiry tracking, analytics, sharing and a full UI manager screen.

---

## Overview

SubTrackr lets a user register multiple on-chain payment methods and arrange them in a **fallback chain**: an ordered list of methods to try, one after another, until a charge succeeds. When the primary method runs out of gas or has an insufficient balance, the chain automatically falls through to the next entry without any manual intervention.

---

## Architecture

```
src/
├── types/
│   ├── wallet.ts              — Core types (PaymentMethod, FallbackChain, …)
│   └── paymentMethod.ts       — Re-exports + UI-layer types (ManagerTab, …)
│
├── services/
│   ├── paymentMethodService.ts  — Core service: CRUD, chain logic, analytics, sharing
│   ├── PaymentMethodManager.ts  — Circuit breaker + health scoring + rate limiting
│   └── FallbackChainEngine.ts   — Pluggable strategy engine (6 built-in strategies)
│
├── store/
│   └── walletStore.ts           — Zustand store: all payment-method state + actions
│
└── components/
    └── payment/
        └── PaymentMethodManager.tsx  — Full-screen UI: 4 tabs (Methods / Chains / Analytics / Alerts)
```

---

## Key Concepts

### PaymentMethod

A payment method represents one on-chain funding source a user has authorised.

| Field                 | Type              | Notes                                          |
|-----------------------|-------------------|------------------------------------------------|
| `id`                  | `string`          | Stable identifier (`pm_…`)                     |
| `userId`              | `string`          | Wallet address of the owner                    |
| `tokenType`           | `TokenType`       | `NATIVE`, `USDC`, `ETH`, `MATIC`, `ARB`, `XLM` |
| `tokenAddress`        | `string`          | ERC-20 contract address; `0x00…` for natives   |
| `chainId`             | `number`          | EVM chain (1, 137, 42161, …)                   |
| `label`               | `string`          | Human-readable name                            |
| `priority`            | `PaymentPriority` | `primary` → `backup` → `fallback`              |
| `maxSpendPerInterval` | `string`          | Per-cycle spend cap (wei / token units)        |
| `isVerified`          | `boolean`         | Confirmed against the on-chain contract        |
| `isActive`            | `boolean`         | `false` when expired or manually deactivated   |
| `expiresAt`           | `Date \| null`    | Set for time-limited methods                   |

### FallbackChain

A named, ordered sequence of payment method ids.

| Field               | Type             | Notes                                                              |
|---------------------|------------------|--------------------------------------------------------------------|
| `methodIds`         | `string[]`       | Tried in this order; max 5 entries (`MAX_CHAIN_LENGTH`)            |
| `subscriptionId`    | `string \| null` | Scoped to one subscription; `null` applies globally               |
| `maxAttempts`       | `number`         | Ceiling on methods tried; `0` = try the whole chain               |
| `stopOnHardDecline` | `boolean`        | Halt on expired/deactivated method instead of falling through     |

---

## Service Layer

### PaymentMethodService (`paymentMethodService.ts`)

The core service. Instantiated as a singleton via `PaymentMethodService.getInstance()`.

**Payment method management**
```ts
svc.generateId()                          // "pm_1717…_abc123"
svc.validatePaymentMethodForm(data)       // → { isValid, errors, warnings, … }
svc.canAddMethod(currentCount)            // → { canAdd, reason? }
svc.isDuplicateMethod(existing, …)        // boolean
svc.sortByPriority(methods)              // primary → backup → fallback, then LRU
svc.getActiveVerifiedMethods(methods)    // filter + sort
svc.checkExpiry(method)                  // → { isExpired, isExpiringSoon, daysUntilExpiry }
svc.getExpiredMethods(methods)
svc.getExpiringSoonMethods(methods)      // ≤ 30 days
svc.markPaymentMethodExpired(method)     // returns updated record
svc.detectTokenContractUpgrade(method, previousHash)
```

**Chain management**
```ts
svc.validateChain(chain, methods)           // → { isValid, errors, warnings }
svc.resolveChainMethods(chain, methods)     // active+verified only, maxAttempts cap
svc.buildDefaultChain(methods, name?)       // from priority ordering
svc.selectChainForSubscription(chains, id)  // subscription-specific → global → null
svc.processPaymentWithChain(chain, …)       // → ChainPaymentResult
svc.processPaymentWithFallback(methods, …)  // legacy priority-order fallback
```

**Analytics**
```ts
svc.computeAnalytics(methods, attempts)  // → PaymentMethodAnalytics
svc.buildExpiryAlerts(methods, chains)   // → PaymentMethodExpiryAlert[]
```

**Sharing**
```ts
svc.createShare(method, granteeId, role, options)  // → PaymentMethodShare
svc.isShareActive(share)                            // boolean
svc.canGranteeCharge(shares, methodId, granteeId, amount)
svc.getSharedMethods(methods, shares, granteeId)    // methods visible to grantee
```

### PaymentMethodManager (`PaymentMethodManager.ts`)

Wraps `PaymentMethodService` with production-grade resilience features.

- **Circuit breaker** — after 3 consecutive failures, a method's circuit opens and it is skipped for 60 seconds before a probe is allowed (half-open).
- **Health scoring** — 0-100 score per method based on recent success rate + priority bonus - circuit penalty.
- **Rate limiting** — max 10 attempts per method per 60-second rolling window.
- **Auto-routing** — methods are ordered by health score (best first) before each charge.

```ts
const mgr = new PaymentMethodManager(svc);

const result = await mgr.charge(methods, attempts, subscriptionId, amount, chainId);
// result.skippedDueToCircuit  — method ids skipped because their circuit was open
// result.skippedDueToRateLimit — method ids that hit the rate limit
// result.healthScores          — { [methodId]: 0-100 }

mgr.getCircuitState(methodId)   // 'closed' | 'open' | 'half-open'
mgr.resetCircuit(methodId)
mgr.tripCircuit(methodId)
mgr.isBlocked(methodId)
mgr.getSnapshot()               // full diagnostic snapshot
```

### FallbackChainEngine (`FallbackChainEngine.ts`)

Strategy-based ordering engine. Six built-in strategies:

| Strategy ID      | Description                                                    |
|------------------|----------------------------------------------------------------|
| `priority`       | Primary → Backup → Fallback, then LRU within tier (default)   |
| `weighted`       | Probabilistic selection weighted by historical success rate    |
| `sticky`         | Last-successful method for this subscription goes first        |
| `priority-burst` | All primaries, then all backups, then all fallbacks            |
| `geo-aware`      | Same-chainId methods before cross-chain methods                |
| `round-robin`    | Distribute load evenly across primaries by LRU                 |

```ts
const engine = new FallbackChainEngine(svc);

// Execute a charge using the sticky strategy
const result = await engine.execute('sticky', methods, attempts, {
  subscriptionId: 'sub_42',
  amount: '50',
  chainId: 1,
  maxGasPriceGwei: 500,
});

// Preview the ordering without executing
const preview = engine.preview('geo-aware', methods, attempts, ctx);
// preview.orderedMethods, preview.rationale

// Register a custom strategy
engine.registerStrategy(myCustomStrategy);
```

---

## Store (`walletStore.ts`)

All payment-method state lives in `useWalletStore`.

```ts
import { useWalletStore } from '../store/walletStore';

// Selectors
const methods  = useWalletStore(s => s.paymentMethods);
const chains   = useWalletStore(s => s.fallbackChains);
const isLoading = useWalletStore(s => s.isLoading);

// Payment methods
const { addPaymentMethod, removePaymentMethod, updatePaymentMethod } = useWalletStore.getState();
await addPaymentMethod({ tokenType, tokenAddress, chainId, label, priority, maxSpendPerInterval });
await removePaymentMethod(id);
await updatePaymentMethod(id, { label: 'New name' });
await verifyPaymentMethod(id);
await setPaymentMethodPriority(id, PaymentPriority.BACKUP);

// Payment processing
const result = await processPayment(subscriptionId, amount, chainId, maxGasPriceGwei);
const chainResult = await processPaymentWithChain(subscriptionId, amount, chainId);

// Fallback chains
const chain = createFallbackChain('My chain', [pm1Id, pm2Id], { subscriptionId: 'sub_1' });
updateFallbackChain(chain.id, { name: 'Renamed' });
reorderFallbackChain(chain.id, [pm2Id, pm1Id]);
deleteFallbackChain(chain.id);
const validation = validateFallbackChain(chain.id);

// Expiry
const { expired, expiringSoon } = getExpiryInfo();
const alerts = expiryAlerts();               // PaymentMethodExpiryAlert[]
const deactivated = deactivateExpiredMethods(); // returns count

// Analytics
const analytics = paymentAnalytics();         // PaymentMethodAnalytics

// Sharing
sharePaymentMethod(methodId, granteeId, 'charger', { spendLimit: '100' });
revokePaymentMethodShare(shareId);
const myShares  = sharesForMethod(methodId);
const sharedWithMe = methodsSharedWith(granteeId);

// Upgrade detection
const upgraded = await checkTokenContractUpgrade(methodId);
```

Persisted fields (via AsyncStorage): `paymentMethods`, `paymentAttempts`, `fallbackChains`, `paymentMethodShares`. Connection and streams are ephemeral and are **not** persisted.

---

## UI Component (`components/payment/PaymentMethodManager.tsx`)

Drop-in full-screen manager with four tabs:

| Tab          | Content                                                            |
|--------------|--------------------------------------------------------------------|
| **Methods**  | List with priority badges + quick-select; add / edit / remove / verify |
| **Chains**   | Create ordered fallback chains; delete; view resolved order        |
| **Analytics**| Overview stats + per-method success rates + failure reason counts  |
| **Alerts**   | Expiry warnings with severity (warning / critical / expired); bulk deactivate |

```tsx
import { PaymentMethodManager } from '../components/payment/PaymentMethodManager';

// As a full screen:
<PaymentMethodManager initialTab="chains" onClose={() => navigation.goBack()} />
```

All actions delegate to `useWalletStore`. The component has no business logic of its own.

Accessibility: every interactive element carries `accessibilityRole`, `accessibilityLabel` and `accessibilityState` props. Alerts use `accessibilityRole="alert"`.

---

## Fallback Chain Execution Flow

```
processPaymentWithChain(chain, methods, …)
│
├── resolveChainMethods()     — filter active + verified + unexpired, apply maxAttempts
│
└── for each method in order:
    ├── checkExpiry()          → fail with hard-decline (halt if stopOnHardDecline)
    ├── validateGasPrice()     → fail if gas exceeds maxGasPriceGwei
    ├── checkBalance()         → fail if insufficient balance
    ├── compare maxSpendPerInterval → fail if amount exceeds cap
    └── SUCCESS → return { success, attempt, fallbackAttempts, succeededAtPosition }
```

If the whole chain is exhausted without success, `{ success: false, attempt: null, succeededAtPosition: -1 }` is returned (no exception thrown at this layer).

---

## Tests

```bash
# Run all payment-related tests
npm test -- --testPathPattern="paymentMethodService|walletStore|paymentFallbackChain"

# With coverage
npm run test:coverage -- --testPathPattern="paymentMethod|walletStore|fallbackChain"
```

Test files:

| File | Type | Coverage |
|------|------|---------|
| `src/services/__tests__/paymentMethodService.test.ts` | Unit | `PaymentMethodService` — all public methods |
| `src/store/__tests__/walletStore.test.ts` | Unit | `useWalletStore` — all payment-method actions |
| `src/services/__tests__/paymentFallbackChain.integration.test.ts` | Integration | Sequential fallback, full failure, stopOnHardDecline, maxAttempts, gas spike, sticky/geo-aware strategies, circuit breaker, default chain, validate→process round-trip, analytics |

---

## Error Codes

| Code | Meaning |
|------|---------|
| `PAYMENT_METHOD_DUPLICATE` | Same token + chain already registered |
| `PAYMENT_METHOD_INVALID_TOKEN` | Unsupported token type or bad address |
| `PAYMENT_METHOD_INVALID_CHAIN` | Chain ID not in supported list |
| `PAYMENT_METHOD_MAX_REACHED` | 10-method limit hit |
| `PAYMENT_METHOD_VERIFICATION_FAILED` | On-chain contract check failed |
| `PAYMENT_METHOD_EXPIRED` | Method past its `expiresAt` |
| `INSUFFICIENT_BALANCE` | Wallet lacks funds for the charge |
| `GAS_PRICE_SPIKE` | Current gas exceeds `maxGasPriceGwei` threshold |
| `TOKEN_CONTRACT_UPGRADED` | Contract bytecode changed since last check |
| `FALLBACK_FAILED` | All methods in the chain exhausted |

All errors are instances of `PaymentMethodError` with `.code`, `.userMessage`, and `.recovery` fields.
