// Structural types for the persistence layer. Repositories depend on these
// instead of @prisma/client so services can be tested without a database.

export interface PermissionRecord {
  permission: string;
}

export interface RoleRecord {
  id: string;
  name: string;
  isCustom: boolean;
  permissions?: PermissionRecord[];
}

export interface UserRoleRecord {
  id?: string;
  userId: string;
  roleId: string;
  role?: RoleRecord & { permissions: PermissionRecord[] };
}

export interface PermissionAuditEntry {
  action: string;
  actorId: string;
  resource: string;
  outcome: 'ALLOW' | 'DENY';
}

/** The subset of the Prisma client the repositories use. */
export interface PrismaLike {
  role: {
    findUnique(args: unknown): Promise<any>;
    delete(args: unknown): Promise<any>;
  };
  userRole: {
    findMany(args: unknown): Promise<any[]>;
    create(args: unknown): Promise<any>;
    updateMany(args: unknown): Promise<any>;
  };
  permissionAuditLog: {
    create(args: unknown): Promise<any>;
  };
  $transaction<T>(fn: (tx: PrismaLike) => Promise<T>): Promise<T>;
}
