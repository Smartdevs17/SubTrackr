import { PermissionAuditRepository } from './permission-audit.repository';
import { RoleRepository } from './role.repository';
import { PrismaLike } from './types';
import { UserRoleRepository } from './user-role.repository';

export * from './types';
export { RoleRepository, UserRoleRepository, PermissionAuditRepository };

export interface Repositories {
  roles: RoleRepository;
  userRoles: UserRoleRepository;
  permissionAudit: PermissionAuditRepository;
}

export function createRepositories(db: PrismaLike): Repositories {
  return {
    roles: new RoleRepository(db),
    userRoles: new UserRoleRepository(db),
    permissionAudit: new PermissionAuditRepository(db),
  };
}
