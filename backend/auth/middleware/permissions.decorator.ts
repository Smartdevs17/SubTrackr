// backend/auth/middleware/permissions.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'permissions';

/**
 * Attaches resource-level permission requirements to route handlers.
 * @example @RequirePermission('subscription:cancel')
 */
export const RequirePermission = (permission: string) => 
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);