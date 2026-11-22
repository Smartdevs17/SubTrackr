/**
 * Trial Router – trial period management with conversion tracking.
 *
 * Routes:
 *   POST   /subscriptions/:id/trial              – start trial
 *   POST   /trials/:trialId/convert               – convert trial to paid
 *   POST   /trials/:trialId/cancel                – cancel trial
 *   POST   /trials/:trialId/extend                – extend trial
 *   PATCH  /trials/:trialId/engagement            – update engagement score
 *   POST   /trials/:trialId/events                – track funnel event
 *   GET    /trials/:trialId                        – get trial details
 *   GET    /subscriptions/:id/trial               – get active trial for subscription
 *   GET    /users/:userId/trials                   – list trials for user
 *   GET    /trials/analytics                       – conversion analytics
 *   GET    /trials/extensions/rules                – list extension rules
 *   PATCH  /trials/extensions/:ruleId              – toggle extension rule
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1118
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  TrialController,
  trialController as defaultController,
} from '../controller/trialController';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => void;

function wrap(fn: (req: Request, res: Response) => void): AsyncHandler {
  return (req, res, next) => {
    try {
      fn(req, res);
    } catch (err) {
      next(err);
    }
  };
}

export function createTrialRouter(
  controller: TrialController = defaultController,
): Router {
  const router = Router();

  router.post(
    '/subscriptions/:id/trial',
    wrap((req, res) => controller.startTrial(req, res)),
  );

  router.post(
    '/trials/:trialId/convert',
    wrap((req, res) => controller.convert(req, res)),
  );

  router.post(
    '/trials/:trialId/cancel',
    wrap((req, res) => controller.cancel(req, res)),
  );

  router.post(
    '/trials/:trialId/extend',
    wrap((req, res) => controller.extend(req, res)),
  );

  router.patch(
    '/trials/:trialId/engagement',
    wrap((req, res) => controller.updateEngagement(req, res)),
  );

  router.post(
    '/trials/:trialId/events',
    wrap((req, res) => controller.trackEvent(req, res)),
  );

  router.get(
    '/trials/:trialId',
    wrap((req, res) => controller.getTrial(req, res)),
  );

  router.get(
    '/subscriptions/:id/trial',
    wrap((req, res) => controller.getBySubscription(req, res)),
  );

  router.get(
    '/users/:userId/trials',
    wrap((req, res) => controller.listByUser(req, res)),
  );

  router.get(
    '/trials/analytics',
    wrap((req, res) => controller.analytics(req, res)),
  );

  router.get(
    '/trials/extensions/rules',
    wrap((req, res) => controller.extensionRules(req, res)),
  );

  router.patch(
    '/trials/extensions/:ruleId',
    wrap((req, res) => controller.toggleExtensionRule(req, res)),
  );

  return router;
}

export default createTrialRouter;
