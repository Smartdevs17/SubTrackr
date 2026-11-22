# @subtrackr/contract-types

TypeScript mirror of the Soroban contract types in
`contracts/types/src/lib.rs`, shared by every TS client (JS SDK, app, backend).

| Export | Mirrors |
| --- | --- |
| `Interval`, `INTERVALS`, `INTERVAL_SECONDS`, `intervalSeconds()` | `enum Interval`, `Interval::seconds()` |
| `SubscriptionStatus`, `SUBSCRIPTION_STATUSES` | `enum SubscriptionStatus` |
| `Plan`, `Subscription` | `struct Plan`, `struct Subscription` |
| `isInterval()`, `isSubscriptionStatus()` | runtime guards for API input |

`__tests__/contract.test.ts` parses the Rust source and fails when variants,
interval lengths or struct fields drift. When you change a contract type, update
`contract.ts` in the same PR.

The JS SDK (`sdks/javascript`) re-exports these types; `BillingInterval` remains
as an alias of `Interval`.

Run the tests with:

```bash
npx jest --config jest.backend.config.js shared/types
```
