import { PermissionAuditEntry, PrismaLike } from './types';

export class PermissionAuditRepository {
  constructor(private readonly db: PrismaLike) {}

  record(entry: PermissionAuditEntry): Promise<void> {
    return this.db.permissionAuditLog.create({ data: entry }).then(() => undefined);
  }
}
