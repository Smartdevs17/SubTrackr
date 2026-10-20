/**
 * Auth routers — passkey login (Issue #1272) and API key revocation with leak
 * detection (Issue #1273).
 *
 * Passkey routes (mount at /api/v1/auth):
 *   POST   /passkeys/register/options        – creation options (session required)
 *   POST   /passkeys/register/verify         – verify attestation, store passkey (session required)
 *   POST   /passkeys/login/options           – assertion options (optional userId)
 *   POST   /passkeys/login/verify            – verify assertion, issue session (X-Session-Token)
 *   GET    /passkeys                         – list the caller's passkeys (session required)
 *   DELETE /passkeys/:credentialId           – remove one of the caller's passkeys (session required)
 *
 * API key routes (mount at /api/v1/api-keys):
 *   POST   /:keyId/revoke                    – revoke a key immediately
 *   POST   /:keyId/report-leak               – manually report a key as exposed
 *   POST   /merchants/:merchantId/revoke-all – revoke every key of a merchant
 *   POST   /leaks/scan                       – scan content / hash feed for exposed keys
 *   GET    /leaks/incidents                  – list incidents (?merchantId, keyId, status)
 *   POST   /leaks/incidents/:id/confirm      – confirm incident and revoke key
 *   POST   /leaks/incidents/:id/dismiss      – dismiss incident as false positive
 *   GET    /leaks/policy/:merchantId         – leak detection policy
 *   PATCH  /leaks/policy/:merchantId         – update leak detection policy
 *   GET    /revocations/audit                – revocation audit trail (?merchantId, keyId, limit)
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  passkeyController as defaultPasskeyController,
  PasskeyController,
} from '../controller/passkeyController';
import {
  apiKeyRevocationController as defaultRevocationController,
  ApiKeyRevocationController,
} from '../controller/apiKeyRevocationController';
import {
  serverSessionService,
  type ServerSessionService,
  type SessionRecord,
} from '../serverSessionService';
import { ERROR_HTTP_STATUS_MAP, fail, type ApiResponse } from '../../shared/apiResponse';
import type { LeakIncidentStatus } from '../interfaces';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

function requestIdOf(req: Request): string | undefined {
  const header = req.headers['x-request-id'];
  return typeof header === 'string' ? header : undefined;
}

function send<T>(res: Response, result: ApiResponse<T>, successStatus = 200): void {
  const status = result.success ? successStatus : (ERROR_HTTP_STATUS_MAP[result.error.code] ?? 500);
  res.status(status).json(result);
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// ── Passkeys ────────────────────────────────────────────────────────────────

export interface PasskeyRouterOptions {
  controller?: PasskeyController;
  sessions?: ServerSessionService;
}

export function createPasskeyRouter(options: PasskeyRouterOptions = {}): Router {
  const controller = options.controller ?? defaultPasskeyController;
  const sessions = options.sessions ?? serverSessionService;
  const router = Router();

  /** Adding or removing passkeys requires an existing authenticated session. */
  function requireSession(req: Request, res: Response): SessionRecord | null {
    const token = req.headers['x-session-token'];
    const result = typeof token === 'string' ? sessions.validateSession(token, req) : null;
    if (!result?.valid || !result.session) {
      send(res, fail('UNAUTHORIZED', 'A valid X-Session-Token is required', requestIdOf(req)));
      return null;
    }
    return result.session;
  }

  router.post(
    '/passkeys/register/options',
    asyncHandler(async (req, res) => {
      const session = requireSession(req, res);
      if (!session) return;
      const body = req.body ?? {};
      const result = await controller.registrationOptions(
        { userId: session.userId, userName: body.userName, displayName: body.displayName },
        requestIdOf(req)
      );
      send(res, result);
    })
  );

  router.post(
    '/passkeys/register/verify',
    asyncHandler(async (req, res) => {
      const session = requireSession(req, res);
      if (!session) return;
      const body = req.body ?? {};
      const result = await controller.verifyRegistration(
        { userId: session.userId, response: body.response, deviceName: body.deviceName },
        requestIdOf(req)
      );
      send(res, result, 201);
    })
  );

  router.post(
    '/passkeys/login/options',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      send(
        res,
        await controller.authenticationOptions(
          { userId: queryString(body.userId) },
          requestIdOf(req)
        )
      );
    })
  );

  router.post(
    '/passkeys/login/verify',
    asyncHandler(async (req, res) => {
      const result = await controller.verifyAuthentication(
        { response: req.body?.response },
        requestIdOf(req)
      );
      if (!result.success) {
        send(res, result);
        return;
      }

      const session = sessions.createSession({
        userId: result.data.userId,
        req,
        metadata: { authMethod: 'passkey', credentialId: result.data.credentialId },
      });
      // Same convention as POST /sessions: the raw token travels in a header.
      res.setHeader('X-Session-Token', session.token);
      send(res, {
        ...result,
        data: {
          ...result.data,
          session: {
            id: session.id,
            expiresAt: session.expiresAt,
            isSuspicious: session.isSuspicious,
          },
        },
      });
    })
  );

  router.get(
    '/passkeys',
    asyncHandler(async (req, res) => {
      const session = requireSession(req, res);
      if (!session) return;
      send(res, await controller.listCredentials(session.userId, requestIdOf(req)));
    })
  );

  router.delete(
    '/passkeys/:credentialId',
    asyncHandler(async (req, res) => {
      const session = requireSession(req, res);
      if (!session) return;
      send(
        res,
        await controller.removeCredential(session.userId, req.params.credentialId, requestIdOf(req))
      );
    })
  );

  return router;
}

