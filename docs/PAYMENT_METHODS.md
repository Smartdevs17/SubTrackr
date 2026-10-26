# Payment Methods and Fallback Chains

## Overview

Payment methods used to be managed one at a time, ordered only by an implicit
priority label, with no way to say "try the card, then the USDC wallet, then the
treasury". A **fallback chain** is that explicit, ordered route. A charge walks
it until one method succeeds, so a single expired card no longer means a failed
renewal.

| Layer      | Location                                            | Responsibility                                     |
| ---------- | --------------------------------------------------- | -------------------------------------------------- |
| Types      | `src/types/wallet.ts`                               | Chain, share, alert and analytics shapes           |
| Service    | `src/services/paymentMethodService.ts`              | On-chain charging, chains, alerts, analytics       |
| Store      | `src/store/walletStore.ts`                          | Wallet-backed methods, chains, shares               |
| Backend    | `backend/services/billing/paymentMethodRegistry.ts` | Server-side registry, chains, charging, analytics  |
| App store  | `app/stores/paymentStore.ts`                        | Local method model used by the merchant screen     |
| UI         | `app/screens/PaymentMethodsScreen.tsx`              | CRUD, chain builder, alerts, analytics             |

The service and the registry mirror each other deliberately: the client charges
through a connected wallet, the server charges through a processor, and both
expose the same chain semantics so a merchant sees one model.

## Method CRUD

```ts
const method = registry.addMethod(merchantId, {
  label: 'Primary card',
  kind: 'card',
  reference: '4242',
  currency: 'USD',
  spendLimit: 500,   // 0 means unlimited
  expiresAt: '2027-01-31T00:00:00.000Z',
});
registry.verifyMethod(method.id);
```

A `crypto` method is verified on registration — the wallet proved itself by
signing. Every other kind needs an explicit verification step before it can be
charged, and an unverified method is skipped by a chain rather than attempted.

Removing a method also drops it from every chain, so a chain never points at
something that can no longer be charged.

## Fallback chains

```ts
interface FallbackChain {
  id: string;
  name: string;
  methodIds: string[];         // tried in this order
  subscriptionId: string | null; // null applies to every subscription
  maxAttempts: number;         // 0 means try the whole chain
  stopOnHardDecline: boolean;
  isActive: boolean;
}
```

A chain is valid when it names at least one known method, holds at most
`MAX_CHAIN_LENGTH` (5), lists no method twice, and every method belongs to the
merchant. Validation also warns — without failing — when:

- the chain has a single usable method, which means no fallback at all
- some listed methods are inactive, unverified or expired

Both warnings can appear together; they are independent facts about the chain.

`resolveChainMethods(chain)` returns what the chain will actually attempt:
active, verified, unexpired methods, capped by `maxAttempts`.

### Selection

`chainForSubscription(subscriptionId)` prefers a chain scoped to that
subscription, then the global chain, then nothing. Inactive chains are ignored.
When no chain is configured at all, the client derives one from the priority
ordering and the server falls back to every registered method — so a merchant
who has never touched this feature still gets sensible routing.

## Charging

```ts
const result = await registry.charge(merchantId, subscriptionId, 100);
// {
//   success: true,
//   succeededMethodId: 'pm_2',
//   succeededAtPosition: 1,     // the fallback did the work
//   attempts: [ {…failed}, {…succeeded} ],
//   haltedOnHardDecline: false,
// }
```

Each entry is tried in turn. Declines fall through to the next method, with one
exception: a **hard decline** — expired, inactive or unverified — halts the whole
chain when `stopOnHardDecline` is set, because falling through would only repeat
a configuration problem rather than find a working route.

Failure reasons are recorded per attempt: `expired`, `inactive`, `unverified`,
`limit_exceeded`, `declined`, `unknown`. Every attempt, successful or not, joins
the attempt log that analytics reads.

## Expiry tracking and alerts

`getExpiryAlerts(merchantId, withinDays = 30)` grades every method with an
expiry date:

| Severity   | When                                     |
| ---------- | ---------------------------------------- |
| `expired`  | The date has passed                      |
| `critical` | Within `EXPIRY_CRITICAL_DAYS` (7)        |
| `warning`  | Within the window but further out        |

Alerts are sorted soonest-first, and a method still sitting in an **active
chain** is flagged in its message — its expiry will break a charge, not merely
retire an unused method:

> Primary card expires in 3 day(s) and is still in a fallback chain

`deactivateExpired(merchantId)` retires everything past its date in one pass and
returns how many it touched.

## Sharing

A method can be granted to another account:

| Role      | May do                                                    |
| --------- | --------------------------------------------------------- |
| `viewer`  | See the method in listings                                |
| `charger` | Also spend from it, bounded by the share's `spendLimit`   |

```ts
registry.shareMethod(methodId, 'team_member', 'charger', { spendLimit: 100 });
registry.canGranteeCharge(methodId, 'team_member', 100);  // true
registry.canGranteeCharge(methodId, 'team_member', 101);  // false
```

A share with an `expiresAt` stops granting access once that moment passes — an
elapsed share behaves exactly like a revoked one, so no cleanup job is needed to
close it. Sharing with the method's own owner, or from an inactive method, is
rejected.

## Analytics

| Metric                | Meaning                                                     |
| --------------------- | ----------------------------------------------------------- |
| `totalAttempts`       | Every charge attempt across every method                    |
| `successRate`         | `totalSuccesses / totalAttempts`                            |
| `fallbackRate`        | Fraction of successful charges that needed a fallback       |
| `byMethod`            | Per-method attempts, successes, volume, top failure reason  |
| `failureReasons`      | Declines ranked by frequency                                |
| `mostReliableMethodId`| Highest success rate over at least one attempt              |
| `activeMethods`       | Methods currently chargeable                                |
| `expiringMethods`     | Methods approaching expiry, excluding those already expired |

`fallbackRate` is the number that says whether a chain is doing real work: a
rate of zero means the head of the chain always lands, while a high rate means
the primary method is failing often enough to be worth investigating.

Analytics are scoped per merchant — one merchant's attempts never appear in
another's numbers.

## UI

`PaymentMethodsScreen` surfaces all of it:

- add, verify, re-prioritise and remove methods
- an expiry alert panel colour-coded by severity, with a one-tap
  "deactivate expired"
- a chain builder: tap methods in the order they should be tried, name the
  chain, create it; each chain then shows its ordered steps with "move up",
  plus any validation warnings
- an analytics panel with attempts, success rate, fallback rate and per-method
  breakdown
- recent attempts, annotated with the chain step they came from

## Testing

```bash
# Server-side registry
npx jest -c jest.backend.config.js backend/services/billing/__tests__/paymentMethodRegistry.test.ts

# App store (app/ is excluded from the default jest config, so override it)
npx jest --testPathIgnorePatterns "/node_modules/" --testPathPattern "app/stores/__tests__/paymentStore"
```
