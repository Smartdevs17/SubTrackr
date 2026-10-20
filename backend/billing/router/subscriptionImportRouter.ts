import { Router } from 'express';

import { SubscriptionImportController } from '../controller/subscriptionImportController';
import type { SubscriptionImportService } from '../domain/SubscriptionImportService';

export interface SubscriptionImportRouterOptions {
  service: SubscriptionImportService;
  authMiddleware?: RequestHandler;
}

type RequestHandler = (
  req: Express.Request,
  res: Express.Response,
  next: Express.NextFunction,
) => void | Promise<void>;

export function createSubscriptionImportRouter(options: SubscriptionImportRouterOptions): Router {
  const router = Router();
  const controller = new SubscriptionImportController({ service: options.service });

  if (options.authMiddleware) {
    router.post('/bulk', options.authMiddleware, controller.handleImport);
  } else {
    router.post('/bulk', controller.handleImport);
  }

  return router;
}
