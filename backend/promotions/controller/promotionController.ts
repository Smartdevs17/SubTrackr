/**
 * POST /v1/checkout/apply-discount — validates a coupon and resolves it
 * against any auto-applying campaigns to produce the final checkout price.
 * Mirrors the envelope conventions used by other backend controllers.
 */
import type { Request, Response } from 'express';
import { fail, ok } from '../../services/shared/apiResponse';
import { Campaign, RedemptionContext } from '../../../src/types/campaign';
import { checkAutoPromotionEligibility } from '../../../src/utils/promotionEngine';
import { PromotionEngine } from '../domain/PromotionEngine';

export interface ApplyDiscountRequestBody {
  couponCode?: string;
  purchaseAmount: number;
  quantity?: number;
  planId?: string;
  cartValue?: number;
  isReferral?: boolean;
  context: RedemptionContext;
}

export async function handleApplyDiscount(
  req: Request,
  res: Response,
  engine: PromotionEngine,
  allCampaigns: Campaign[]
): Promise<void> {
  const requestId = (req.headers['x-request-id'] as string) ?? undefined;
  const body = req.body as ApplyDiscountRequestBody;

  if (!body || typeof body.purchaseAmount !== 'number' || !body.context) {
    res.status(422).json(fail('VALIDATION_ERROR', 'purchaseAmount and context are required', requestId));
    return;
  }

  let couponValidation;
  if (body.couponCode) {
    couponValidation = engine.validate(body.couponCode, body.context);
    if (!couponValidation.isValid) {
      res.status(422).json(fail('COUPON_INVALID', couponValidation.error ?? 'Invalid coupon', requestId));
      return;
    }
  }

  const autoApply = checkAutoPromotionEligibility(allCampaigns, {
    cartValue: body.cartValue,
    planId: body.planId,
    isReferral: body.isReferral,
  });

  const result = engine.applyAtCheckout(body.purchaseAmount, autoApply, couponValidation, body.quantity ?? 1);

  res.status(200).json(ok({ ...result, appliedCouponCode: body.couponCode, autoAppliedCampaignIds: autoApply.map((c) => c.id) }, requestId));
}
