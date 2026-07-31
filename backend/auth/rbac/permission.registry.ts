// backend/auth/rbac/permission.registry.ts

export const PREDEFINED_ROLES = {
  Admin: ['*:*'],
  Billing: ['billing:*', 'invoice:*'],
  Support: ['subscription:read', 'invoice:read'],
  Viewer: ['*:read'],
};