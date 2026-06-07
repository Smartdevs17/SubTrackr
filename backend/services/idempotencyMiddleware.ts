/**
 * Express middleware that enforces idempotency on payment routes.
 *
 * Usage:
 *   app.post('/payments/charge', idempotencyMiddleware, chargeHandler);
 *
 * The middleware:
 *   1. Reads the Idempotency-Key header (required).
 *   2. Returns 400 if the header is missing.
 *   3. Returns the cached response immediately if the key was already completed.
 *   4. Returns 409 if the same key is currently in-flight.
 *   5. Returns 422 if the key was used with a different request body.
 *   6. Otherwise lets the request through and caches the response on completion.
 */

import type { Request, Response, NextFunction } from 'express';
import {
  idempotencyService,
  hashRequest,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyCollisionError,
  IdempotencyRequestInFlightError,
} from './idempotencyService';
import { fail } from './apiResponse';

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()] as string | undefined;

  if (!key) {
    res.status(400).json(fail('BAD_REQUEST', `${IDEMPOTENCY_KEY_HEADER} header is required for payment operations.`));
    return;
  }

  const requestHash = hashRequest(req.body);
  const existing = idempotencyService.get(key);

  if (existing) {
    if (existing.requestHash !== requestHash) {
      res.status(422).json(fail('IDEMPOTENCY_KEY_COLLISION', `Idempotency key "${key}" was already used with a different request payload.`));
      return;
    }

    if (existing.status === 'pending') {
      res.status(409).json(fail('IDEMPOTENCY_REQUEST_IN_FLIGHT', `Request with idempotency key "${key}" is already in progress.`));
      return;
    }

    if (existing.status === 'completed') {
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(200).json(existing.response);
      return;
    }

    // failed — delete so the client can retry
    idempotencyService.delete(key);
  }

  // Attach key + hash to the request so the route handler can finalise the record
  (req as any).idempotencyKey = key;
  (req as any).idempotencyHash = requestHash;

  // Wrap res.json to intercept the response and cache it
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      idempotencyService.complete(key, body);
    } else {
      // Non-2xx — free the key so the client can retry
      idempotencyService.delete(key);
    }
    return originalJson(body);
  };

  // Register the key as pending before passing to the handler
  idempotencyService.registerPending(key, requestHash);

  next();
}
