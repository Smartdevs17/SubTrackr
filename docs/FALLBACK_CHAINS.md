# Subscription Payment Method Fallback Chains

## Overview

Issue #773 implements automatic payment method fallback chains for SubTrackr, ensuring payment reliability by automatically trying alternative gateways when the primary gateway fails.

## Architecture

```
backend/services/payment/
├── domain/
│   ├── fallbackChainService.ts   # Fallback chain engine
│   ├── PaymentRouter.ts          # Existing payment router
│   └── gateways/                 # Gateway adapters
└── index.ts                      # Exports
```

## Features

### 1. Fallback Chain Configuration

Configure ordered fallback chains per merchant:

```typescript
import { upsertFallbackChain } from '../services/payment';

upsertFallbackChain('merchant-123', {
  chain: [
    { gateway: 'stripe', priority: 0, enabled: true, timeoutMs: 5000 },
    { gateway: 'circle', priority: 1, enabled: true, timeoutMs: 5000 },
    { gateway: 'stellar', priority: 2, enabled: true, timeoutMs: 10000 },
  ],
  retryAttempts: 2,
  retryDelayMs: 1000,
  active: true,
});
```

### 2. Automatic Fallback on Failure

Payments automatically try alternative gateways:

```typescript
import { executeWithFallback, registerGatewayExecutor } from '../services/payment';

// Register gateway executors
registerGatewayExecutor('stripe', async (request) => {
  // Call Stripe API
  return { success: true, gatewayUsed: 'stripe' };
});

registerGatewayExecutor('circle', async (request) => {
  // Call Circle API
  return { success: true, gatewayUsed: 'circle' };
});

// Execute payment with automatic fallback
const result = await executeWithFallback('merchant-123', {
  amount: 99.99,
  currency: 'USD',
  customerId: '0x1234...',
  paymentMethodId: 'pm_abc123',
});

if (result.success) {
  console.log(`Payment succeeded on ${result.successfulGateway}`);
  console.log(`Total attempts: ${result.attempts.length}`);
  console.log(`Duration: ${result.totalDurationMs}ms`);
} else {
  console.error(`All gateways failed: ${result.error}`);
}
```

### 3. Fallback Analytics

Track fallback performance:

```typescript
import { getFallbackAnalytics } from '../services/payment';

const analytics = getFallbackAnalytics({
  startDate: '2026-01-01T00:00:00Z',
  endDate: '2026-01-31T23:59:59Z',
  merchantId: 'merchant-123',
});

console.log(`Success rate: ${(analytics.successRateByGateway.stripe * 100).toFixed(1)}%`);
console.log(`Fallback rate: ${(analytics.fallbackRate * 100).toFixed(1)}%`);
console.log(`Average attempts: ${analytics.averageAttemptsPerPayment.toFixed(2)}`);
```

### 4. Fallback History

Query payment attempt history:

```typescript
import { getFallbackHistory } from '../services/payment';

const history = getFallbackHistory({
  merchantId: 'merchant-123',
  gateway: 'stripe',
  status: 'failed',
  limit: 100,
  startDate: '2026-01-01T00:00:00Z',
});
```

### 5. Fallback Notifications

Receive notifications on fallback events:

```typescript
import { getFallbackNotifications, markFallbackNotificationSent } from '../services/payment';

// Get unsent notifications
const notifications = getFallbackNotifications('merchant-123', { unsentOnly: true });

for (const notif of notifications) {
  console.log(`${notif.title}: ${notif.message}`);
  // Send email/webhook...
  markFallbackNotificationSent(notif.id);
}
```

## Flow Diagram

```
Payment Request
    │
    ▼
┌─────────────────────────┐
│ Get Fallback Chain      │
│ for Merchant            │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Sort by Priority        │
│ (0 = first)             │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Try Gateway 1 (stripe)  │
│ + Timeout + Retries     │
└─────────────────────────┘
    │
    ├─ Success → Return result
    │
    ├─ Failed → Try Gateway 2 (circle)
    │              │
    │              ├─ Success → Return result
    │              │
    │              └─ Failed → Try Gateway 3 (stellar)
    │                             │
    │                             ├─ Success → Return result
    │                             │
    │                             └─ Failed → Return failure
    │
    └─ Timeout → Try next gateway
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `chain` | Array | `[{stripe}, {circle}, {stellar}]` | Ordered list of gateways |
| `retryAttempts` | number | `1` | Retries per gateway |
| `retryDelayMs` | number | `1000` | Delay between retries |
| `timeoutMs` | number | `5000` | Per-gateway timeout |
| `active` | boolean | `true` | Whether chain is enabled |

## Analytics Metrics

| Metric | Description |
|--------|-------------|
| `totalAttempts` | Total gateway attempts |
| `successfulAttempts` | Successful payments |
| `failedAttempts` | Failed attempts |
| `timeoutAttempts` | Timed out attempts |
| `successRateByGateway` | Success rate per gateway |
| `averageAttemptsPerPayment` | Avg attempts per payment |
| `fallbackRate` | % of payments needing fallback |
| `commonFailureReasons` | Top failure reasons |

## Security Considerations

1. **Idempotency**: Each payment attempt uses unique idempotency keys
2. **Timeout Protection**: Gateway timeouts prevent hanging
3. **Retry Limits**: Configurable retry limits prevent cascading failures
4. **Audit Trail**: All attempts are logged for debugging
5. **Notification Alerts**: Merchants are notified of failures
