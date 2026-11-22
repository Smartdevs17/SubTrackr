import { PermissionRecord, PrismaLike, UserRoleRecord } from './types';

export class UserRoleRepository {
  constructor(private readonly db: PrismaLike) {}

  findAssignmentsWithPermissions(userId: string): Promise<UserRoleRecord[]> {
    return this.db.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: true } } },
    });
  }

  /** Flattened list of permission strings granted to a user across all roles. */
  async findPermissions(userId: string): Promise<string[]> {
    const assignments = await this.findAssignmentsWithPermissions(userId);
    return assignments.flatMap((a) =>
      (a.role?.permissions ?? []).map((p: PermissionRecord) => p.permission)
    );
  }

  assign(userId: string, roleId: string): Promise<UserRoleRecord> {
    return this.db.userRole.create({ data: { userId, roleId } });
  }
}
