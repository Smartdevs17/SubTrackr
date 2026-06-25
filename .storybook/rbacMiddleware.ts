import { Request, Response, NextFunction } from 'express';
import { PermissionRegistry } from '../rbac/PermissionRegistry';
import { dbClient } from '../../db'; // Assume a real, configured DB client
import { logger } from '../../services/logger'; // Assume a structured logger

/**
 * Represents the user object attached to the request by a preceding
 * authentication middleware. It should include pre-fetched permissions.
 */
interface AuthenticatedUser {
  id: string;
  permissions: string[];
}

/**
 * Extends the Express Request type to include our authenticated user.
 */
interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * Express middleware factory to enforce RBAC permissions.
 *
 * This improved version assumes that user permissions are fetched once upon
 * login and attached to the `req.user` object, avoiding database lookups
 * on every single API call for better performance.
 *
 * @param {string} requiredPermission - The permission string required for the endpoint (e.g., 'subscription:create').
 * @returns {function} An Express middleware function for use in routes.
 */
export function requirePermission(requiredPermission: string) {
  const [resource, action] = requiredPermission.split(':', 2);

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const actorId = req.user?.id;
    const userPermissions = req.user?.permissions ?? [];
    const requestId = req.headers['x-request-id'] || 'unknown';

    if (!actorId) {
      // This case should ideally be handled by a preceding auth middleware,
      // but we check again as a safeguard.
      res.status(401).json({ message: 'Authentication required.' });
      return;
    }

    // Abort handling: If the client disconnects, we still must log the final outcome.
    req.on('close', () => {
      if (res.writableEnded) return;
      // Fire-and-forget audit log on client abort.
      audit(actorId, resource, action, outcome);
    });

    let outcome = 'DENY';

    try {
      // Check permissions using the cached list from the user object.
      const hasAccess = PermissionRegistry.hasPermission(userPermissions, requiredPermission);

      if (hasAccess) {
        outcome = 'ALLOW';
        next();
        return;
      }

      // If access is denied, log it and send a 403 Forbidden response.
      // The structured log now includes the request ID for better correlation.
      logger.warn({
        message: 'Permission denied',
        actorId,
        required: requiredPermission,
        permissions: userPermissions,
        requestId,
      });

      if (res.headersSent) return;
      res
        .status(403)
        .json({ message: 'Forbidden: You do not have permission to perform this action.' });
    } catch (error) {
      logger.error({
        message: 'RBAC middleware encountered an unexpected error.',
        error,
        actorId,
        required: requiredPermission,
        requestId,
      });
      if (res.headersSent) return;
      res.status(500).json({ message: 'Internal server error during permission check.' });
    } finally {
      // CRITICAL: Record the audit log for every check, regardless of outcome.
      // We only write here if the response is still open. The 'close' handler covers aborts.
      if (!res.writableEnded) {
        audit(actorId, resource, action, outcome);
      }
    }
  };
}

/**
 * Fire-and-forget audit log function. We do not want audit failures to
 * block the main request flow, so we log errors to our monitoring service.
 */
function audit(actorId: string, resource: string, action: string, outcome: 'ALLOW' | 'DENY'): void {
  dbClient
    .query(
      'INSERT INTO permission_audit_logs (actor_id, resource, action, outcome) VALUES ($1, $2, $3, $4)',
      [actorId, resource, action, outcome]
    )
    .catch((auditError) => {
      logger.error({
        message: 'Failed to write to permission_audit_logs',
        error: auditError,
      });
    });
}
