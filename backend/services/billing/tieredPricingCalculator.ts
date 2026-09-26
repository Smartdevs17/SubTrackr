import { PricingTier, TierBreakdownLine, TieredPricingResult } from '../../../src/types/usage';

/**
 * Computes graduated ("tiered") usage charges, e.g. the first 1000 units
 * free, then $0.01/unit up to 10,000, then $0.005/unit after that.
 *
 * Tiers must be supplied in ascending order; the last tier's `upToUnits`
 * should be `null` to mean "unbounded".
 */
export class TieredPricingCalculator {
  private readonly tiers: PricingTier[];

  constructor(tiers: PricingTier[]) {
    if (tiers.length === 0) {
      throw new Error('TieredPricingCalculator requires at least one tier');
    }
    this.tiers = [...tiers].sort((a, b) => {
      if (a.upToUnits === null) return 1;
      if (b.upToUnits === null) return -1;
      return a.upToUnits - b.upToUnits;
    });
  }

  calculate(totalUnits: number): TieredPricingResult {
    const units = Math.max(0, totalUnits);
    const lines: TierBreakdownLine[] = [];
    let remaining = units;
    let lowerBound = 0;
    let totalAmount = 0;

    for (const tier of this.tiers) {
      if (remaining <= 0) break;

      const tierCapacity = tier.upToUnits === null ? Infinity : tier.upToUnits - lowerBound;
      const unitsInTier = Math.min(remaining, tierCapacity);
      const amount = unitsInTier * tier.unitPrice;

      lines.push({ tier, unitsInTier, amount });
      totalAmount += amount;
      remaining -= unitsInTier;
      lowerBound = tier.upToUnits === null ? lowerBound : tier.upToUnits;
    }

    return { totalUnits: units, totalAmount, lines };
  }
}

/** Convenience helper for the common "N units free, then flat rate" shape. */
export function buildSimpleTiers(includedUnits: number, unitPrice: number): PricingTier[] {
  return [
    { upToUnits: includedUnits, unitPrice: 0 },
    { upToUnits: null, unitPrice },
  ];
}
