// backend/auth/rbac/role.service.ts
import { Injectable, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { createRepositories, Repositories } from '../../src/repositories';
import { hasPermission } from './permission-matcher';
import { permissionCache } from './permissionCache';

@Injectable()
export class RoleService {
  private readonly repos: Repositories;

  constructor(prisma: PrismaService, repos?: Repositories) {
    this.repos = repos ?? createRepositories(prisma as any);
  }

  /**
   * Edge Case: Dynamic Role Deletion with a Viewer fallback binding
   */
  async deleteRole(roleId: string): Promise<void> {
    const role = await this.repos.roles.findById(roleId);
    if (!role) throw new ConflictException('Target role configuration not found.');
    if (!role.isCustom) throw new ConflictException('Cannot remove core system-defined baseline roles.');

    // Find the predefined Viewer role instance for fallback assignments
    const viewerRole = await this.repos.roles.findByName('Viewer');
    if (!viewerRole) throw new ConflictException('Fallback Viewer framework role missing.');

    // Re-assign users on the deleted role to Viewer; the role's permissions cascade.
    await this.repos.roles.deleteAndReassign(roleId, viewerRole.id);

    // The re-assignment touched an unknown set of users, so every cached
    // permission list is potentially stale. Deletions are rare admin actions,
    // so a full reset is cheaper and safer than trying to enumerate them.
    permissionCache.clear();
  }

  /**
   * Edge Case: Prevention of Privilege Escalation
   */
  async assignRoleToUser(actorId: string, targetUserId: string, targetRoleId: string) {
    // 1. Compile the active operational rights of the supervisor pushing the change
    const actorPermissions = await this.repos.userRoles.findPermissions(actorId);

    // 2. Fetch the target rights included in the role being assigned
    const targetRole = await this.repos.roles.findById(targetRoleId, true);
    if (!targetRole) throw new ConflictException('Target assignment role does not exist.');

    // 3. Prevent privilege escalation: An actor cannot grant permissions they do not possess
    for (const item of (targetRole.permissions ?? [])) {
      if (!hasPermission(actorPermissions, item.permission)) {
        throw new ForbiddenException(
          `Privilege escalation prevention: You lack the required authority to grant the '${item.permission}' permission.`
        );
      }
    }

    const created = await this.repos.userRoles.assign(targetUserId, targetRoleId);

    // Both parties' cached permission lists may now be stale.
    permissionCache.invalidate(actorId);
    permissionCache.invalidate(targetUserId);

    return created;
  }
}