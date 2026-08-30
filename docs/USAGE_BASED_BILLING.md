# Usage-Based Billing: Metered Pricing and Tiered Overages

Metered billing runs in two halves, and keeping them in step is the whole point
of this document:

| | Where | Responsibility |
|---|---|---|
| **Off-chain rating** | `backend/services/billing/metering.ts` | Produces the invoice the payer reads. |
| **On-chain rating** | `contracts/metering/` (`subtrackr-metering`) | Produces the charge the contract settles. |

Both implement the same four pricing models with the same arithmetic. When they
disagree, a payer is billed one number and charged another — which is a dispute,
not a rounding error.

Ingestion (dedup, clock skew, quota alerts) lives separately in
`meteringService.ts`. This document is about *rating*: units → money.

## Pricing models

Included units are always free; the ladder rates only the **overage** on top.

### `flat`

Every billable unit costs `unitPrice`. No ladder needed.

```
1_000 included, $0.002/unit
1_500 used → 500 billable → $1.00
```

### `graduated`

Each slice of the overage is priced at the band it falls into. This is the model
most SaaS pricing pages describe.

```
tiers: [ { upToUnits: 1_000, unitPrice: 3 }, { upToUnits: null, unitPrice: 1 } ]
100 included, 1_600 used → 1_500 billable
  → first 1_000 @ 3 = 3_000
  → next    500 @ 1 =   500
  → total            = 3_500
```

### `volume`

The **whole** overage is priced at the rate of the single band the total lands
in. Crossing a boundary re-prices everything, so the bill can fall as usage
rises:

```
tiers: [ { upToUnits: 100, unitPrice: 10 }, { upToUnits: null, unitPrice: 4 } ]
100 units → 100 × 10 = 1_000
101 units → 101 ×  4 =   404   ← one more unit, cheaper bill
```

That cliff is intentional in volume pricing, but it surprises people. Use
`marginalUnitPrice()` to show a payer what the next unit actually costs.

### `package`

Units are sold in whole blocks. `upToUnits` is read as the **block size** and
`flatFee` as the price per block; partial blocks round up.

```
tiers: [ { upToUnits: 1_000, unitPrice: 0, flatFee: 25 } ]
2_001 units → 3 started blocks → 75
```

## Ladder rules

A ladder is rejected at configuration time unless:

- bounds strictly ascend (no duplicates, no descending bands);
- prices and flat fees are non-negative;
- the unbounded band (`upToUnits: null` off-chain, `0` on-chain) is **last**, if
  present.

Every non-`flat` model requires at least one tier.

If a `graduated` ladder is bounded and usage overflows its top band, the
remainder bills at the meter's `unitPrice` rather than falling through as free.
A truncated ladder silently billing zero is the worse failure.

## Minimums, caps, and proration

- `minimumCharge` — floor for the meter's period total. Reported as
  `minimumAdjustment` (positive).
- `maximumCharge` — spend cap. Reported as `maximumAdjustment` (negative).
- `prorationFactor` — scales the **included allowance** only, so a mid-period
  signup does not get a full month of free units. Consumed units always bill in
  full.

`RatedUsageBill.subtotal` is the raw sum of line amounts; `total` is the sum
after adjustments. Both are reported so an invoice can show its own arithmetic.

## Off-chain usage

```ts
import { rateUsage, quoteMeter, marginalUnitPrice } from './backend/services/billing/metering';

const bill = rateUsage({
  subscriptionId: 'sub_1',
  period: { start, end },
  usageByMetric: { api_calls: 1_600, gb_egress: 4 },
  plans: [
    {
      metric: 'api_calls',
      model: 'graduated',
      includedUnits: 100,
      unitPrice: 1,
      tiers: [{ upToUnits: 1_000, unitPrice: 3 }, { upToUnits: null, unitPrice: 1 }],
    },
    { metric: 'gb_egress', model: 'flat', includedUnits: 0, unitPrice: 5 },
  ],
});
```

Rating is pure — it reads no store — so the same call prices a closed period, a
mid-period estimate, and a "what would N units cost?" quote.

## On-chain usage

```rust
client.register_tiered_meter(
    &reporter, &subscription_id, &api_calls,
    &0,        // unit_price — the fallback rate
    &100,      // included_units
    &86_400,   // bucket period
    &0,        // alert threshold
    &PricingModel::Graduated,
    &tiers,
);

let charge = client.calculate_usage_charge(&subscription_id, &period);
let quote  = client.quote_usage(&subscription_id, &api_calls, &1_600);
```

`register_meter` still exists and is unchanged: it registers a `Flat` meter with
an empty ladder, so existing callers keep working.

Reconfiguring a meter preserves its totals and buckets, so a mid-period price
change **re-rates the same recorded usage** rather than resetting it.

### Encoding differences

The contract cannot express `null`, so the unbounded band is encoded as
`up_to_units: 0`. Use `toContractTiers()` to convert — it validates first, so a
ladder can never reach the chain in a shape the contract would reject:

```ts
toContractTiers([{ upToUnits: 1_000, unitPrice: 3 }, { upToUnits: null, unitPrice: 1 }]);
// → [{ up_to_units: 1000, ... }, { up_to_units: 0, ... }]
```

`ChargeLine.tier_lines` (on-chain) and `RatedMeterLine.tierLines` (off-chain)
carry the same per-band breakdown, which is what makes the two sides
comparable when reconciling.

## Testing

- Off-chain: `backend/services/billing/__tests__/metering.test.ts`
- On-chain: `contracts/metering/src/test.rs`

Contract tests need the host target, because the workspace defaults to wasm32:

```bash
cd contracts && cargo test -p subtrackr-metering --target x86_64-unknown-linux-gnu
```
