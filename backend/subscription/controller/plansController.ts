/**
 * GET /plans – list available subscription plans (CDN-cacheable).
 */

import { ok } from '../../services/shared/apiResponse';
import { buildPage, decodeCursor, type PageOptions } from '../../services/shared/pagination';
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

export interface ListPlansOptions extends PageOptions {
  page?: number;
}

/** GET /plans with stable ordering and bounded cursor pagination */
export async function getPlans(
  provider: PlansDataProvider = storePlansProvider,
  requestId?: string,
  options: ListPlansOptions = {},
): Promise<CacheableEndpointResult<PublicPlan[]>> {
  const allPlans = await provider.listPlans();
  const sorted = [...allPlans].sort((a, b) => a.id.localeCompare(b.id));

  const rawLimit = options.limit ?? 20;
  const limit = Math.min(Math.max(1, rawLimit), options.maxLimit ?? 100);

  let startIndex = 0;
  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    if (decoded) {
      const idx = sorted.findIndex((p) => p.id === decoded.id);
      if (idx !== -1) {
        startIndex = idx + 1;
      }
    }
  } else if (options.page && options.page > 1) {
    startIndex = (options.page - 1) * limit;
  }

  const pagedRows = sorted.slice(startIndex, startIndex + limit + 1);
  const pageResult = buildPage(
    pagedRows,
    limit,
    (row) => row.id,
    (row) => row.id,
    options.direction ?? 'asc',
    'id',
    sorted.length,
  );

  const surrogateKeys = [SURROGATE_KEY.PLAN, ...pageResult.items.map((p) => scopedSurrogateKey(SURROGATE_KEY.PLAN, p.id))];

  return {
    response: ok(pageResult.items, requestId, {
      cursor: pageResult.nextCursor,
      hasMore: pageResult.hasMore,
      total: sorted.length,
    }),
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
