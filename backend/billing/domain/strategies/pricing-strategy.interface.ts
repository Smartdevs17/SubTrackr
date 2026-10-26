/**
 * PricingStrategy Interface
 *
 * Defines the contract for pricing calculation strategies.
 * Each strategy handles a specific pricing model (flat, per-seat, usage-based, tiered, etc.).
 *
 * This interface enables the strategy pattern for pluggable pricing calculations,
 * allowing new pricing models to be added without modifying existing code.
 *
 * Performance requirement: Each calculate() call must complete in <5ms.
 */

export interface Usage {
  /** Unique identifier for the usage record */
  id: string;
  /** Units consumed (for usage-based models) */
  unitsConsumed: number;
  /** Number of seats/users (for per-seat models) */
  seatCount: number;
  /** Additional properties for model-specific calculations */
  [key: string]: any;
}

export interface Plan {
  /** Unique identifier for the plan */
  id: string;
  /** Plan type code (e.g., 'flat', 'per-seat', 'usage-based', 'tiered') */
  typeCode: string;
  /** Base price of the plan */
  basePrice: number;
  /** Currency code (e.g., 'USD') */
  currency: string;
  /** Model-specific configuration */
  config?: {
    [key: string]: any;
  };
}

export interface Subscriber {
  /** Unique identifier for the subscriber */
  id: string;
  /** Subscription identifier */
  subscriptionId: string;
  /** Additional properties for model-specific calculations */
  [key: string]: any;
}

export interface Amount {
  /** Calculated amount in the subscription currency */
  value: number;
  /** Currency code */
  currency: string;
  /** Breakdown of calculation (for transparency) */
  breakdown?: {
    [key: string]: number;
  };
}

/**
 * PricingStrategy - Core interface for calculating subscription charges.
 *
 * Implementations should:
 * 1. Be stateless (can be reused across multiple calculations)
 * 2. Complete in <5ms for typical inputs
 * 3. Handle edge cases (null, zero, negative values)
 * 4. Return consistent, predictable results
 */
export interface PricingStrategy {
  /**
   * Calculate the charge amount for given inputs.
   *
   * @param usage - Metering data and usage details
   * @param plan - Subscription plan with type-specific configuration
   * @param subscriber - Subscriber information
   * @returns Amount with value and currency
   * @throws Error if calculation fails or inputs are invalid
   */
  calculate(usage: Usage, plan: Plan, subscriber: Subscriber): Amount;

  /**
   * Get human-readable name of the strategy
   */
  getName(): string;
}
