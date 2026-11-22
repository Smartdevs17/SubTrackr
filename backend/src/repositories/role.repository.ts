import { PrismaLike, RoleRecord } from './types';

export class RoleRepository {
  constructor(private readonly db: PrismaLike) {}

  findById(id: string, withPermissions = false): Promise<RoleRecord | null> {
    return this.db.role.findUnique({
      where: { id },
      ...(withPermissions ? { include: { permissions: true } } : {}),
    });
  }

  findByName(name: string): Promise<RoleRecord | null> {
    return this.db.role.findUnique({ where: { name } });
  }

  /** Moves every assignment of `roleId` to `fallbackRoleId`, then deletes the role, atomically. */
  deleteAndReassign(roleId: string, fallbackRoleId: string): Promise<void> {
    return this.db.$transaction(async (tx) => {
      await tx.userRole.updateMany({ where: { roleId }, data: { roleId: fallbackRoleId } });
      await tx.role.delete({ where: { id: roleId } });
    });
  }
}
