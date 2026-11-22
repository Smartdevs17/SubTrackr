/**
 * API key authentication middleware with leak detection — Issue #1273
 *
 * Validates the `X-Api-Key` header against stored key hashes, rejects revoked
 * or expired keys, and feeds every accepted request into the usage anomaly
 * detector. When the anomaly policy auto-revokes the key, the triggering
 * request is rejected as well.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { apiKeyRotationService, ApiKeyRotationService } from '../domain/ApiKeyRotationService';
import {
  apiKeyRevocationService,
  ApiKeyRevocationService,
} from '../domain/ApiKeyRevocationService';
import { AuthError } from '../errors';
import { ERROR_HTTP_STATUS_MAP, fail, type ErrorCode } from '../../shared/apiResponse';

export interface ApiKeyUsageMiddlewareOptions {
  keys?: ApiKeyRotationService;
  revocation?: ApiKeyRevocationService;
}

function reject(res: Response, code: ErrorCode, message: string): void {
  res.status(ERROR_HTTP_STATUS_MAP[code] ?? 401).json(fail(code, message));
}

export function createApiKeyUsageMiddleware(
  options: ApiKeyUsageMiddlewareOptions = {}
): RequestHandler {
  const keys = options.keys ?? apiKeyRotationService;
  const revocation = options.revocation ?? apiKeyRevocationService;

  return (req: Request, res: Response, next: NextFunction): void => {
    const rawKey = req.headers['x-api-key'];
    if (typeof rawKey !== 'string' || rawKey.length === 0) {
      reject(res, 'UNAUTHORIZED', 'X-Api-Key header is required');
      return;
    }

    (async () => {
      let record;
      try {
        record = await keys.validateKey(rawKey);
      } catch (err) {
        if (err instanceof AuthError) {
          reject(res, err.code as ErrorCode, err.message);
          return;
        }
        throw err;
      }
      if (!record) {
        reject(res, 'UNAUTHORIZED', 'Invalid API key');
        return;
      }

      const keyId = keys.findKeyIdByHash(record.keyHash) ?? record.id;
      const incident = await revocation.recordUsage({
        keyId,
        ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        userAgent:
          typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      });
      if (incident?.status === 'auto_revoked') {
        reject(res, 'AUTH_API_KEY_REVOKED', `API key revoked: ${keyId}`);
        return;
      }

      res.locals.apiKey = { keyId, merchantId: record.merchantId };
      next();
    })().catch(next);
  };
}
