import { CouponCode, CouponValidation } from '../types/campaign';

/**
 * CouponService - Client-side coupon validation and application
 */
export class CouponService {
  private static appliedCoupons: Map<string, CouponCode[]> = new Map();

  /**
   * Validate a coupon code for a subscription
   */
  static async validateCoupon(
    code: string,
    subscriptionId: string,
    context?: {
      originalPrice?: number;
      planId?: string;
      userId?: string;
    }
  ): Promise<CouponValidation> {
    try {
      // In a real app, this would call the backend API
      // For now, we'll simulate validation
      const mockValidation: CouponValidation = {
        isValid: true,
        discountAmount: context?.originalPrice ? context.originalPrice * 0.2 : 0,
        finalPrice: context?.originalPrice ? context.originalPrice * 0.8 : 0,
        warnings: [],
      };

      return mockValidation;
    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Coupon validation failed',
      };
    }
  }

  /**
   * Apply coupon to subscription
   */
  static async applyCoupon(code: string, subscriptionId: string): Promise<void> {
    const validation = await this.validateCoupon(code, subscriptionId);

    if (!validation.isValid) {
      throw new Error(validation.error || 'Invalid coupon');
    }

    // Track applied coupon
    const existing = this.appliedCoupons.get(subscriptionId) || [];
    this.appliedCoupons.set(subscriptionId, [...existing, validation.coupon!]);
  }

  /**
   * Remove coupon from subscription
   */
  static async removeCoupon(subscriptionId: string): Promise<void> {
    this.appliedCoupons.delete(subscriptionId);
  }

  /**
   * Get applied coupons for subscription
   */
  static async getAppliedCoupons(subscriptionId: string): Promise<CouponCode[]> {
    return this.appliedCoupons.get(subscriptionId) || [];
  }

  /**
   * Calculate final price with all discounts
   */
  static async calculateFinalPrice(
    originalPrice: number,
    subscriptionId: string,
    _planId: string
  ): Promise<number> {
    const coupons = await this.getAppliedCoupons(subscriptionId);

    if (coupons.length === 0) {
      return originalPrice;
    }

    // Apply first coupon only (no stacking by default)
    // This would need campaign data to calculate properly
    return originalPrice;
  }
}
