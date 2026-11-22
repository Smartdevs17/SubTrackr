/**
 * Metered pricing and tiered overage rating.
 *
 * `meteringService.ts` owns *ingestion* — dedup, clock-skew handling, quota
 * alerts. This module owns *rating*: turning the units a subscription consumed
 * over a period into money, under the same four pricing models the
 * `subtrackr-metering` Soroban contract implements
 * (`contracts/metering/src/metering.rs`). Keeping the two in step matters:
 * off-chain rating produces the invoice the payer sees, on-chain rating
 * produces the charge the contract settles, and a disagreement between them is
 * a dispute.
 *
 * Rating is deliberately pure — it takes a plan and a unit count and returns a
 * breakdown. Nothing here reads the ingestion store, so the same function
 * prices a closed period, a mid-period estimate, and a "what would N units
 * cost?" quote.
 */

import { TieredPricingCalculator } from './tieredPricingCalculator';
import type { PricingTier } from '../../../src/types/usage';

/**
 * Raised when a pricing plan or a usage figure cannot be rated.
 *
 * Deliberately a plain `Error` subclass rather than the module's `BillingError`:
 * that type descends from `backend/services/shared/errors.ts`, which does not
 * currently compile, and rating must stay importable from the billing worker
 * and from tests.
 */
export class MeteringPricingError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_PLAN' | 'INVALID_USAGE' = 'INVALID_PLAN'
  ) {
    super(message);
    this.name = 'MeteringPricingError';
    Object.setPrototypeOf(this, MeteringPricingError.prototype);
  }
}

/** How billable units become an amount once the included allowance is spent. */
export type MeteredPricingModel = 'flat' | 'graduated' | 'volume' | 'package';

/**
 * One band of an overage ladder.
 *
 * `upToUnits` is the band's inclusive cumulative upper bound; `null` marks the
 * final unbounded band. `flatFee` is charged once when any unit falls into the
 * band, and is the price *per block* under the `package` model (where
 * `upToUnits` is read as the block size).
 */
export interface OverageTier {
  upToUnits: number | null;
  unitPrice: number;
  flatFee?: number;
}

export interface MeterPricingPlan {
  metric: string;
  model: MeteredPricingModel;
  /** Units granted free each period before the ladder applies. */
  includedUnits: number;
  /** Rate used by the `flat` model and as the fallback past a truncated ladder. */
  unitPrice: number;
  tiers?: OverageTier[];
  /** Floor applied to the metered total for the period. */
  minimumCharge?: number;
  /** Ceiling applied to the metered total for the period ("spend cap"). */
  maximumCharge?: number;
  currency?: string;
}

export interface RatedTierLine {
  upToUnits: number | null;
  units: number;
  unitPrice: number;
  flatFee: number;
  amount: number;
}

export interface RatedMeterLine {
  metric: string;
  model: MeteredPricingModel;
  unitsUsed: number;
  includedUnits: number;
  /** Units past the included allowance — the overage that actually bills. */
  billableUnits: number;
  amount: number;
  tierLines: RatedTierLine[];
}

export interface RatedUsageBill {
  subscriptionId: string;
  currency: string;
  period: { start: Date; end: Date };
  lines: RatedMeterLine[];
  /** Sum of the line amounts before minimum/maximum adjustment. */
  subtotal: number;
  /** Positive when a minimum charge topped the bill up. */
  minimumAdjustment: number;
  /** Negative when a spend cap trimmed the bill. */
  maximumAdjustment: number;
  total: number;
}

export interface RateUsageInput {
  subscriptionId: string;
  period: { start: Date; end: Date };
  /** Units consumed in the period, keyed by metric. */
  usageByMetric: Record<string, number>;
  plans: MeterPricingPlan[];
  currency?: string;
  /**
   * Fraction of the period the subscription was actually active, in `[0, 1]`.
   * Included allowances are scaled by this so a mid-period signup does not get
   * a full month of free units. Defaults to 1.
   */
  prorationFactor?: number;
}

const DEFAULT_CURRENCY = 'USD';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Rejects ladders that would rate ambiguously: unsorted bounds, a duplicate
 * bound, negative money, or an unbounded band anywhere but last.
 */
export function validateOverageTiers(tiers: OverageTier[]): void {
  let previous = 0;
  tiers.forEach((tier, index) => {
    if (!isFiniteNumber(tier.unitPrice) || tier.unitPrice < 0) {
      throw new MeteringPricingError(
        `Tier ${index} has a negative or non-finite unitPrice`
      );
    }
    if (tier.flatFee !== undefined && (!isFiniteNumber(tier.flatFee) || tier.flatFee < 0)) {
      throw new MeteringPricingError(
        `Tier ${index} has a negative or non-finite flatFee`
      );
    }
    if (tier.upToUnits === null) {
      if (index !== tiers.length - 1) {
        throw new MeteringPricingError(
          'An unbounded tier (upToUnits: null) must be the last tier'
        );
      }
      return;
    }
    if (!isFiniteNumber(tier.upToUnits) || tier.upToUnits <= previous) {
      throw new MeteringPricingError(
        `Tier bounds must strictly ascend; tier ${index} bound ${tier.upToUnits} follows ${previous}`
      );
    }
    previous = tier.upToUnits;
  });
}

