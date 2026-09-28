/**
 * Webhook Signature Verification Middleware
 *
 * Express middleware that verifies incoming webhook payloads signed with
 * SubTrackr's HMAC-SHA256 scheme.
 *
 * Signature header format:
 *   X-SubTrackr-Signature: t={timestamp},s={sig},v=1,n={nonce}
 *
 * The raw request body is captured and stored as `req.rawBody` so downstream
 * handlers can still access it after verification.
 *
 * Usage:
 *   import { createWebhookVerificationMiddleware } from './webhookVerificationMiddleware';
 *   router.post('/webhook', createWebhookVerificationMiddleware(keyStore), handler);
 */

import type { Request, Response, NextFunction } from 'express';
import SignatureService from './SignatureService';
import KeyStore from './keyStore';

export const RAW_BODY_SYMBOL = Symbol('rawBody');

// Extend Express Request to carry the raw body buffer and verified flag
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: Buffer;
      webhookVerified?: boolean;
      webhookTimestamp?: number;
      webhookNonce?: string;
    }
  }
}

export interface WebhookVerificationOptions {
  /**
   * Signature header name. Defaults to 'x-subtrackr-signature'.
   * Also accepts 'x-webhook-signature' for third-party integrations.
   */
  headerName?: string;
  /**
   * Timestamp tolerance in seconds. Requests older than this are rejected.
   * Default: 300 (5 minutes).
   */
  timestampTolerance?: number;
  /**
   * Clock skew tolerance in seconds. Default: 30.
   */
  clockSkewTolerance?: number;
  /**
   * Nonce TTL in seconds — how long a nonce is remembered to prevent replay.
   * Default: 600 (10 minutes).
   */
  nonceTtl?: number;
  /**
   * When true, a missing signature returns 400 instead of 401. Useful when the
   * endpoint accepts both signed and unsigned calls (signature optional mode).
   */
  optional?: boolean;
  /**
   * Called when verification succeeds. Useful for audit logging.
   */
  onSuccess?: (req: Request) => void;
  /**
   * Called when verification fails. Useful for alerting.
   */
  onFailure?: (req: Request, reason: string) => void;
}

/**
 * Body capture middleware — stores the raw request body buffer on `req.rawBody`
 * so downstream webhook verification can access the unmodified bytes even after
 * express.json() has parsed the payload.
 *
 * Uses `express.raw` with a wildcard type matcher so it captures every
 * Content-Type. Must be mounted BEFORE `express.json()` at the top of the app.
 *
 * @example
 *   import express from 'express';
 *   import { captureRawBody } from './webhookVerificationMiddleware';
 *
 *   const app = express();
 *   app.use(captureRawBody);   // ← before express.json()
 *   app.use(express.json());
 */
export const captureRawBody = (req: Request, res: Response, next: NextFunction): void => {
  // If body was already read (e.g. by another middleware), skip
  if (req.rawBody) { next(); return; }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer | string) => {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  });
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
};

/**
 * Factory that returns a verification middleware bound to the provided KeyStore.
 *
 * @example
 * const keyStore = new KeyStore(process.env.WEBHOOK_SIGNING_KEY!);
 * router.use(captureRawBody);
 * router.post('/incoming', createWebhookVerificationMiddleware(keyStore), myHandler);
 */
export function createWebhookVerificationMiddleware(
  keyStore: KeyStore,
  options: WebhookVerificationOptions = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const {
    headerName = 'x-subtrackr-signature',
    timestampTolerance = 300,
    clockSkewTolerance = 30,
    nonceTtl = 600,
    optional = false,
    onSuccess,
    onFailure,
  } = options;

  const signatureService = new SignatureService(keyStore, {
    timestampTolerance,
    clockSkewTolerance,
    nonceTtl,
  });

  return async function webhookVerificationMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const signatureHeader =
      (req.headers[headerName] as string | undefined) ??
      (req.headers['x-subtrackr-signature'] as string | undefined) ??
      (req.headers['x-webhook-signature'] as string | undefined);

    // Handle missing signature
    if (!signatureHeader) {
      if (optional) {
        req.webhookVerified = false;
        return next();
      }
      const reason = 'Missing webhook signature header';
      onFailure?.(req, reason);
      res.status(401).json({
        error: 'MISSING_SIGNATURE',
        message: reason,
      });
      return;
    }

    // Obtain the raw body — either from captureRawBody middleware or the express
    // raw body parser. Fall back to re-serialising the parsed JSON body.
    let rawBodyStr: string;
    if (req.rawBody) {
      rawBodyStr = req.rawBody.toString('utf-8');
    } else if (typeof (req as Request & { body: unknown }).body === 'string') {
      rawBodyStr = (req as Request & { body: string }).body;
    } else if ((req as Request & { body: unknown }).body !== undefined) {
      rawBodyStr = JSON.stringify((req as Request & { body: unknown }).body);
    } else {
      rawBodyStr = '';
    }

    try {
      await signatureService.verify(rawBodyStr, signatureHeader);

      // Extract verified metadata for downstream handlers
      const parsed = signatureService.parseHeader(signatureHeader);
      req.webhookVerified = true;
      req.webhookTimestamp = parseInt(parsed['t'] ?? '0', 10);
      req.webhookNonce = parsed['n'];

      onSuccess?.(req);
      next();
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Signature verification failed';
      onFailure?.(req, reason);

      const isTimestamp = reason.includes('timestamp');
      const isReplay = reason.includes('replay');

      res.status(401).json({
        error: isTimestamp
          ? 'TIMESTAMP_OUT_OF_RANGE'
          : isReplay
            ? 'REPLAY_DETECTED'
            : 'INVALID_SIGNATURE',
        message: reason,
      });
    }
  };
}

/**
 * Lightweight utility for one-shot signature verification outside of Express —
 * useful in edge functions, workers, or tests.
 *
 * @returns true on valid signature, throws on failure.
 */
export async function verifyIncomingWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  keyStore: KeyStore,
  options?: Pick<WebhookVerificationOptions, 'timestampTolerance' | 'clockSkewTolerance' | 'nonceTtl'>,
): Promise<true> {
  const service = new SignatureService(keyStore, options);
  await service.verify(rawBody, signatureHeader);
  return true;
}
