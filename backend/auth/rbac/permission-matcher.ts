// backend/auth/rbac/permission-matcher.ts

export function hasPermission(userPermissions: string[], requiredPermission: string): boolean {
  const [reqResource, reqAction] = requiredPermission.split(':');

  return userPermissions.some(perm => {
    const [userResource, userAction] = perm.split(':');
    
    const resourceMatch = userResource === '*' || userResource === reqResource;
    const actionMatch = userAction === '*' || userAction === reqAction;
    
    return resourceMatch && actionMatch;
  });
}