import { Campaign, CouponCode, CouponValidation, RedemptionContext } from '../../../src/types/campaign';
import {
  calculateStackedDiscount,
  resolveStackableCampaigns,
  validateCouponRedemption,
} from '../../../src/utils/promotionEngine';

/**
 * Server-side promotion engine: validates and redeems coupons against a
 * campaign store, and resolves stacked discounts at checkout.
 */
export class PromotionEngine {
  constructor(private campaigns: Campaign[] = []) {}

  setCampaigns(campaigns: Campaign[]): void {
    this.campaigns = campaigns;
  }

  findCampaignAndCoupon(code: string): { campaign?: Campaign; coupon?: CouponCode } {
    const campaign = this.campaigns.find((c) => c.couponCodes?.some((cc) => cc.code === code));
    const coupon = campaign?.couponCodes?.find((cc) => cc.code === code);
    return { campaign, coupon };
  }

  validate(code: string, context: RedemptionContext): CouponValidation {
    const { campaign, coupon } = this.findCampaignAndCoupon(code);
    return validateCouponRedemption(campaign, coupon, context);
  }

  /** Applies the validated discount at checkout, combining it with any auto-applied campaigns. */
  applyAtCheckout(
    purchaseAmount: number,
    autoApplyCampaigns: Campaign[],
    couponValidation?: CouponValidation,
    quantity = 1
  ): { finalPrice: number; totalDiscount: number } {
    const campaigns = [...autoApplyCampaigns];
    if (couponValidation?.isValid && couponValidation.campaign) {
      campaigns.push(couponValidation.campaign);
    }
    const resolved = resolveStackableCampaigns(campaigns);
    return calculateStackedDiscount(purchaseAmount, resolved, quantity);
  }
}

export const promotionEngine = new PromotionEngine();
