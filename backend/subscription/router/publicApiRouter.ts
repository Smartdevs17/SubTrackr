/**
 * Express router for CDN-cacheable public subscription API endpoints.
 *
 *   GET    /plans
 *   GET    /plans/:id
 *   PATCH  /plans/:id
 *   GET    /pricing
 *   PATCH  /pricing/:planId
 *   GET    /features
 *   PATCH  /features/:id
 *   GET    /public/*
 *   PATCH  /public/*
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { fail } from '../../services/shared/apiResponse';
import {
  extractRequestId,
  getPlans,
  getPlanById,
  getPublicPricing,
  getFeatures,
  getPublicConfig,
  sendCacheableResponse,
  updatePlan,
  updatePricing,
  updateFeature,
  updatePublicConfig,
  type MutationResult,
} from '../controller';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

function sendMutation<T>(res: Response, outcome: MutationResult<T>): void {
  if (outcome.ok === false) {
    res.status(outcome.status).json(outcome.response);
    return;
  }
  res.status(200).json(outcome.result.response);
}

export function createPublicApiRouter(): Router {
  const router = Router();

  // ── Plans ─────────────────────────────────────────────────────────────────

  router.get(
    '/plans',
    asyncHandler(async (req, res) => {
      const result = await getPlans(undefined, extractRequestId(req));
      sendCacheableResponse(res, result, req);
    }),
  );

  router.get(
    '/plans/:id',
    asyncHandler(async (req, res) => {
      const result = await getPlanById(req.params.id, undefined, extractRequestId(req));
      if (!result) {
        res.status(404).json(fail('PLAN_NOT_FOUND', `Plan "${req.params.id}" not found`, extractRequestId(req)));
        return;
      }
      sendCacheableResponse(res, result, req);
    }),
  );

  router.patch(
    '/plans/:id',
    asyncHandler(async (req, res) => {
      const outcome = await updatePlan(req.params.id, req.body, extractRequestId(req));
      sendMutation(res, outcome);
    }),
  );

  // ── Pricing ───────────────────────────────────────────────────────────────

  router.get(
    '/pricing',
    asyncHandler(async (req, res) => {
      const result = await getPublicPricing(undefined, extractRequestId(req));
      sendCacheableResponse(res, result, req);
    }),
  );

  router.patch(
    '/pricing/:planId',
    asyncHandler(async (req, res) => {
      const outcome = await updatePricing(req.params.planId, req.body, extractRequestId(req));
      sendMutation(res, outcome);
    }),
  );

  // ── Features ──────────────────────────────────────────────────────────────

  router.get('/features', (req, res) => {
    const result = getFeatures(undefined, extractRequestId(req));
    sendCacheableResponse(res, result, req);
  });

  router.patch(
    '/features/:id',
    asyncHandler(async (req, res) => {
      if (typeof req.body?.enabled !== 'boolean') {
        res
          .status(400)
          .json(fail('BAD_REQUEST', 'Body must include boolean "enabled"', extractRequestId(req)));
        return;
      }
      const outcome = await updateFeature(req.params.id, req.body.enabled, extractRequestId(req));
      sendMutation(res, outcome);
    }),
  );

  // ── Public config ─────────────────────────────────────────────────────────

  router.get(
    /^\/public(\/.*)?$/,
    (req, res) => {
      const resourcePath = req.path.replace(/^\/public\/?/, '');
      const result = getPublicConfig(resourcePath, extractRequestId(req));
      sendCacheableResponse(res, result, req);
    },
  );

  router.patch(
    /^\/public\/(.+)/,
    asyncHandler(async (req, res) => {
      const configKey = decodeURIComponent(req.path.replace(/^\/public\//, ''));
      const outcome = await updatePublicConfig(configKey, req.body?.value, extractRequestId(req));
      res.status(200).json(outcome.response);
    }),
  );

  return router;
}
