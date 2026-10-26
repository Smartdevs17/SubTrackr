/**
 * Session, token and device-flow routes — issues #1776-#1779.
 *
 * Mount at /api/v1/auth:
 *
 *   Password fallback (#1778)
 *     POST   /login/password                 – sign in with userId + password
 *     PUT    /password                       – set / change password   (scope auth:manage)
 *
 *   Tokens (#1776, #1779) — RFC 6749 token endpoint, form or JSON body
 *     POST   /oauth/token                    – grant_type=refresh_token | device_code
 *
 *   Device authorization (#1779) — RFC 8628
 *     POST   /oauth/device_authorization     – start: device_code + user_code
 *     GET    /oauth/device?user_code=…       – what is being approved (scope auth:manage)
 *     POST   /oauth/device/approve           – approve, optionally narrowing scopes (scope auth:manage)
 *     POST   /oauth/device/deny              – deny                    (scope auth:manage)
 *
 *   Sessions (#1777)
 *     GET    /sessions                       – the caller's live sessions (scope sessions:read)
 *     DELETE /sessions/:sessionId            – revoke one session now   (scope sessions:write)
 *     POST   /sessions/revoke-others         – revoke every other session (scope sessions:write)
 *     POST   /logout                         – revoke the calling session
 *
 * Interactive sign-ins (passkey, password) return the access token in
 * `X-Session-Token` and the refresh token in `X-Refresh-Token`, the same
 * header convention as `POST /sessions`. The OAuth token endpoint returns
 * them in the JSON body as RFC 6749 §5.1 requires.
 */

import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { AuthError, AuthErrorCode } from '../errors';
import {
  sessionTokenService as defaultTokens,
  SessionTokenService,
  type IssuedSession,
} from '../domain/SessionTokenService';
import {
  passwordCredentialService as defaultPasswords,
  PasswordCredentialService,
} from '../domain/PasswordCredentialService';
import {
  DEVICE_CODE_GRANT_TYPE,
  deviceAuthorizationService as defaultDeviceFlow,
  DeviceAuthorizationService,
  OAuthError,
  parseScopeParam,
} from '../domain/DeviceAuthorizationService';
import { createRequireAuth, sessionOf } from '../middleware/sessionAuth';
import { serverSessionService, type ServerSessionService } from '../serverSessionService';
import {
  ERROR_HTTP_STATUS_MAP,
  fail,
  ok,
  type ApiResponse,
  type ErrorCode,
} from '../../shared/apiResponse';

export interface SessionRouterOptions {
  sessions?: ServerSessionService;
  tokens?: SessionTokenService;
  passwords?: PasswordCredentialService;
  deviceFlow?: DeviceAuthorizationService;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

function handler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
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

function sendAuthError(req: Request, res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    send(
      res,
      fail(
        err.code as ErrorCode,
        err.message,
        requestIdOf(req),
        err.details as Record<string, string>
      )
    );
    return;
  }
  throw err;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Tokens must never be cached by intermediaries (RFC 6749 §5.1). */
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
}

/** Interactive login response: tokens in headers, metadata in the body. */
function sendInteractiveLogin(req: Request, res: Response, issued: IssuedSession): void {
  noStore(res);
  res.setHeader('X-Session-Token', issued.accessToken);
  res.setHeader('X-Refresh-Token', issued.refreshToken);
  send(
    res,
    ok(
      {
        userId: issued.session.userId,
        session: {
          id: issued.session.id,
          expiresAt: issued.session.expiresAt,
          refreshTokenExpiresAt: issued.refreshTokenExpiresAt,
          scopes: issued.scopes,
          isSuspicious: issued.session.isSuspicious,
        },
      },
      requestIdOf(req)
    )
  );
}

function tokenResponse(issued: IssuedSession): Record<string, unknown> {
  return {
    access_token: issued.accessToken,
    token_type: issued.tokenType,
    expires_in: issued.expiresIn,
    refresh_token: issued.refreshToken,
    scope: issued.scopes.join(' '),
  };
}

function sendOAuthError(res: Response, err: OAuthError): void {
  noStore(res);
  if (err.status === 401) res.setHeader('WWW-Authenticate', 'Basic realm="subtrackr"');
  res.status(err.status).json(err.toJSON());
}

