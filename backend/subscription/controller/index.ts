import type { Request, Response } from 'express';
import {
  applyCacheHeaders,
  resolveTtlFromRequest,
} from '../../shared/middleware/cacheHeaders';
import { REQUEST_ID_HEADER } from '../../services/shared/apiResponse';
import type { CacheableEndpointResult } from './types';

export { getPlans, getPlanById } from './plansController';
export type { PublicPlan, PlansDataProvider } from './plansController';

export { getPublicPricing } from './pricingController';
export type { PublicPricingTier, PricingDataProvider } from './pricingController';

export { getFeatures } from './featuresController';
export type { PublicFeatureSummary, FeaturesDataProvider } from './featuresController';

export { getPublicConfig } from './publicController';
export type { PublicConfigEntry } from './publicController';

export {
  updatePlan,
  updatePricing,
  updateFeature,
  updatePublicConfig,
  purgeUserCache,
} from './mutationController';
export type { UpdatePlanBody, UpdatePricingBody, MutationResult } from './mutationController';

export type { CacheableEndpointResult, CacheableMutationResult } from './types';

/** Extract request ID from incoming headers. */
export function extractRequestId(req: Pick<Request, 'headers'>): string | undefined {
  const raw = req.headers[REQUEST_ID_HEADER] ?? req.headers[REQUEST_ID_HEADER.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Send a cacheable GET response with CDN edge-cache headers applied.
 */
export function sendCacheableResponse<T>(
  res: Response,
  result: CacheableEndpointResult<T>,
  req?: Pick<Request, 'headers'>,
): void {
  const ttl = result.cacheTtlSeconds ?? (req ? resolveTtlFromRequest(req) : undefined);

  applyCacheHeaders(res, {
    ttlSeconds: ttl,
    surrogateKeys: result.surrogateKeys,
  });

  res.locals.surrogateKeys = result.surrogateKeys;

  res.status(result.httpStatus ?? 200).json(result.response);
}
