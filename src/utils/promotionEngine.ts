import {
  AutomationTrigger,
  Campaign,
  CampaignAnalytics,
  CouponCode,
  CouponValidation,
  DiscountType,
  RedemptionContext,
  StackingRule,
  TargetAudience,
} from '../types/campaign';
import { CreditMemo, generateCreditMemo } from './proration';

// ── Coupon validation ───────────────────────────────────────────────────────

/**
 * Validates a coupon redemption attempt against its campaign's rules:
 * activation window, budget limits, plan eligibility, and quantity bounds.
 * Does not mutate any counters — callers apply the redemption separately.
 */
export function validateCouponRedemption(
  campaign: Campaign | undefined,
  coupon: CouponCode | undefined,
  context: RedemptionContext
): CouponValidation {
  if (!campaign || !coupon) {
    return { isValid: false, error: 'Coupon code not found' };
  }
  if (!coupon.isActive) {
    return { isValid: false, error: 'Coupon is no longer active' };
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
    return { isValid: false, error: 'Coupon has expired' };
  }
  if (coupon.usedCount >= coupon.maxUses) {
    return { isValid: false, error: 'Coupon has reached its maximum number of uses' };
  }
  if (context.userRedemptionCount >= coupon.maxUsesPerUser) {
    return {
      isValid: false,
      error: 'You have already used this coupon the maximum number of times',
    };
  }

  const rule = campaign.promotionRule;
  if (!rule) {
    return { isValid: false, error: 'Campaign has no promotion rule configured' };
  }

  if (
    rule.planIds &&
    rule.planIds.length > 0 &&
    context.planId &&
    !rule.planIds.includes(context.planId)
  ) {
    return { isValid: false, error: 'Coupon is not valid for this plan' };
  }
  if (rule.minPurchaseAmount != null && context.purchaseAmount < rule.minPurchaseAmount) {
    return {
      isValid: false,
      error: `Minimum purchase amount of ${rule.minPurchaseAmount} not met`,
    };
  }
  const quantity = context.quantity ?? 1;
  if (rule.minQuantity != null && quantity < rule.minQuantity) {
    return { isValid: false, error: `Minimum quantity of ${rule.minQuantity} required` };
  }
  if (rule.maxQuantity != null && quantity > rule.maxQuantity) {
    return { isValid: false, error: `Maximum quantity of ${rule.maxQuantity} exceeded` };
  }
  if (
    campaign.maxRedemptions != null &&
    (campaign.currentRedemptions ?? 0) >= campaign.maxRedemptions
  ) {
    return { isValid: false, error: 'Campaign has reached its redemption budget' };
  }

  const warnings: string[] = [];
  if (context.billingPeriodEnd && isRetroactiveRedemption(context.billingPeriodEnd)) {
    warnings.push(
      'Billing period has already closed — this will be applied as a credit memo, not a discount.'
    );
  }

  const { discountAmount, finalPrice } = calculateDiscountForRule(
    rule,
    context.purchaseAmount,
    quantity
  );

  return {
    isValid: true,
    campaign,
    coupon,
    discountAmount,
    finalPrice,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ── Stacking resolution ──────────────────────────────────────────────────────

/**
 * Resolves which campaigns actually apply together.
 * - NO_STACKING is exclusive: only the highest-priority (lowest `priority`) campaign applies.
 * - Other rules are additive: campaigns combine, ordered by priority, capped at maxStackingDepth.
 */
export function resolveStackableCampaigns(campaigns: Campaign[]): Campaign[] {
  if (campaigns.length === 0) return [];

  const sorted = [...campaigns].sort(
    (a, b) => (a.stackingConfig?.priority ?? 0) - (b.stackingConfig?.priority ?? 0)
  );

  const exclusive = sorted.find((c) => c.stackingConfig?.rule === StackingRule.NO_STACKING);
  if (exclusive) return [exclusive];

  const maxDepth = sorted.reduce(
    (min, c) =>
      c.stackingConfig?.maxStackingDepth ? Math.min(min, c.stackingConfig.maxStackingDepth) : min,
    sorted.length
  );

  return sorted.slice(0, maxDepth);
}

// ── Discount calculation ─────────────────────────────────────────────────────

function calculateDiscountForRule(
  rule: {
    discountType: DiscountType;
    discountValue: number;
    maxDiscountAmount?: number;
    bogoBuyQuantity?: number;
    bogoGetQuantity?: number;
  },
  price: number,
  quantity: number
): { discountAmount: number; finalPrice: number } {
  let discountAmount = 0;

  switch (rule.discountType) {
    case DiscountType.PERCENTAGE:
      discountAmount = price * (rule.discountValue / 100);
      break;
    case DiscountType.FIXED_AMOUNT:
      discountAmount = rule.discountValue;
      break;
    case DiscountType.FREE_MONTHS:
      // discountValue = number of free months; caller's `price` is one billing cycle's amount.
      discountAmount = price * rule.discountValue;
      break;
    case DiscountType.BOGO: {
      const buyQty = rule.bogoBuyQuantity ?? 1;
      const getQty = rule.bogoGetQuantity ?? 1;
      const unitPrice = quantity > 0 ? price / quantity : 0;
      const eligibleSets = Math.floor(quantity / (buyQty + getQty));
      const freeUnits = eligibleSets * getQty;
      discountAmount = unitPrice * freeUnits * (rule.discountValue / 100);
      break;
    }
    default:
      discountAmount = 0;
  }

  if (rule.maxDiscountAmount != null) {
    discountAmount = Math.min(discountAmount, rule.maxDiscountAmount);
  }
  // Edge case: a single rule (or the stack) can never discount more than the full price.
  discountAmount = Math.max(0, Math.min(discountAmount, price));

  return { discountAmount, finalPrice: Math.round((price - discountAmount) * 100) / 100 };
}

export interface StackedDiscountBreakdown {
  campaignId: string;
  discountType: DiscountType;
  amount: number;
}

export interface StackedDiscountResult {
  finalPrice: number;
  totalDiscount: number;
  breakdown: StackedDiscountBreakdown[];
  cappedAt100Percent: boolean;
}

/**
 * Applies every stackable campaign's discount in priority order against a
 * running price, capping the cumulative discount at 100% of the original
 * price (edge case: coupon stack exceeds 100% discount).
 */
export function calculateStackedDiscount(
  originalPrice: number,
  campaigns: Campaign[],
  quantity = 1
): StackedDiscountResult {
  const applicable = resolveStackableCampaigns(campaigns).filter((c) => c.promotionRule);
  const breakdown: StackedDiscountBreakdown[] = [];
  let runningPrice = originalPrice;
  let totalDiscount = 0;

  for (const campaign of applicable) {
    const rule = campaign.promotionRule!;
    const { discountAmount } = calculateDiscountForRule(rule, runningPrice, quantity);
    breakdown.push({
      campaignId: campaign.id,
      discountType: rule.discountType,
      amount: discountAmount,
    });
    totalDiscount += discountAmount;
    runningPrice = Math.max(0, runningPrice - discountAmount);
  }

  const cappedAt100Percent = totalDiscount >= originalPrice && originalPrice > 0;
  totalDiscount = Math.min(totalDiscount, originalPrice);

  return {
    finalPrice: Math.round((originalPrice - totalDiscount) * 100) / 100,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    breakdown,
    cappedAt100Percent,
  };
}

// ── Auto-promotion ───────────────────────────────────────────────────────────

export interface AutoPromotionTrigger {
  cartValue?: number;
  planId?: string;
  isReferral?: boolean;
}

/** Returns campaigns that auto-apply given the current checkout context. */
export function checkAutoPromotionEligibility(
  campaigns: Campaign[],
  trigger: AutoPromotionTrigger
): Campaign[] {
  return campaigns.filter((campaign) => {
    const rule = campaign.promotionRule;
    if (!rule) return false;

    const automations = campaign.automations ?? [];
    const isReferralCampaign = automations.some(
      (a) => a.trigger === AutomationTrigger.REFERRAL_SIGNUP
    );
    const isCartValueCampaign = automations.some(
      (a) => a.trigger === AutomationTrigger.CART_VALUE_THRESHOLD
    );

    if (isReferralCampaign) return Boolean(trigger.isReferral);
    if (isCartValueCampaign) {
      return (
        trigger.cartValue != null &&
        rule.minPurchaseAmount != null &&
        trigger.cartValue >= rule.minPurchaseAmount
      );
    }
    if (rule.planIds && rule.planIds.length > 0) {
      return Boolean(trigger.planId && rule.planIds.includes(trigger.planId));
    }
    return false;
  });
}

// ── Retroactive application ──────────────────────────────────────────────────

export function isRetroactiveRedemption(billingPeriodEnd: Date, now: Date = new Date()): boolean {
  return new Date(billingPeriodEnd) < now;
}

/** When a coupon is redeemed against an already-closed period, issue a credit memo instead of a live discount. */
export function buildRetroactiveCreditMemo(
  subscriptionId: string,
  discountAmount: number,
  campaignName: string
): CreditMemo {
  return generateCreditMemo(
    subscriptionId,
    discountAmount,
    `Retroactive promotion credit: ${campaignName}`
  );
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/** Computes redemption-rate and cannibalization-rate analytics for a campaign. */
export function calculatePromotionAnalytics(
  campaign: Campaign
): Pick<CampaignAnalytics, 'redemptionRate' | 'cannibalizationRate'> {
  const redemptions = campaign.analytics?.couponRedemptions ?? campaign.currentRedemptions ?? 0;
  const redemptionRate = campaign.maxRedemptions ? redemptions / campaign.maxRedemptions : 0;

  // Existing-customer audiences are more likely to have converted anyway —
  // treat their share of redemptions as cannibalized revenue.
  const audience = campaign.targeting?.audience;
  const cannibalizationRate =
    audience === TargetAudience.EXISTING_CUSTOMERS || audience === TargetAudience.ALL_CUSTOMERS
      ? 0.5
      : 0.05;

  return { redemptionRate: Math.round(redemptionRate * 1000) / 1000, cannibalizationRate };
}
