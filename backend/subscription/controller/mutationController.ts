/**
 * Mutation handlers that purge CDN edge cache by surrogate key on update.
 *
 * Purge failures are logged by the CDN client; TTL expiry clears stale
 * content eventually.
 */

import { ok, fail } from '../../services/shared/apiResponse';
import { purgeSurrogateKeys, type CdnPurgeClient } from '../../shared/cache';
import { SURROGATE_KEY } from '../../shared/cache/surrogateKeys';
import { publicDataStore } from '../store/publicDataStore';
import type { CacheableMutationResult } from './types';
import type { PublicPlan } from './plansController';
import type { PublicPricingTier } from './pricingController';

export interface UpdatePlanBody {
  name?: string;
  price?: number;
  currency?: string;
  billingCycle?: 'monthly' | 'yearly';
}

export interface UpdatePricingBody {
  monthlyPrice?: number;
  yearlyPrice?: number;
  discountPercent?: number;
}

export type MutationResult<T> =
  | { ok: true; result: CacheableMutationResult<T> }
  | { ok: false; response: ReturnType<typeof fail>; status: number };

/** PATCH /plans/:id – update plan and purge plan surrogate key. */
export async function updatePlan(
  planId: string,
  body: UpdatePlanBody,
  requestId?: string,
  purgeClient?: CdnPurgeClient,
): Promise<MutationResult<PublicPlan>> {
  const updated = publicDataStore.updatePlan(planId, body);
  if (!updated) {
    return {
      ok: false,
      response: fail('PLAN_NOT_FOUND', `Plan "${planId}" not found`, requestId),
      status: 404,
    };
  }

  await purgeSurrogateKeys([SURROGATE_KEY.PLAN, `${SURROGATE_KEY.PLAN}:${planId}`], purgeClient);

  return {
    ok: true,
    result: {
      response: ok(updated, requestId),
      purgeKeys: [SURROGATE_KEY.PLAN],
    },
  };
}

/** PATCH /pricing/:planId – update pricing and purge pricing surrogate key. */
export async function updatePricing(
  planId: string,
  body: UpdatePricingBody,
  requestId?: string,
  purgeClient?: CdnPurgeClient,
): Promise<MutationResult<PublicPricingTier>> {
  const updated = publicDataStore.updatePricing(planId, body);
  if (!updated) {
    return {
      ok: false,
      response: fail('PLAN_NOT_FOUND', `Pricing for plan "${planId}" not found`, requestId),
      status: 404,
    };
  }

  await purgeSurrogateKeys([SURROGATE_KEY.PRICING], purgeClient);

  return {
    ok: true,
    result: {
      response: ok(updated, requestId),
      purgeKeys: [SURROGATE_KEY.PRICING],
    },
  };
}

/** PATCH /features/:id – toggle feature and purge feature surrogate key. */
export async function updateFeature(
  featureId: string,
  enabled: boolean,
  requestId?: string,
  purgeClient?: CdnPurgeClient,
): Promise<MutationResult<{ id: string; enabled: boolean }>> {
  publicDataStore.setFeatureOverride(featureId, enabled);
  await purgeSurrogateKeys([SURROGATE_KEY.FEATURE], purgeClient);

  return {
    ok: true,
    result: {
      response: ok({ id: featureId, enabled }, requestId),
      purgeKeys: [SURROGATE_KEY.FEATURE],
    },
  };
}

/** PATCH /public/:path – update config and purge config surrogate key. */
export async function updatePublicConfig(
  configKey: string,
  value: unknown,
  requestId?: string,
  purgeClient?: CdnPurgeClient,
): Promise<CacheableMutationResult<{ key: string; value: unknown }>> {
  publicDataStore.updatePublicConfig(configKey, value);
  await purgeSurrogateKeys(
    [SURROGATE_KEY.CONFIG, `${SURROGATE_KEY.CONFIG}:${configKey}`],
    purgeClient,
  );

  return {
    response: ok({ key: configKey, value }, requestId),
    purgeKeys: [SURROGATE_KEY.CONFIG],
  };
}

/** Purge user-scoped cache entries (e.g. after profile update). */
export async function purgeUserCache(
  userId: string,
  purgeClient?: CdnPurgeClient,
): Promise<void> {
  await purgeSurrogateKeys([SURROGATE_KEY.USER, `${SURROGATE_KEY.USER}:${userId}`], purgeClient);
}
