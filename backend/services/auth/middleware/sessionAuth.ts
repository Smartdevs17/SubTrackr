/**
 * Session access-token authentication and scope enforcement (#1777, #1779).
 *
 * Accepts the access token as `Authorization: Bearer <token>` (OAuth clients,
 * the CLI) or `X-Session-Token` (the existing app convention). The session is
 * re-validated on every request, so a revoked session is rejected on its very
 * next call. Scope checks follow RFC 6750 §3.1: 401 `invalid_token` for a
 * missing / bad token, 403 `insufficient_scope` when the token is valid but
 * was not granted the scope the route needs.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { hasScope } from '../domain/ApiKeyRotationService';
import {
  serverSessionService,
  type ServerSessionService,
  type SessionRecord,
} from '../serverSessionService';
import { ERROR_HTTP_STATUS_MAP, fail } from '../../shared/apiResponse';

export function extractAccessToken(req: Request): string | null {
  const authorization = req.headers['authorization'];
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (match) return match[1] as string;
  }
  const header = req.headers['x-session-token'];
  return typeof header === 'string' && header.length > 0 ? header : null;
}

function requestIdOf(req: Request): string | undefined {
  const header = req.headers['x-request-id'];
  return typeof header === 'string' ? header : undefined;
}

/** The authenticated session, set by `createRequireAuth`. */
export function sessionOf(res: Response): SessionRecord {
  return res.locals['session'] as SessionRecord;
}

/**
 * Build the authentication middleware. When `scope` is given the session
 * must hold it; otherwise any valid session passes.
 */
export function createRequireAuth(
  options: { sessions?: ServerSessionService; scope?: string } = {}
): RequestHandler {
  const sessions = options.sessions ?? serverSessionService;
  return function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const token = extractAccessToken(req);
    const result = token ? sessions.validateSession(token, req) : null;
    if (!result?.valid || !result.session) {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      res
        .status(401)
        .json(fail('UNAUTHORIZED', 'A valid access token is required', requestIdOf(req)));
      return;
    }
    if (options.scope && !hasScope(result.session.scopes, options.scope)) {
      res.setHeader(
        'WWW-Authenticate',
        `Bearer error="insufficient_scope", scope="${options.scope}"`
      );
      res
        .status(ERROR_HTTP_STATUS_MAP.AUTH_INSUFFICIENT_SCOPE)
        .json(
          fail(
            'AUTH_INSUFFICIENT_SCOPE',
            `Access token lacks required scope: ${options.scope}`,
            requestIdOf(req),
            { requiredScope: options.scope }
          )
        );
      return;
    }
    res.locals['session'] = result.session;
    next();
  };
}
