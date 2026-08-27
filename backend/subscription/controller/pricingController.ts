/**
 * GET /pricing – public pricing tiers (CDN-cacheable).
 */

import { ok } from '../../services/shared/apiResponse';
import { SURROGATE_KEY } from '../../shared/cache/surrogateKeys';
import { publicDataStore } from '../store/publicDataStore';
import type { CacheableEndpointResult } from './types';

export interface PublicPricingTier {
  planId: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  discountPercent?: number;
}

export interface PricingDataProvider {
  getPublicPricing(): PublicPricingTier[] | Promise<PublicPricingTier[]>;
}

export const storePricingProvider: PricingDataProvider = {
  getPublicPricing: () => publicDataStore.listPricing(),
};

const DEFAULT_PRICING: PublicPricingTier[] = [
  { planId: 'free', monthlyPrice: 0, yearlyPrice: 0, currency: 'USD' },
  { planId: 'basic', monthlyPrice: 4.99, yearlyPrice: 49.99, currency: 'USD', discountPercent: 17 },
  { planId: 'premium', monthlyPrice: 9.99, yearlyPrice: 99.99, currency: 'USD', discountPercent: 17 },
  { planId: 'enterprise', monthlyPrice: 29.99, yearlyPrice: 299.99, currency: 'USD', discountPercent: 17 },
];

/** GET /pricing */
export async function getPublicPricing(
  provider: PricingDataProvider = storePricingProvider,
  requestId?: string,
): Promise<CacheableEndpointResult<PublicPricingTier[]>> {
  const tiers = await provider.getPublicPricing();

  return {
    response: ok(tiers, requestId),
    surrogateKeys: [SURROGATE_KEY.PRICING],
  };
}
