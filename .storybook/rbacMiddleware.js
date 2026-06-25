const PermissionRegistry = require('../rbac/PermissionRegistry');
// Assume you have a configured database client
// const dbClient = require('../../db');

/**
 * Mock database client for demonstration.
 * Replace with your actual database query implementation.
 */
const dbClient = {
  query: async (sql, params) => {
    console.log('Executing SQL:', sql, params);
    // In a real app, this would query your database.
    // This mock is for structure and demonstration purposes.
    if (sql.includes('user_roles')) {
      return { rows: [{ role_id: 'admin' }] }; // Mock: user is always admin
    }
    if (sql.includes('role_permissions')) {
      return { rows: [{ permission: 'all:*' }] }; // Mock: admin has all permissions
    }
    return { rows: [] };
  },
};

/**
 * Express middleware factory to enforce RBAC permissions.
 *
 * @param {string} requiredPermission - The permission string required for the endpoint (e.g., 'subscription:create').
 * @returns {function} An Express middleware function.
 */
function requirePermission(requiredPermission) {
  const [resource, action] = requiredPermission.split(':');

  return async (req, res, next) => {
    // Assume user ID is attached to the request object by a prior auth middleware.
    const actorId = req.user?.id;

    if (!actorId) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    let outcome = 'DENY';
    try {
      // 1. Get user's role from the database.
      const userRoleResult = await dbClient.query(
        'SELECT role_id FROM user_roles WHERE user_id = $1',
        [actorId]
      );

      if (userRoleResult.rows.length === 0) {
        throw new Error('User has no assigned role.');
      }
      const { role_id: roleId } = userRoleResult.rows[0];

      // 2. Get all permissions for that role.
      const rolePermsResult = await dbClient.query(
        'SELECT permission FROM role_permissions WHERE role_id = $1',
        [roleId]
      );
      const userPermissions = rolePermsResult.rows.map((r) => r.permission);

      // 3. Check for permission.
      const hasAccess = PermissionRegistry.hasPermission(userPermissions, requiredPermission);

      if (hasAccess) {
        outcome = 'ALLOW';
        return next();
      }

      return res
        .status(403)
        .json({ message: 'Forbidden: You do not have permission to perform this action.' });
    } catch (error) {
      console.error('RBAC middleware error:', error);
      return res.status(500).json({ message: 'Internal server error during permission check.' });
    } finally {
      // 4. CRITICAL: Record the audit log for every check.
      await dbClient.query(
        'INSERT INTO permission_audit_logs (actor_id, resource, action, outcome) VALUES ($1, $2, $3, $4)',
        [actorId, resource, action, outcome]
      );
    }
  };
}

module.exports = requirePermission;
