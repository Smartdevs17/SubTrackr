# `@subtrackr/billing-types`

The workspace package contains provider-neutral TypeScript contracts shared by
the payment router and its gateway adapters. It is type-only: importing the
package adds no runtime dependency or initialization side effects.

Use its package entrypoint for new payment gateway integrations:

```ts
import type {
  IPaymentGateway,
  PaymentRequest,
  PaymentResult,
} from '@subtrackr/billing-types';
```

`backend/services/payment/interfaces.ts` remains as a compatibility re-export
for existing backend callers. New gateway code should depend directly on the
package so the contracts have one source of truth.
