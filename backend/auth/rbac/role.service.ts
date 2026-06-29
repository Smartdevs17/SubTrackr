// backend/auth/rbac/role.service.ts
import { Injectable, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { hasPermission } from './permission-matcher';

@Injectable()
export class RoleService {
  constructor(private prisma: PrismaService) {}

  /**
   * Edge Case: Dynamic Role Deletion with a Viewer fallback binding
   */
  async deleteRole(roleId: string): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new ConflictException('Target role configuration not found.');
    if (!role.isCustom) throw new ConflictException('Cannot remove core system-defined baseline roles.');

    // Find the predefined Viewer role instance for fallback assignments
    const viewerRole = await this.prisma.role.findUnique({ where: { name: 'Viewer' } });
    if (!viewerRole) throw new ConflictException('Fallback Viewer framework role missing.');

    await this.prisma.$transaction(async (tx) => {
      // Re-assign all users currently using this role down to Viewer
      await tx.userRole.updateMany({
        where: { roleId },
        data: { roleId: viewerRole.id },
      });

      // Cascading drops permissions and the role entity itself
      await tx.role.delete({ where: { id: roleId } });
    });
  }

  /**
   * Edge Case: Prevention of Privilege Escalation
   */
  async assignRoleToUser(actorId: string, targetUserId: string, targetRoleId: string) {
    // 1. Compile the active operational rights of the supervisor pushing the change
    const actorAssignments = await this.prisma.userRole.findMany({
      where: { userId: actorId },
      include: { role: { include: { permissions: true } } },
    });
    const actorPermissions = actorAssignments.flatMap(ua => ua.role.permissions.map(p => p.permission));

    // 2. Fetch the target rights included in the role being assigned
    const targetRole = await this.prisma.role.findUnique({
      where: { id: targetRoleId },
      include: { permissions: true },
    });
    if (!targetRole) throw new ConflictException('Target assignment role does not exist.');

    // 3. Prevent privilege escalation: An actor cannot grant permissions they do not possess
    for (const item of targetRole.permissions) {
      if (!hasPermission(actorPermissions, item.permission)) {
        throw new ForbiddenException(
          `Privilege escalation prevention: You lack the required authority to grant the '${item.permission}' permission.`
        );
      }
    }

    return this.prisma.userRole.create({
      data: { userId: targetUserId, roleId: targetRoleId },
    });
  }
}