/**
 * Pricing Strategies — flat, per-seat, usage-based, and tiered implementations.
 *
 * Each strategy implements {@link IPricingStrategy} and is registered with
 * {@link StrategyRegistry}. Consumers resolve strategies by name rather than
 * importing concrete classes, keeping the dependency direction clean.
 */

import { createPiiSafeLogger } from '../../../utils/logger';
import { PricingError } from './errors';
import type { IPricingStrategy, PriceInput, PriceResult } from './types';

const logger = createPiiSafeLogger('subscriptions.pricing.strategies');

// ── Flat-rate strategy ────────────────────────────────────────────────────────

export class FlatRateStrategy implements IPricingStrategy {
  readonly name = 'flat_rate';

  calculate(input: PriceInput): PriceResult {
    return {
      amount: input.basePrice,
      currency: input.currency ?? 'USD',
      breakdown: [{ label: 'Flat rate', amount: input.basePrice }],
    };
  }
}

// ── Per-seat strategy ─────────────────────────────────────────────────────────

export class PerSeatStrategy implements IPricingStrategy {
  readonly name = 'per_seat';

  calculate(input: PriceInput): PriceResult {
    const seats = Math.max(1, input.quantity ?? 1);
    const amount = input.basePrice * seats;
    return {
      amount,
      currency: input.currency ?? 'USD',
      breakdown: [
        { label: `Base price`, amount: input.basePrice },
        { label: `Seats × ${seats}`, amount: amount - input.basePrice },
      ],
    };
  }
}

// ── Usage-based strategy ──────────────────────────────────────────────────────

export class UsageBasedStrategy implements IPricingStrategy {
  readonly name = 'usage_based';

  constructor(private readonly pricePerUnit: number = 0.01) {}

  calculate(input: PriceInput): PriceResult {
    const units = Math.max(0, input.usageUnits ?? 0);
    const usageCost = units * this.pricePerUnit;
    const amount = input.basePrice + usageCost;
    return {
      amount,
      currency: input.currency ?? 'USD',
      breakdown: [
        { label: 'Base fee', amount: input.basePrice },
        { label: `Usage (${units} × $${this.pricePerUnit})`, amount: usageCost },
      ],
    };
  }
}

// ── Tiered strategy ───────────────────────────────────────────────────────────

export interface PricingTier {
  upTo: number | null;
  unitPrice: number;
  flatFee?: number;
}

export class TieredStrategy implements IPricingStrategy {
  readonly name = 'tiered';

  constructor(private readonly tiers: PricingTier[] = []) {}

  calculate(input: PriceInput): PriceResult {
    const units = Math.max(0, input.usageUnits ?? 0);
    let remaining = units;
    let total = input.basePrice;
    const breakdown: PriceResult['breakdown'] = [
      { label: 'Base fee', amount: input.basePrice },
    ];

    for (const tier of this.tiers) {
      if (remaining <= 0) break;
      const tierUnits = tier.upTo === null ? remaining : Math.min(remaining, tier.upTo);
      const tierCost = tierUnits * tier.unitPrice + (tier.flatFee ?? 0);
      total += tierCost;
      breakdown.push({ label: `Tier (${tierUnits} units @ $${tier.unitPrice})`, amount: tierCost });
      remaining -= tierUnits;
    }

    return { amount: total, currency: input.currency ?? 'USD', breakdown };
  }
}

// ── Strategy registry ─────────────────────────────────────────────────────────

export class StrategyRegistry {
  private readonly strategies = new Map<string, IPricingStrategy>();

  constructor() {
    // Register built-in strategies
    this.register(new FlatRateStrategy());
    this.register(new PerSeatStrategy());
    this.register(new UsageBasedStrategy());
    this.register(new TieredStrategy());
  }

  register(strategy: IPricingStrategy): void {
    this.strategies.set(strategy.name, strategy);
    logger.info('pricing.strategy.registered', { name: strategy.name });
  }

  resolve(name: string): IPricingStrategy {
    const strategy = this.strategies.get(name);
    if (!strategy) throw PricingError.strategyNotFound(name);
    return strategy;
  }

  list(): string[] {
    return Array.from(this.strategies.keys());
  }
}

export const strategyRegistry = new StrategyRegistry();
