/**
 * Pricing Strategy Factory
 *
 * Creates and manages pricing strategy instances.
 * Selects the appropriate strategy based on plan type or configuration.
 */

import { PricingStrategy, PricingContext, PricingAnalytics } from './pricingStrategy';
import { FlatRateStrategy } from './flatRateStrategy';
import { UsageBasedStrategy } from './usageBasedStrategy';
import { TieredPricingStrategy } from './tieredStrategy';
import { DynamicPricingStrategy } from './dynamicStrategy';

export type PlanType = 'free' | 'basic' | 'premium' | 'enterprise';

export interface StrategyConfig {
  planType: PlanType;
  strategyOverride?: string;
}

/** Maps plan types to default pricing strategies */
const PLAN_STRATEGY_MAP: Record<PlanType, string> = {
  free: 'flat_rate',
  basic: 'flat_rate',
  premium: 'tiered',
  enterprise: 'dynamic',
};

export class PricingStrategyFactory {
  private static instances: Map<string, PricingStrategy> = new Map();

  /** Get or create a strategy instance */
  static getStrategy(name: string): PricingStrategy {
    if (!PricingStrategyFactory.instances.has(name)) {
      PricingStrategyFactory.instances.set(name, PricingStrategyFactory.createStrategy(name));
    }
    return PricingStrategyFactory.instances.get(name)!;
  }

  /** Create a new strategy instance by name */
  static createStrategy(name: string): PricingStrategy {
    switch (name) {
      case 'flat_rate':
        return new FlatRateStrategy();
      case 'usage_based':
        return new UsageBasedStrategy();
      case 'tiered':
        return new TieredPricingStrategy();
      case 'dynamic':
        return new DynamicPricingStrategy();
      default:
        throw new Error(`Unknown pricing strategy: ${name}`);
    }
  }

  /** Resolve strategy for a given plan type */
  static resolveStrategy(config: StrategyConfig): PricingStrategy {
    const strategyName =
      config.strategyOverride || PLAN_STRATEGY_MAP[config.planType] || 'flat_rate';
    return PricingStrategyFactory.getStrategy(strategyName);
  }

  /** Calculate price using the appropriate strategy for a plan type */
  static calculatePrice(config: StrategyConfig, context: PricingContext) {
    const strategy = PricingStrategyFactory.resolveStrategy(config);
    return strategy.calculatePrice(context);
  }

  /** Get analytics for all registered strategies */
  static getAllAnalytics(): PricingAnalytics[] {
    return Array.from(PricingStrategyFactory.instances.values()).map((s) => s.getAnalytics());
  }

  /** Get list of available strategy names */
  static getAvailableStrategies(): string[] {
    return ['flat_rate', 'usage_based', 'tiered', 'dynamic'];
  }

  /** Reset all strategy instances (for testing) */
  static reset(): void {
    PricingStrategyFactory.instances.clear();
  }
}
