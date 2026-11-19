// backend/auth/middleware/permission.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from 'src/prisma/prisma.service';
import { REQUIRE_PERMISSION_KEY } from './permissions.decorator';
import { hasPermission } from '../rbac/permission-matcher';
import { permissionCache } from '../rbac/permissionCache';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Scan metadata to see if the specific route endpoint is protected
    const requiredPermission = this.reflector.get<string>(REQUIRE_PERMISSION_KEY, context.getHandler());
    if (!requiredPermission) return true; // Public or generically authenticated route

    const request = context.switchToHttp().getRequest();
    const user = request.user; // Set up upstream by authentication JWT validation
    if (!user) return false;

    // 2. Resolve the user's permissions, reusing the short-lived cache so a
    //    guarded request does not pay for the role/permission join every time.
    let userPermissions = permissionCache.get(user.id);
    if (userPermissions === null) {
      const userAssignments = await this.prisma.userRole.findMany({
        where: { userId: user.id },
        include: { role: { include: { permissions: true } } },
      });

      userPermissions = userAssignments.flatMap((ua) =>
        ua.role.permissions.map((p) => p.permission)
      );
      permissionCache.set(user.id, userPermissions);
    }

    // 3. Evaluate matching rights
    const isAllowed = hasPermission(userPermissions, requiredPermission);

    // 4. Create an Audit Log track entry
    await this.prisma.permissionAuditLog.create({
      data: {
        action: requiredPermission,
        actorId: user.id,
        resource: request.params.id || 'generic',
        outcome: isAllowed ? 'ALLOW' : 'DENY',
      },
    });

    if (!isAllowed) {
      throw new ForbiddenException('Insufficient resource access permissions.');
    }

    return true;
  }
}