import { FallbackPricingStrategy } from './strategies/FallbackPricingStrategy';
import type { PricingStrategy } from './PricingStrategy';
import type { PricingStrategyCode } from './types';

const normalizeCode = (code: PricingStrategyCode): PricingStrategyCode =>
  code.trim().toLowerCase().replace(/[\s-]+/g, '_');

export class StrategyRegistry {
  private readonly strategies = new Map<PricingStrategyCode, PricingStrategy>();
  private readonly fallbackStrategy: PricingStrategy;

  constructor(strategies: PricingStrategy[] = [], fallbackStrategy: PricingStrategy = new FallbackPricingStrategy()) {
    this.fallbackStrategy = fallbackStrategy;
    strategies.forEach((strategy) => this.register(strategy));
  }

  register(strategy: PricingStrategy): void {
    this.strategies.set(normalizeCode(strategy.code), strategy);
  }

  resolve(code: PricingStrategyCode): PricingStrategy {
    return this.strategies.get(normalizeCode(code)) ?? this.fallbackStrategy;
  }

  has(code: PricingStrategyCode): boolean {
    return this.strategies.has(normalizeCode(code));
  }

  list(): PricingStrategy[] {
    return [...this.strategies.values()];
  }
}
