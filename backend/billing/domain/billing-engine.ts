/**
 * BillingEngine
 *
 * Core billing calculation engine using the strategy pattern for pluggable pricing models.
 * Delegates pricing calculations to registered strategies based on plan type.
 *
 * Performance: Each calculate() call must complete in <5ms.
 * This is achieved by using O(1) or O(n) strategies where n is small (typically <10 tiers).
 */

import type { Amount, Plan, Subscriber, Usage } from './strategies/pricing-strategy.interface';
import { getStrategyRegistry } from './strategy-registry';

export class BillingEngine {
  /**
   * Calculate the charge amount for a given subscription
   *
   * @param usage - Usage and metering data
   * @param plan - Subscription plan with type code and config
   * @param subscriber - Subscriber information
   * @returns Calculated amount with breakdown
   * @throws Error if calculation fails or inputs are invalid
   */
  calculate(usage: Usage, plan: Plan, subscriber: Subscriber): Amount {
    if (!plan) {
      throw new Error('Plan is required for billing calculation');
    }

    // Get the appropriate strategy based on plan type
    const registry = getStrategyRegistry();
    const strategy = registry.getStrategy(plan.typeCode);

    // Delegate to the strategy for actual calculation
    // Performance requirement: This must complete in <5ms total
    return strategy.calculate(usage, plan, subscriber);
  }

  /**
   * Get available pricing models
   *
   * @returns List of registered plan type codes
   */
  getAvailablePricingModels(): string[] {
    const registry = getStrategyRegistry();
    return registry.getRegisteredTypes();
  }
}

// Export singleton instance for dependency injection
export const billingEngine = new BillingEngine();
