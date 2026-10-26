# Billing Cycle & Invoice Money Contracts

Reference for the billing-period and money-arithmetic rules that every
subscription, proration, invoice and analytics path is expected to agree on.

Code touched by these rules:

| Concern                                | Module                                |
| -------------------------------------- | ------------------------------------- |
| Spend normalisation                    | `src/utils/stats.ts`                  |
| Invoice periods and totals             | `src/utils/invoice.ts`                |
| Cycle → months normalisation           | `src/types/invoice.ts`                |
| Proration period length                | `src/utils/proration.ts`              |
| Billing-date advancement               | `src/utils/billingDate.ts`            |
| Payment timeout & gas-bump recovery    | `backend/services/paymentTimeoutService.ts` |

---

## 1. Billing cycles are a closed set

`BillingCycle` (`src/types/subscription.ts`) has five members:

```ts
enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY  = 'yearly',
  ANNUAL  = 'annual',
  WEEKLY  = 'weekly',
  CUSTOM  = 'custom',
}
```

`ANNUAL` and `YEARLY` are **both first-class annual cycles**. `ANNUAL` is not a
synonym to be folded away, and it is not an unknown value to be defaulted to
monthly. Any `switch` over `BillingCycle` must decide explicitly what `ANNUAL`
means; a `default:` branch that assumes "monthly" silently mis-bills annual
plans.

Each normaliser and its expected answer for `ANNUAL`:

| Function                                                  | Annual answer | What it used to return |
| --------------------------------------------------------- | ------------- | ---------------------- |
| `getPeriodDays` (`src/utils/proration.ts`)                | `365`         | `30` (monthly default) |
| `billingCycleToMonths` (`src/types/invoice.ts`)           | `12`          | `1` (monthly default)  |
| `buildBillingPeriod` (`src/utils/invoice.ts`)             | 12 months     | 1 month                |
| `getMonthlySubscriptionSpend` (`src/utils/stats.ts`)      | `price / 12`  | `price`                |
| `getYearlySubscriptionSpend` (`src/utils/stats.ts`)      | `price`       | `price * 12`           |
| `advanceBillingDate` (`src/utils/billingDate.ts`)         | +1 year       | +1 year (already correct) |

Use the shared predicate rather than re-deriving the pair:

```ts
import { isAnnualBillingCycle } from '../utils/annualBilling';

if (isAnnualBillingCycle(subscription.billingCycle)) {
  // annual or yearly
}
```

`isAnnualBillingCycle` (`src/utils/annualBilling.ts`) is the single place that
defines what counts as an annual cycle, and it accepts both the enum and the
raw `'annual'` / `'yearly'` strings that arrive from persisted records and API
payloads.

The two spend helpers are the highest-impact of these: an annual plan priced at
1 200 that is treated as monthly reports **1 200/month and 14 400/year** on the
dashboard. The invariant to preserve is:

```ts
getMonthlySubscriptionSpend(sub) * 12 === getYearlySubscriptionSpend(sub)
```

for every cycle, and it is asserted directly in
`src/utils/__tests__/billingCycleAccuracy.test.ts`.

---

## 2. Money arithmetic rules

### 2.1 Round to minor units, never to whole units

All amounts are rounded to two decimals at the end of each calculation. Tax in
particular used to round to whole currency units, which zeroed out any invoice
whose tax component was below one unit (3.00 at 5 % VAT produced 0). Tax now
rounds like every other money helper:

```ts
calculateInvoiceTax(3, 500);     // 0.15  (was 0)
calculateInvoiceTax(10000, 500);  // 500   (unchanged)
```

Rates are expressed in **basis points**: `10_000 bps = 100 %`, so
`tax = subtotal * taxRateBps / 10_000`.

A non-positive or non-finite rate yields `0` rather than a negative or `NaN`
tax line.

### 2.2 `InvoiceLineItem.lineTotal` is optional — resolve it explicitly

`lineTotal` is optional on `InvoiceLineItem`, and line items can also arrive in
the flat invoice-form shape under the `amount` alias. Summing `item.lineTotal`
directly produced `NaN` for any item that omitted it, and a single `NaN` line
poisons the whole invoice total.

Resolution order used by `calculateInvoiceTotals`:

1. `lineTotal`, when it is a finite number
2. `amount` (the flat invoice-form alias), when finite
3. `unitPrice * quantity`, rounding `quantity` to `1` when not finite
4. `0`

The subtotal and the total are each rounded once, after summing. Never sum
unrounded and round at the end only — the intermediate rounding error leaks.

### 2.3 Discounts are not modelled in the shared helper

`calculateInvoiceTotals` computes `total = subtotal + tax`. Discounts are
applied by the callers that own them (see `backend/billing/domain/InvoiceGenerator.ts`,
which subtracts a discount **before** computing tax). Keep the taxable base and
the discount in the same layer, or the invoice will tax a discounted amount one
way and settle another.

---

## 3. Adding a billing cycle

1. Add the member to `BillingCycle`.
2. Decide its answer in **every** row of the table in §1.
3. Extend `src/utils/__tests__/billingCycleAccuracy.test.ts` so the new cycle is
   covered by the 12× identity and by its period length.
4. Check the on-chain mirror in `contracts/subscription/src/billing.rs`, which
   computes `calculate_next_billing` independently of the TypeScript layer.

Grep for every `switch` over the cycle before declaring the work done — a new
member silently lands in `default:` everywhere it is not enumerated:

```bash
rg "BillingCycle\." --type ts
```

---

## 4. Payment timeout & gas-bump recovery

`PaymentTimeoutService` (`backend/services/paymentTimeoutService.ts`) retries a
payment that has not confirmed within the per-chain window. Three invariants are
guaranteed and covered by
`backend/services/shared/__tests__/paymentTimeoutService.test.ts`:

### 4.1 One recovery attempt per charge is in flight

`autoRecoverAll` (scheduler) and `manualRetry` (user) can fire for the same
charge at the same time. Without a guard both enter `attemptRecovery` and the
gas price is bumped twice for one logical retry. The service holds the charge
id in `recoveringCharges` for the duration of the attempt and returns `null` to
the second caller.

### 4.2 A deferred retry leaves the gas price alone

`manualRetry` takes a user-supplied gas price as a *floor* and then applies the
configured `gasBumpBps` bump on top:

```
minBumped        = lastGasPrice + lastGasPrice * gasBumpBps / 10_000
effectivePrice   = max(requestedGasPrice, minBumped)
newGasPrice      = effectivePrice * (10_000 + gasBumpBps) / 10_000
```

The override is applied only for the duration of that attempt. If the attempt
cannot proceed — the chain reorganised, or `maxRecoveryAttempts` is already
reached — the stored `lastGasPrice` is restored. Otherwise a retry that never
happened would permanently raise the floor for every later attempt.

### 4.3 The reorg guard is only consulted with a real block number

`ChainStatusProvider.detectReorg(chainId, sinceBlock)` expects a **block
number**. Passing `reorgSafetyLedgers` (a depth, e.g. `2`) in that position
asked "has the chain reorganised since block 2?", which is true on every mature
chain, so recovery was deferred forever.

`getBlockNumber?` was added to the provider interface for this. The service
derives the baseline as:

```
sinceBlock = max(0, floor(head) - reorgSafetyLedgers)
```

When no block height is available — the provider does not implement
`getBlockNumber`, the probe throws, or it returns a non-finite value — the
guard is **skipped**, not guessed at. An unreachable provider must not be read
as "reorganised", and it must not be handed a fabricated block number either.