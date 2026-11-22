/**
 * Typed errors for the pricing module.
 *
 * Each factory method captures structured context so callers can
 * log or surface a consistent, machine-readable payload.
 */

export const PricingErrorCode = {
  PLAN_NOT_FOUND: 'PRICING_PLAN_NOT_FOUND',
  STRATEGY_NOT_FOUND: 'PRICING_STRATEGY_NOT_FOUND',
  CALCULATION_FAILED: 'PRICING_CALCULATION_FAILED',
  INVALID_INPUT: 'PRICING_INVALID_INPUT',
  PRORATION_FAILED: 'PRICING_PRORATION_FAILED',
  CACHE_ERROR: 'PRICING_CACHE_ERROR',
} as const;

export type PricingErrorCode = (typeof PricingErrorCode)[keyof typeof PricingErrorCode];

export class PricingError extends Error {
  readonly code: PricingErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: PricingErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
    this.details = details;
  }

  static planNotFound(planId: string): PricingError {
    return new PricingError(
      PricingErrorCode.PLAN_NOT_FOUND,
      `Plan not found: ${planId}`,
      { planId },
    );
  }

  static strategyNotFound(name: string): PricingError {
    return new PricingError(
      PricingErrorCode.STRATEGY_NOT_FOUND,
      `Pricing strategy not found: ${name}`,
      { name },
    );
  }

  static calculationFailed(subscriptionId: string, reason: string): PricingError {
    return new PricingError(
      PricingErrorCode.CALCULATION_FAILED,
      `Price calculation failed for ${subscriptionId}: ${reason}`,
      { subscriptionId, reason },
    );
  }

  static invalidInput(field: string, reason: string): PricingError {
    return new PricingError(
      PricingErrorCode.INVALID_INPUT,
      `Invalid pricing input for field "${field}": ${reason}`,
      { field, reason },
    );
  }

  static prorationFailed(subscriptionId: string, reason: string): PricingError {
    return new PricingError(
      PricingErrorCode.PRORATION_FAILED,
      `Proration failed for ${subscriptionId}: ${reason}`,
      { subscriptionId, reason },
    );
  }
}
