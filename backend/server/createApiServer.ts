/**
 * SubTrackr public API HTTP server factory.
 *
 * Mounts CDN-cacheable routes behind edge-cache header middleware.
 * Additional batch subscription routes are mounted with atomic execution support.
 * Payment intent and asset-policy routes are mounted for the Stellar Wave
 * payment lifecycle (Issues #1716, #1717).
 */

import express, { type Express } from 'express';
import { cacheHeadersMiddleware } from '../shared/middleware';
import {
  createPublicApiRouter,
  createSearchRouter,
  createSubscriptionOpsRouter,
  createThemeRouter,
} from '../subscription/router';
import { createPaymentRouter } from '../services/payment/router/paymentIntentRouter';
import { createAssetPolicyRouter } from '../services/payment/router/assetPolicyRouter';
import { API_VERSION_HEADER, API_VERSION_VALUE } from '../services/shared/apiResponse';

export interface CreateApiServerOptions {
  /** Optional middleware applied before cache headers (e.g. auth). */
  beforeCache?: express.RequestHandler[];
}

export function createApiServer(options: CreateApiServerOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  if (options.beforeCache) {
    for (const mw of options.beforeCache) {
      app.use(mw);
    }
  }

  app.use((_req, res, next) => {
    res.setHeader(API_VERSION_HEADER, API_VERSION_VALUE);
    next();
  });

  app.use(cacheHeadersMiddleware());
  app.use(createPublicApiRouter());
  app.use(createSubscriptionOpsRouter());
  app.use('/api/v1/search', createSearchRouter());
  app.use('/api/v1/merchant', createThemeRouter());
  app.use('/api/payments', createPaymentRouter());
  app.use(createAssetPolicyRouter());

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  return app;
}

export function startApiServer(port: number = Number(process.env.PORT ?? 3000)): Express {
  const app = createApiServer();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`SubTrackr API listening on port ${port}`);
  });
  return app;
}
