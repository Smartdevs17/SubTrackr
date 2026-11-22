import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  LoyaltyController,
  loyaltyController as defaultController,
} from './loyaltyController';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => void;

function wrap(handler: (req: Request, res: Response) => void): AsyncHandler {
  return (req, res, next) => {
    try {
      handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

export function createLoyaltyRouter(controller: LoyaltyController = defaultController): Router {
  const router = Router();

  router.get('/rewards', wrap((req, res) => controller.getRewards(req, res)));
  router.get('/balance/:subscriberId', wrap((req, res) => controller.getBalance(req, res)));
  router.get('/tier/:subscriberId', wrap((req, res) => controller.getTier(req, res)));
  router.post('/points/award', wrap((req, res) => controller.awardPoints(req, res)));
  router.post('/points/expire', wrap((req, res) => controller.expirePoints(req, res)));
  router.post('/rewards/redeem', wrap((req, res) => controller.redeemReward(req, res)));
  router.get('/history/:subscriberId', wrap((req, res) => controller.getHistory(req, res)));
  router.get('/analytics', wrap((req, res) => controller.getAnalytics(req, res)));
  router.get('/notifications/:subscriberId', wrap((req, res) => controller.getNotifications(req, res)));
  router.patch('/notifications/:notificationId/read', wrap((req, res) => controller.markNotificationRead(req, res)));

  return router;
}

export default createLoyaltyRouter;
