# Subscription Proration Engine with Mid-Cycle Changes

This document specifies the design, mathematical model, backend service architecture, and smart contract integration for SubTrackr's mid-cycle proration engine.

## Overview

When subscribers change plans or billing intervals mid-cycle, the proration engine calculates exact prorated charges for plan upgrades or prorated credits for plan downgrades, ensuring fair and transparent billing.

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
