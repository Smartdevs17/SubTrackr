/**
 * Express router for subscription lifecycle operations.
 *
 *   GET    /subscriptions/:id/pause
 *   POST   /subscriptions/:id/pause
 *   POST   /subscriptions/:id/pause/preview
 *   POST   /subscriptions/:id/pause/resume
 *   POST   /subscriptions/batch
 *   GET    /subscriptions/batch/stats
 *   GET    /subscriptions/batch/:runId
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  getPauseState,
  pauseSubscription,
  previewPause,
  resumeSubscription,
} from '../controller/pauseController';
import { executeBatch, getBatchRun, getBatchStats } from '../controller/batchController';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

function send(res: Response, outcome: { status: number; response: unknown }): void {
  res.status(outcome.status).json(outcome.response);
}

export function createSubscriptionOpsRouter(): Router {
  const router = Router();

  // Static paths must be declared before the `/:id` routes.
  router.post(
    '/subscriptions/batch',
    asyncHandler(async (req, res) => {
      send(res, await executeBatch(req.body ?? {}, undefined));
    }),
  );

  router.get('/subscriptions/batch/stats', (req, res) => {
    send(res, getBatchStats(undefined));
  });

  router.get('/subscriptions/batch/:runId', (req, res) => {
    send(res, getBatchRun(req.params.runId, undefined));
  });

  router.get('/subscriptions/:id/pause', (req, res) => {
    send(res, getPauseState(req.params.id, undefined));
  });

  router.post(
    '/subscriptions/:id/pause',
    asyncHandler(async (req, res) => {
      send(res, pauseSubscription(req.params.id, req.body ?? {}, undefined));
    }),
  );

  router.post(
    '/subscriptions/:id/pause/preview',
    asyncHandler(async (req, res) => {
      send(res, previewPause(req.params.id, req.body ?? {}, undefined));
    }),
  );

  router.post(
    '/subscriptions/:id/pause/resume',
    asyncHandler(async (req, res) => {
      send(res, resumeSubscription(req.params.id, req.body ?? {}, undefined));
    }),
  );

  return router;
}