export function createSessionRouter(options: SessionRouterOptions = {}): Router {
  const sessions = options.sessions ?? options.tokens?.sessionStore ?? serverSessionService;
  const tokens =
    options.tokens ?? (options.sessions ? new SessionTokenService({ sessions }) : defaultTokens);
  const passwords = options.passwords ?? defaultPasswords;
  const deviceFlow = options.deviceFlow ?? defaultDeviceFlow;
  const router = Router();

  // RFC 6749 / 8628 clients send application/x-www-form-urlencoded.
  const formBody = express.urlencoded({ extended: false, limit: '16kb' });

  const requireAuth = createRequireAuth({ sessions });
  const requireAuthManage = createRequireAuth({ sessions, scope: 'auth:manage' });
  const requireSessionsRead = createRequireAuth({ sessions, scope: 'sessions:read' });
  const requireSessionsWrite = createRequireAuth({ sessions, scope: 'sessions:write' });

  // ── Password fallback (#1778) ─────────────────────────────────────────────

  router.post(
    '/login/password',
    formBody,
    handler((req, res) => {
      const body = req.body ?? {};
      try {
        passwords.authenticate(body.userId, body.password);
      } catch (err) {
        if (err instanceof AuthError && err.code === AuthErrorCode.ACCOUNT_LOCKED) {
          const retry = (err.details as Record<string, string> | undefined)?.['retryAfterSeconds'];
          if (retry) res.setHeader('Retry-After', retry);
        }
        sendAuthError(req, res, err);
        return;
      }
      const issued = tokens.issue({ userId: body.userId, req, authMethod: 'password' });
      sendInteractiveLogin(req, res, issued);
    })
  );

  router.put(
    '/password',
    requireAuthManage,
    handler((req, res) => {
      const session = sessionOf(res);
      const body = req.body ?? {};
      try {
        passwords.setPassword(session.userId, body.newPassword, body.currentPassword);
      } catch (err) {
        sendAuthError(req, res, err);
        return;
      }
      send(res, ok({ updated: true }, requestIdOf(req)));
    })
  );

  // ── Token endpoint (#1776 refresh, #1779 device_code) ─────────────────────

  router.post(
    '/oauth/token',
    formBody,
    handler((req, res) => {
      const body = req.body ?? {};
      const grantType = str(body.grant_type);
      try {
        if (grantType === 'refresh_token') {
          const refreshToken = str(body.refresh_token);
          if (!refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required');
          let issued: IssuedSession;
          try {
            issued = tokens.refresh(refreshToken, req);
          } catch (err) {
            if (err instanceof AuthError) throw new OAuthError('invalid_grant', err.message);
            throw err;
          }
          noStore(res);
          res.status(200).json(tokenResponse(issued));
          return;
        }

        if (grantType === DEVICE_CODE_GRANT_TYPE) {
          const grant = deviceFlow.poll({ clientId: body.client_id, deviceCode: body.device_code });
          const issued = tokens.issue({
            userId: grant.userId,
            req,
            authMethod: 'device_code',
            scopes: grant.scopes,
            clientId: grant.clientId,
          });
          noStore(res);
          res.status(200).json(tokenResponse(issued));
          return;
        }

        throw new OAuthError(
          grantType ? 'unsupported_grant_type' : 'invalid_request',
          grantType ? `Unsupported grant_type: ${grantType}` : 'grant_type is required'
        );
      } catch (err) {
        if (err instanceof OAuthError) {
          sendOAuthError(res, err);
          return;
        }
        throw err;
      }
    })
  );

  // ── Device authorization (#1779) ──────────────────────────────────────────

  router.post(
    '/oauth/device_authorization',
    formBody,
    handler((req, res) => {
      const body = req.body ?? {};
      try {
        const response = deviceFlow.requestAuthorization({
          clientId: body.client_id,
          scope: body.scope,
        });
        noStore(res);
        res.status(200).json(response);
      } catch (err) {
        if (err instanceof OAuthError) {
          sendOAuthError(res, err);
          return;
        }
        throw err;
      }
    })
  );

  router.get(
    '/oauth/device',
    requireAuthManage,
    handler((req, res) => {
      try {
        const pending = deviceFlow.describe(req.query['user_code'], sessionOf(res).userId);
        send(res, ok(pending, requestIdOf(req)));
      } catch (err) {
        sendAuthError(req, res, err);
      }
    })
  );

  router.post(
    '/oauth/device/approve',
    requireAuthManage,
    handler((req, res) => {
      const session = sessionOf(res);
      const body = req.body ?? {};
      const narrowed = parseScopeParam(body.scope);
      try {
        const approved = deviceFlow.approve({
          userCode: body.user_code,
          approverId: session.userId,
          approverScopes: session.scopes,
          scopes: narrowed ?? undefined,
        });
        send(res, ok(approved, requestIdOf(req)));
      } catch (err) {
        sendAuthError(req, res, err);
      }
    })
  );

  router.post(
    '/oauth/device/deny',
    requireAuthManage,
    handler((req, res) => {
      try {
        deviceFlow.deny({ userCode: req.body?.user_code, approverId: sessionOf(res).userId });
        send(res, ok({ denied: true }, requestIdOf(req)));
      } catch (err) {
        sendAuthError(req, res, err);
      }
    })
  );

  // ── Sessions (#1777) ──────────────────────────────────────────────────────

  router.get(
    '/sessions',
    requireSessionsRead,
    handler((req, res) => {
      const session = sessionOf(res);
      send(res, ok(tokens.listSessions(session.userId, session.id), requestIdOf(req)));
    })
  );

  router.post(
    '/sessions/revoke-others',
    requireSessionsWrite,
    handler((req, res) => {
      const session = sessionOf(res);
      const revoked = tokens.revokeOtherSessions(session.userId, session.id);
      send(res, ok({ revoked }, requestIdOf(req)));
    })
  );

  router.delete(
    '/sessions/:sessionId',
    requireSessionsWrite,
    handler((req, res) => {
      const session = sessionOf(res);
      const sessionId = req.params['sessionId'] as string;
      if (!tokens.revokeSession(session.userId, sessionId, 'user_revoked')) {
        sendAuthError(req, res, AuthError.sessionNotFound(sessionId));
        return;
      }
      send(
        res,
        ok({ revoked: true, sessionId, current: sessionId === session.id }, requestIdOf(req))
      );
    })
  );

  router.post(
    '/logout',
    requireAuth,
    handler((req, res) => {
      const session = sessionOf(res);
      tokens.revokeSession(session.userId, session.id, 'user_logout');
      send(res, ok({ revoked: true }, requestIdOf(req)));
    })
  );

  return router;
}