export function validateMeterPricingPlan(plan: MeterPricingPlan): void {
  if (!plan.metric) {
    throw new MeteringPricingError('Meter pricing plan requires a metric');
  }
  if (!isFiniteNumber(plan.unitPrice) || plan.unitPrice < 0) {
    throw new MeteringPricingError(
      `Meter "${plan.metric}" has a negative or non-finite unitPrice`
    );
  }
  if (!isFiniteNumber(plan.includedUnits) || plan.includedUnits < 0) {
    throw new MeteringPricingError(
      `Meter "${plan.metric}" has a negative or non-finite includedUnits`
    );
  }
  if (plan.model !== 'flat' && (!plan.tiers || plan.tiers.length === 0)) {
    throw new MeteringPricingError(
      `Meter "${plan.metric}" uses the "${plan.model}" model but defines no tiers`
    );
  }
  if (plan.tiers) {
    validateOverageTiers(plan.tiers);
  }
  if (
    plan.minimumCharge !== undefined &&
    plan.maximumCharge !== undefined &&
    plan.minimumCharge > plan.maximumCharge
  ) {
    throw new MeteringPricingError(
      `Meter "${plan.metric}" has a minimumCharge above its maximumCharge`
    );
  }
}

/** Selects the band covering `units`, or the last band when `units` overflows it. */
function selectTier(tiers: OverageTier[], units: number): OverageTier | undefined {
  for (const tier of tiers) {
    if (tier.upToUnits === null || units <= tier.upToUnits) return tier;
  }
  return tiers[tiers.length - 1];
}

function rateGraduated(
  billableUnits: number,
  unitPrice: number,
  tiers: OverageTier[]
): RatedTierLine[] {
  // The shared graduated walk lives in TieredPricingCalculator; reuse it for the
  // unit split so tiered invoices and this rater cannot drift apart, then layer
  // the per-band flat fees on top.
  const ladder: PricingTier[] = tiers.map((tier) => ({
    upToUnits: tier.upToUnits,
    unitPrice: tier.unitPrice,
  }));
  const bounded = tiers[tiers.length - 1]?.upToUnits !== null;
  // A truncated ladder must still bill the overflow, so extend it with the
  // meter's flat rate rather than dropping those units.
  if (bounded) {
    ladder.push({ upToUnits: null, unitPrice });
  }

  const result = new TieredPricingCalculator(ladder).calculate(billableUnits);

  return result.lines
    .filter((line) => line.unitsInTier > 0)
    .map((line) => {
      const source = tiers.find((tier) => tier.upToUnits === line.tier.upToUnits);
      const flatFee = source?.flatFee ?? 0;
      return {
        upToUnits: line.tier.upToUnits,
        units: line.unitsInTier,
        unitPrice: line.tier.unitPrice,
        flatFee,
        amount: line.amount + flatFee,
      };
    });
}

function rateVolume(
  billableUnits: number,
  unitPrice: number,
  tiers: OverageTier[]
): RatedTierLine[] {
  const tier = selectTier(tiers, billableUnits);
  const price = tier?.unitPrice ?? unitPrice;
  const flatFee = tier?.flatFee ?? 0;
  return [
    {
      upToUnits: tier?.upToUnits ?? null,
      units: billableUnits,
      unitPrice: price,
      flatFee,
      amount: billableUnits * price + flatFee,
    },
  ];
}

function ratePackage(
  billableUnits: number,
  unitPrice: number,
  tiers: OverageTier[]
): RatedTierLine[] {
  const tier = selectTier(tiers, billableUnits);
  const blockSize = tier?.upToUnits ?? null;
  if (blockSize === null || blockSize <= 0) {
    // No usable block size — degrade to flat rating rather than billing zero.
    return [
      {
        upToUnits: null,
        units: billableUnits,
        unitPrice,
        flatFee: 0,
        amount: billableUnits * unitPrice,
      },
    ];
  }
  const blocks = Math.ceil(billableUnits / blockSize);
  const blockPrice = tier?.flatFee ?? 0;
  return [
    {
      upToUnits: blockSize,
      units: billableUnits,
      unitPrice: blockPrice,
      flatFee: blockPrice,
      amount: blocks * blockPrice,
    },
  ];
}

/**
 * Prices `unitsUsed` against a single meter's plan.
 *
 * `prorationFactor` scales the included allowance only; consumed units are
 * always billed in full.
 */
