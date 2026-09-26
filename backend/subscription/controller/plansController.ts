/**
 * GET /plans – list available subscription plans (CDN-cacheable).
 */

import { ok } from '../../services/shared/apiResponse';
import { SURROGATE_KEY, scopedSurrogateKey } from '../../shared/cache/surrogateKeys';
import { publicDataStore } from '../store/publicDataStore';
import type { CacheableEndpointResult } from './types';

export interface PublicPlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  billingCycle: 'monthly' | 'yearly';
}

export interface PlansDataProvider {
  listPlans(): PublicPlan[] | Promise<PublicPlan[]>;
  getPlan?(id: string): PublicPlan | undefined | Promise<PublicPlan | undefined>;
}

export const storePlansProvider: PlansDataProvider = {
  listPlans: () => publicDataStore.listPlans(),
  getPlan: (id) => publicDataStore.getPlan(id),
};

const DEFAULT_PLANS: PublicPlan[] = [
  { id: 'free', name: 'Free', price: 0, currency: 'USD', billingCycle: 'monthly' },
  { id: 'basic', name: 'Basic', price: 4.99, currency: 'USD', billingCycle: 'monthly' },
  { id: 'premium', name: 'Premium', price: 9.99, currency: 'USD', billingCycle: 'monthly' },
  { id: 'enterprise', name: 'Enterprise', price: 29.99, currency: 'USD', billingCycle: 'monthly' },
];

/** GET /plans */
export async function getPlans(
  provider: PlansDataProvider = storePlansProvider,
  requestId?: string,
): Promise<CacheableEndpointResult<PublicPlan[]>> {
  const plans = await provider.listPlans();
  const surrogateKeys = [SURROGATE_KEY.PLAN, ...plans.map((p) => scopedSurrogateKey(SURROGATE_KEY.PLAN, p.id))];

  return {
    response: ok(plans, requestId),
    surrogateKeys,
  };
}

/** GET /plans/:id */
export async function getPlanById(
  planId: string,
  provider: PlansDataProvider = storePlansProvider,
  requestId?: string,
): Promise<CacheableEndpointResult<PublicPlan> | null> {
  if (provider.getPlan) {
    const plan = await provider.getPlan(planId);
    if (!plan) return null;
    return {
      response: ok(plan, requestId),
      surrogateKeys: [SURROGATE_KEY.PLAN, scopedSurrogateKey(SURROGATE_KEY.PLAN, plan.id)],
    };
  }

  const plans = await provider.listPlans();
  const plan = plans.find((p) => p.id === planId);
  if (!plan) {
    return null;
  }

  return {
    response: ok(plan, requestId),
    surrogateKeys: [SURROGATE_KEY.PLAN, scopedSurrogateKey(SURROGATE_KEY.PLAN, plan.id)],
  };
}
