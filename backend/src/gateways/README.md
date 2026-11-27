# Billing gateways

Issue #2039 — all billing providers are reached through one `BillingAdapter`
interface defined in [`billingAdapter.ts`](./billingAdapter.ts).

## Contract

```ts
interface BillingAdapter {
  readonly provider: BillingProvider; // 'stripe' | 'paypal' | 'paddle'
  charge(request: BillingChargeRequest): Promise<BillingChargeResult>;
  refund(request: BillingRefundRequest): Promise<BillingRefundResult>;
  fetchCharge(providerChargeId: string): Promise<BillingChargeResult>;
}
```

- Money is always integer minor units plus an ISO-4217 code. No floats.
- Every mutating call carries a caller-owned `idempotencyKey` that is forwarded
  to the provider. Reuse the key for retries of the same logical operation.
- Provider status vocabularies are normalised to
  `succeeded | pending | requires_action` (charges) and
  `succeeded | pending` (refunds).
- Failures are typed `BillingAdapterError`s with a `BillingErrorCode` and a
  `retryable` flag. HTTP 429 and 5xx are retryable; 4xx are not.

## Usage

```ts
import { createBillingAdapter, createConsoleBillingTelemetry } from './gateways/billingAdapter';

const adapter = createBillingAdapter('stripe', {
  transport: myHttpClient, // implements { request(req): Promise<{ status, body }> }
  telemetry: createConsoleBillingTelemetry(),
});

const charge = await adapter.charge({
  idempotencyKey: `sub_123:${invoiceId}`,
  amount: { amountMinor: 1999, currency: 'USD' },
  customerId: 'cus_123',
});
```

## Adding a provider

1. Add its id to `BillingProvider`.
2. Add a `BillingProtocol` implementation (path builders, body builders,
   response parsers, error classification).
3. Register the protocol in `PROTOCOLS` and add a test using a fake transport.

No call site should ever import a provider module directly.

## Provider modules beyond charge/refund

Subscription lifecycle and webhook-driven providers live in their own modules.
They reuse `BillingAdapterError`, `BillingTelemetry` and `withIdempotentRetry`
from `billingAdapter.ts`, so failures and metrics look the same everywhere.

### Stripe subscriptions — [`stripe.ts`](./stripe.ts)

`createStripeSubscriptionAdapter({ transport })` exposes `createSubscription`,
`changePlan`, `previewPlanChange`, `cancelSubscription` and `fetchSubscription`.

- `calculateProration` is a pure, integer-only preview: credit for the unused
  part of the old plan, charge for the remaining part of the new one, rounded
  half-up per leg. `changePlan` sends the same `proration_date` to Stripe, so
  the preview matches the invoice.
- Mutating calls carry the caller's idempotency key. 429, 5xx and transport
  errors are retried with exponential backoff and the **same key**; 4xx are not.

### Shopify billing — [`shopify.ts`](./shopify.ts)

`createShopifyBillingAdapter({ transport })` wraps `appSubscriptionCreate`,
`appSubscriptionCancel` and a subscription lookup over the Admin GraphQL API.
Shopify has no idempotency header, so one result is kept per caller key:
concurrent and repeated calls share a single request. Failures are not cached,
so the caller can retry with the same key. `THROTTLED`, 429 and 5xx are retried
with backoff; `userErrors` are non-retryable rejections.

### Circle USDC — [`circle.ts`](./circle.ts)

- `createCircleAdapter` creates and fetches payments. Amounts are integer
  micro-USDC (6 decimals) internally and decimal strings on the wire.
- `verifyCircleWebhook` checks the ECDSA-SHA256 signature (`X-Circle-Signature`)
  with the key named by `X-Circle-Key-Id`.
- `applyCircleEvent` applies a webhook to a `CircleLedger` idempotently by
  notification id. Statuses only move forward (`pending` → `confirmed` →
  `paid`/`failed`); stale, duplicate and out-of-order events are ignored, and an
  amount that differs from what was expected is flagged, never applied.
- `reconcileCirclePayments` polls Circle for payments still unsettled after
  `staleAfterMs` (lost or delayed webhooks) and returns
  `{ checked, updated, mismatched, errors }`. One failing lookup never aborts
  the sweep. Run it on a schedule.

`InMemoryCircleLedger` is provided for tests; production code supplies its own
`CircleLedger` backed by the database.
