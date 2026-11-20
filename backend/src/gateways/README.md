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
