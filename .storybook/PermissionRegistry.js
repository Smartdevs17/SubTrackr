/**
 * PermissionRegistry provides static methods for checking fine-grained,
 * resource-level permissions with wildcard support.
 */
class PermissionRegistry {
  /**
   * Checks if a set of user permissions grants access for a required permission.
   * Supports 'resource:action' format with wildcards.
   *
   * Wildcard Rules:
   * - 'all:*': Grants access to everything.
   * - 'resource:*': Grants access to all actions for a specific resource.
   * - '*:action': Grants access to a specific action on any resource.
   *
   * @param {string[]} userPermissions - An array of permissions assigned to the user (e.g., ['subscription:read', 'billing:*']).
   * @param {string} requiredPermission - The permission required for the action (e.g., 'subscription:cancel').
   * @returns {boolean} - True if access is granted, otherwise false.
   */
  static hasPermission(userPermissions, requiredPermission) {
    if (!userPermissions || userPermissions.length === 0) {
      return false;
    }

    const [reqResource, reqAction] = requiredPermission.split(':');

    for (const perm of userPermissions) {
      if (perm === 'all:*') return true;
      if (perm === requiredPermission) return true;

      const [permResource, permAction] = perm.split(':');

      if (permResource === reqResource && permAction === '*') return true;
      if (permResource === '*' && permAction === reqAction) return true;
    }

    return false;
  }
}

module.exports = PermissionRegistry;
