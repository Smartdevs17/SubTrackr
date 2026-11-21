/**
 * Asset Policy Router – per-merchant allowlist/denylist endpoints.
 *
 * Routes:
 *   GET  /merchants/:merchantId/asset-policy
 *   PUT  /merchants/:merchantId/asset-policy
 *   POST /payments/assets/check
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1717
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  AssetPolicyController,
  assetPolicyController as defaultController,
} from '../controller/assetPolicyController';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => void;

function wrap(fn: (req: Request, res: Response) => void | Promise<void>): AsyncHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function createAssetPolicyRouter(
  controller: AssetPolicyController = defaultController,
): Router {
  const router = Router();

  router.get(
    '/merchants/:merchantId/asset-policy',
    wrap((req, res) => controller.getPolicy(req, res)),
  );

  router.put(
    '/merchants/:merchantId/asset-policy',
    wrap((req, res) => controller.setPolicy(req, res)),
  );

  router.post(
    '/payments/assets/check',
    wrap((req, res) => controller.checkAsset(req, res)),
  );

  return router;
}

export default createAssetPolicyRouter;
