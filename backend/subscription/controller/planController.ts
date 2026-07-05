/**
 * Plan REST API handlers (framework-agnostic).
 *
 * Endpoints:
 *   GET    /plans/:id        – get plan metadata (cache-backed)
 *   POST   /plans            – create plan (write-through cache)
 *   PATCH  /plans/:id        – update plan (write-through cache)
 *   DELETE /plans/:id        – deactivate plan (invalidate cache)
 */

import type { PlanCacheService } from '../domain/PlanCacheService';
import type { CreatePlanInput, UpdatePlanInput } from '../domain/types';

export interface PlanControllerDeps {
  planCache: PlanCacheService;
}

function ok(data: unknown) {
  return { success: true, data };
}

function err(message: string, status = 400) {
  return { success: false, error: { message }, status };
}

export function createPlanController(deps: PlanControllerDeps) {
  const { planCache } = deps;

  return {
    /** GET /plans/:id */
    async getPlan(id: string) {
      if (!id?.trim()) {
        return err('Plan id is required');
      }

      const plan = await planCache.getPlan(id);
      if (!plan) {
        return err('Plan not found', 404);
      }
      if (!plan.isActive) {
        return err('Plan is inactive', 409);
      }

      return ok(plan);
    },

    /** POST /plans */
    async createPlan(body: CreatePlanInput) {
      if (!body?.name?.trim()) {
        return err('Body must include "name"');
      }
      if (typeof body.price !== 'number' || body.price < 0) {
        return err('Body must include valid "price"');
      }
      if (!body.currency?.trim() || !body.billingCycle?.trim()) {
        return err('Body must include "currency" and "billingCycle"');
      }

      const plan = await planCache.writeThroughCreate(body);
      return ok(plan);
    },

    /** PATCH /plans/:id */
    async updatePlan(id: string, body: UpdatePlanInput) {
      if (!id?.trim()) {
        return err('Plan id is required');
      }
      if (!body || Object.keys(body).length === 0) {
        return err('Body must include at least one field to update');
      }
      if (body.price !== undefined && (typeof body.price !== 'number' || body.price < 0)) {
        return err('Invalid "price"');
      }

      const plan = await planCache.writeThroughUpdate(id, body);
      if (!plan) {
        return err('Plan not found', 404);
      }

      return ok(plan);
    },

    /** DELETE /plans/:id — soft-deactivate */
    async deactivatePlan(id: string) {
      if (!id?.trim()) {
        return err('Plan id is required');
      }

      const plan = await planCache.writeThroughDeactivate(id);
      if (!plan) {
        return err('Plan not found', 404);
      }

      return ok(plan);
    },
  };
}

export type PlanController = ReturnType<typeof createPlanController>;