export function rateMeter(
  plan: MeterPricingPlan,
  unitsUsed: number,
  prorationFactor = 1
): RatedMeterLine {
  validateMeterPricingPlan(plan);

  if (!isFiniteNumber(unitsUsed) || unitsUsed < 0) {
    throw new MeteringPricingError(
      `Meter "${plan.metric}" received a negative or non-finite unit count`,
      'INVALID_USAGE'
    );
  }
  const factor = Math.min(Math.max(prorationFactor, 0), 1);
  const includedUnits = Math.floor(plan.includedUnits * factor);
  const billableUnits = Math.max(0, unitsUsed - includedUnits);

  let tierLines: RatedTierLine[] = [];
  if (billableUnits > 0) {
    const tiers = plan.tiers ?? [];
    switch (plan.model) {
      case 'graduated':
        tierLines = rateGraduated(billableUnits, plan.unitPrice, tiers);
        break;
      case 'volume':
        tierLines = rateVolume(billableUnits, plan.unitPrice, tiers);
        break;
      case 'package':
        tierLines = ratePackage(billableUnits, plan.unitPrice, tiers);
        break;
      case 'flat':
      default:
        tierLines = [
          {
            upToUnits: null,
            units: billableUnits,
            unitPrice: plan.unitPrice,
            flatFee: 0,
            amount: billableUnits * plan.unitPrice,
          },
        ];
        break;
    }
  }

  const amount = tierLines.reduce((sum, line) => sum + line.amount, 0);

  return {
    metric: plan.metric,
    model: plan.model,
    unitsUsed,
    includedUnits,
    billableUnits,
    amount,
    tierLines,
  };
}

/**
 * Rates every meter on a subscription for one period and applies plan-level
 * minimums and spend caps.
 *
 * Minimums and caps are per-meter (they belong to the meter's plan), so the
 * bill reports the aggregate adjustment while each line keeps its raw amount.
 */
export function rateUsage(input: RateUsageInput): RatedUsageBill {
  const { subscriptionId, period, usageByMetric, plans } = input;

  if (period.end.getTime() < period.start.getTime()) {
    throw new MeteringPricingError(
      'Billing period ends before it starts',
      'INVALID_USAGE'
    );
  }

  const factor = input.prorationFactor ?? 1;
  const lines: RatedMeterLine[] = [];
  let subtotal = 0;
  let minimumAdjustment = 0;
  let maximumAdjustment = 0;

  for (const plan of plans) {
    const unitsUsed = usageByMetric[plan.metric] ?? 0;
    const line = rateMeter(plan, unitsUsed, factor);
    lines.push(line);

    let effective = line.amount;
    if (plan.minimumCharge !== undefined && effective < plan.minimumCharge) {
      minimumAdjustment += plan.minimumCharge - effective;
      effective = plan.minimumCharge;
    }
    if (plan.maximumCharge !== undefined && effective > plan.maximumCharge) {
      maximumAdjustment += plan.maximumCharge - effective;
      effective = plan.maximumCharge;
    }
    subtotal += line.amount;
  }

  return {
    subscriptionId,
    currency: input.currency ?? plans[0]?.currency ?? DEFAULT_CURRENCY,
    period,
    lines,
    subtotal,
    minimumAdjustment,
    maximumAdjustment,
    total: subtotal + minimumAdjustment + maximumAdjustment,
  };
}

/**
 * Prices a hypothetical volume without touching recorded usage — the
 * "what would N units cost?" estimator behind the pricing page.
 */
export function quoteMeter(plan: MeterPricingPlan, units: number): RatedMeterLine {
  return rateMeter(plan, units, 1);
}

/**
 * Marginal cost of the next unit at the current volume. Useful for showing a
 * payer what crossing the next tier boundary will do to their bill.
 */
export function marginalUnitPrice(plan: MeterPricingPlan, atUnits: number): number {
  const here = rateMeter(plan, atUnits, 1).amount;
  const next = rateMeter(plan, atUnits + 1, 1).amount;
  return next - here;
}

/**
 * Converts an overage ladder into the contract's `PriceTier` encoding, where
 * `0` — not `null` — marks the unbounded band. Use this when pushing a plan
 * on-chain via `register_tiered_meter` so both sides rate identically.
 */
export function toContractTiers(
  tiers: OverageTier[]
): Array<{ up_to_units: number; unit_price: number; flat_fee: number }> {
  validateOverageTiers(tiers);
  return tiers.map((tier) => ({
    up_to_units: tier.upToUnits ?? 0,
    unit_price: tier.unitPrice,
    flat_fee: tier.flatFee ?? 0,
  }));
}

/** Convenience ladder for the common "N free, then flat rate" shape. */
export function buildOverageLadder(unitPrice: number): OverageTier[] {
  return [{ upToUnits: null, unitPrice }];
}