// ── API key revocation & leak detection ─────────────────────────────────────

export function createApiKeyRevocationRouter(
  controller: ApiKeyRevocationController = defaultRevocationController
): Router {
  const router = Router();

  router.post(
    '/leaks/scan',
    asyncHandler(async (req, res) => {
      send(res, await controller.scan(req.body ?? {}, requestIdOf(req)));
    })
  );

  router.get(
    '/leaks/incidents',
    asyncHandler(async (req, res) => {
      const filter = {
        merchantId: queryString(req.query.merchantId),
        keyId: queryString(req.query.keyId),
        status: queryString(req.query.status) as LeakIncidentStatus | undefined,
      };
      send(res, await controller.listIncidents(filter, requestIdOf(req)));
    })
  );

  router.post(
    '/leaks/incidents/:incidentId/confirm',
    asyncHandler(async (req, res) => {
      send(
        res,
        await controller.confirmIncident(req.params.incidentId, req.body ?? {}, requestIdOf(req))
      );
    })
  );

  router.post(
    '/leaks/incidents/:incidentId/dismiss',
    asyncHandler(async (req, res) => {
      send(
        res,
        await controller.dismissIncident(req.params.incidentId, req.body ?? {}, requestIdOf(req))
      );
    })
  );

  router.get(
    '/leaks/policy/:merchantId',
    asyncHandler(async (req, res) => {
      send(res, await controller.getPolicy(req.params.merchantId, requestIdOf(req)));
    })
  );

  router.patch(
    '/leaks/policy/:merchantId',
    asyncHandler(async (req, res) => {
      send(
        res,
        await controller.updatePolicy(req.params.merchantId, req.body ?? {}, requestIdOf(req))
      );
    })
  );

  router.get(
    '/revocations/audit',
    asyncHandler(async (req, res) => {
      const limit = Number(req.query.limit);
      const filter = {
        merchantId: queryString(req.query.merchantId),
        keyId: queryString(req.query.keyId),
        limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
      };
      send(res, await controller.getAuditLog(filter, requestIdOf(req)));
    })
  );

  router.post(
    '/merchants/:merchantId/revoke-all',
    asyncHandler(async (req, res) => {
      send(
        res,
        await controller.revokeAll(req.params.merchantId, req.body ?? {}, requestIdOf(req))
      );
    })
  );

  router.post(
    '/:keyId/revoke',
    asyncHandler(async (req, res) => {
      send(res, await controller.revoke(req.params.keyId, req.body ?? {}, requestIdOf(req)));
    })
  );

  router.post(
    '/:keyId/report-leak',
    asyncHandler(async (req, res) => {
      send(
        res,
        await controller.reportLeak(req.params.keyId, req.body ?? {}, requestIdOf(req)),
        201
      );
    })
  );

  return router;
}
