/**
 * Express router for progressive dunning escalation APIs.
 *
 * Mount with: app.use('/dunning', createDunningEscalationRouter());
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  createDunningEscalationController,
  dunningEscalationController,
} from '../controller/dunningEscalationController';
import type { ProgressiveDunningEngine } from '../../../src/services/progressiveDunningEngine';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function createDunningEscalationRouter(
  controller = dunningEscalationController,
): Router {
  const router = Router();

  router.put(
    '/policies/:planId',
    asyncHandler((req, res) => {
      controller.putPolicy(req, res);
    }),
  );

  router.get(
    '/policies/:planId',
    asyncHandler((req, res) => {
      controller.getPolicy(req, res);
    }),
  );

  router.post(
    '/process-due',
    asyncHandler((req, res) => {
      controller.processDue(req, res);
    }),
  );

  router.get(
    '/analytics',
    asyncHandler((req, res) => {
      controller.getAnalytics(req, res);
    }),
  );

  router.get(
    '/optimize/:planId',
    asyncHandler((req, res) => {
      controller.optimize(req, res);
    }),
  );

  router.get(
    '/templates',
    asyncHandler((req, res) => {
      controller.getTemplates(req, res);
    }),
  );

  router.post(
    '/:subscriptionId/evaluate',
    asyncHandler((req, res) => {
      controller.evaluate(req, res);
    }),
  );

  return router;
}

/** Convenience factory that binds a custom engine instance. */
export function createDunningEscalationRouterWithEngine(
  engine: ProgressiveDunningEngine,
): Router {
  return createDunningEscalationRouter(createDunningEscalationController(engine));
}
