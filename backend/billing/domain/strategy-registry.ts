/**
 * StrategyRegistry
 *
 * Central registry for pricing strategies, enabling dynamic lookup by plan type.
 * Supports registration of custom strategies and falls back to a safe default
 * for unknown plan types.
 *
 * The registry is singleton and thread-safe (strategies are immutable).
 */

import type { PricingStrategy } from './strategies/pricing-strategy.interface';
import {
  FlatPricingStrategy,
  PerSeatPricingStrategy,
  UsageBasedPricingStrategy,
  TieredPricingStrategy,
  FallbackPricingStrategy,
} from './strategies';

export class StrategyRegistry {
  private strategies = new Map<string, PricingStrategy>();
  private fallbackStrategy: PricingStrategy;

  constructor() {
    this.fallbackStrategy = new FallbackPricingStrategy();

    // Pre-register all built-in strategies
    this.register('flat', new FlatPricingStrategy());
    this.register('per-seat', new PerSeatPricingStrategy());
    this.register('usage-based', new UsageBasedPricingStrategy());
    this.register('tiered', new TieredPricingStrategy());
  }

  /**
   * Register a pricing strategy by plan type code
   *
   * @param planTypeCode - Unique identifier for the plan type (e.g., 'flat', 'usage-based')
   * @param strategy - Strategy implementation
   * @throws Error if planTypeCode is empty or strategy is null
   */
  register(planTypeCode: string, strategy: PricingStrategy): void {
    if (!planTypeCode || typeof planTypeCode !== 'string') {
      throw new Error('Plan type code must be a non-empty string');
    }

    if (!strategy) {
      throw new Error('Strategy cannot be null or undefined');
    }

    this.strategies.set(planTypeCode.toLowerCase(), strategy);
  }

  /**
   * Get a strategy by plan type code, falling back to FallbackPricingStrategy
   * if the type is not found.
   *
   * @param planTypeCode - Plan type code to lookup
   * @returns Strategy implementation (never null)
   */
  getStrategy(planTypeCode: string): PricingStrategy {
    const normalizedCode = planTypeCode ? planTypeCode.toLowerCase() : '';

    if (!normalizedCode) {
      return this.fallbackStrategy;
    }

    const strategy = this.strategies.get(normalizedCode);
    return strategy ?? this.fallbackStrategy;
  }

  /**
   * Check if a strategy is registered for the given plan type
   *
   * @param planTypeCode - Plan type code to check
   * @returns true if a specific strategy is registered (not the fallback)
   */
  hasStrategy(planTypeCode: string): boolean {
    const normalizedCode = planTypeCode ? planTypeCode.toLowerCase() : '';
    return this.strategies.has(normalizedCode);
  }

  /**
   * Get all registered strategy type codes (excluding fallback)
   *
   * @returns Array of registered plan type codes
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Set a custom fallback strategy (advanced use only)
   *
   * @param strategy - Custom fallback strategy
   */
  setFallbackStrategy(strategy: PricingStrategy): void {
    if (!strategy) {
      throw new Error('Fallback strategy cannot be null or undefined');
    }
    this.fallbackStrategy = strategy;
  }

  /**
   * Clear all registered strategies (except fallback) - useful for testing
   */
  clear(): void {
    this.strategies.clear();
  }
}

// Global singleton instance
let globalRegistry: StrategyRegistry | null = null;

/**
 * Get the global singleton registry instance
 */
export function getStrategyRegistry(): StrategyRegistry {
  if (!globalRegistry) {
    globalRegistry = new StrategyRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global registry - use only in tests
 */
export function resetStrategyRegistry(): void {
  globalRegistry = null;
}
