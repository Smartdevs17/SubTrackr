# Subscription Proration Engine with Mid-Cycle Changes

This document specifies the design, mathematical model, backend service architecture, and smart contract integration for SubTrackr's mid-cycle proration engine.

## Overview

When subscribers change plans or billing intervals mid-cycle, the proration engine calculates exact prorated charges for plan upgrades or prorated credits for plan downgrades, ensuring fair and transparent billing.

The backend validates plan identity, non-negative finite prices, and ordered
cycle dates before calculating. An effective date outside the current cycle is
clamped to the nearest cycle boundary, so previews cannot accidentally charge
or credit time outside the subscription period. Invalid input returns a
validation error rather than producing a misleading amount.

---

## Proration Principles & Formula

1. **Unused Value of Current Plan**:
   $$\text{Unused Value} = \text{Old Price} \times \frac{\text{Remaining Seconds}}{\text{Total Period Seconds}}$$

2. **Prorated Value of New Plan**:
   $$\text{Prorated Value} = \text{New Price} \times \frac{\text{Remaining Seconds}}{\text{Total Period Seconds}}$$

3. **Net Proration Adjustment**:
   $$\text{Net Adjustment} = \text{Prorated Value} - \text{Unused Value}$$
   - If $\text{Net Adjustment} > 0$: Prorated charge (Upgrade).
   - If $\text{Net Adjustment} < 0$: Prorated credit memo (Downgrade).

---

## Architecture & Components

### 1. Backend Proration Billing Module (`backend/services/billing/proration.ts`)

- **Class `ProrationEngine`**:
  - `calculateMidCycleProration(request)`: Main calculation engine handling mid-cycle changes with exact second precision.
  - `generateCreditMemo(subscriptionId, amount, reason)`: Generates credit memos for unused balances.
  - `applyCreditBalance(chargeAmount, creditMemo)`: Deducts credit balance from future charges.
  - `calculateNetProration(subscription, changes)`: Aggregates net proration across multiple sequential mid-cycle modifications.

### 2. Soroban Smart Contract (`contracts/subscription/src/proration.rs` & `lib.rs`)

- **Functions**:
  - `calculate_proration`: On-chain proration calculation.
  - `preview_proration`: On-chain preview before confirming changes.
  - `change_plan`: Executes mid-cycle plan changes on-chain, applies credit memos or processes upgrade charges, and updates subscriber index.

---

## Code Example

```typescript
import { ProrationEngine } from './backend/services/billing/proration';

const result = ProrationEngine.calculateMidCycleProration({
  subscription: mySub,
  newPrice: 29.99,
  effectiveDate: 'immediate',
});

console.log(result.description);
// Output: Prorated charge of $12.50 for mid-cycle plan upgrade (15 days remaining)
```

## Exact day/hour precision (issue #2193)

`backend/services/billing/prorationEngine.ts` is the canonical calculator. Amounts are
derived from the exact number of milliseconds remaining in the billing period — no
rounding up to whole days — so a change made 36 hours before renewal is billed for
exactly 36 hours, not two days. `backend/billing/domain/ProrationService` delegates to
the same engine, so HTTP previews and internal calculations cannot drift.

Input additions to `ProrationCalculationRequest`:

| Field | Type | Meaning |
| --- | --- | --- |
| `precision` | `'day' \| 'hour'` | Granularity shown in the breakdown/explanation. Amounts always use exact timestamps. |

Result additions to `ProrationCalculationResult`:

| Field | Type | Meaning |
| --- | --- | --- |
| `cycleTotalHours` | `number` | Exact cycle length in hours, rounded to cents |
| `hoursUsed` / `hoursRemaining` | `number` | Exact elapsed/remaining hours |
| `daysUsedExact` / `daysRemainingExact` | `number` | Fractional days (no ceiling) |

Business rules:

1. `unusedCredit = oldPrice * remainingMs / cycleMs`.
2. `newCharge = min(newPrice, newPrice * remainingMs / newCycleMs)`, where `newCycleMs`
   is 7/30/365 days for weekly/monthly/yearly-and-annual plans. `ANNUAL` is mapped to
   365 days in both the backend engine and the frontend calculator.
3. `net = newCharge - unusedCredit`; negative values are credits. Tax is computed on
   the unrounded net and money is rounded once, to cents.
4. Effective dates outside the cycle are clamped to its boundaries.
5. `calculateNetProration(request, changes)` aggregates sequential plan changes without
   rounding intermediate results.

The HTTP layer is unchanged:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/subscriptions/:id/proration/preview` | Preview an exact proration |
| `POST` | `/subscriptions/:id/proration/apply` | Store a preview record |
| `PATCH` | `/subscriptions/:id/proration/:recordId/confirm` | Apply a stored record |
| `DELETE` | `/subscriptions/:id/proration/:recordId` | Cancel a stored record |
| `GET` | `/subscriptions/:id/proration/history` | List records |
| `GET` | `/proration/analytics` | Aggregated analytics |

Tests: `backend/services/billing/__tests__/prorationEngine.test.ts` covers hour
precision, annual cycles, clamping, credits, aggregation and validation.
