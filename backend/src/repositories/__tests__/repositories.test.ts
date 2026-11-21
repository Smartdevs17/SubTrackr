import { createRepositories } from '../index';

function createDb() {
  const tx = {
    userRole: { updateMany: jest.fn().mockResolvedValue({}) },
    role: { delete: jest.fn().mockResolvedValue({}) },
  };
  const db: any = {
    role: { findUnique: jest.fn(), delete: jest.fn() },
    userRole: { findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    permissionAuditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  return { db, tx };
}

describe('repositories', () => {
  it('RoleRepository.findById includes permissions only on request', async () => {
    const { db } = createDb();
    const { roles } = createRepositories(db);
    await roles.findById('r1');
    await roles.findById('r1', true);
    expect(db.role.findUnique).toHaveBeenNthCalledWith(1, { where: { id: 'r1' } });
    expect(db.role.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 'r1' },
      include: { permissions: true },
    });
  });

  it('RoleRepository.findByName looks up by name', async () => {
    const { db } = createDb();
    await createRepositories(db).roles.findByName('Viewer');
    expect(db.role.findUnique).toHaveBeenCalledWith({ where: { name: 'Viewer' } });
  });

  it('deleteAndReassign runs both writes inside one transaction', async () => {
    const { db, tx } = createDb();
    await createRepositories(db).roles.deleteAndReassign('r1', 'viewer');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.userRole.updateMany).toHaveBeenCalledWith({
      where: { roleId: 'r1' },
      data: { roleId: 'viewer' },
    });
    expect(tx.role.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(db.role.delete).not.toHaveBeenCalled();
  });

  it('deleteAndReassign propagates transaction failures', async () => {
    const { db } = createDb();
    db.$transaction.mockRejectedValue(new Error('deadlock'));
    await expect(createRepositories(db).roles.deleteAndReassign('a', 'b')).rejects.toThrow('deadlock');
  });

  it('findPermissions flattens permissions across roles', async () => {
    const { db } = createDb();
    db.userRole.findMany.mockResolvedValue([
      { role: { permissions: [{ permission: 'a' }, { permission: 'b' }] } },
      { role: { permissions: [{ permission: 'c' }] } },
      {},
    ]);
    expect(await createRepositories(db).userRoles.findPermissions('u1')).toEqual(['a', 'b', 'c']);
  });

  it('assign creates a user-role link', async () => {
    const { db } = createDb();
    await createRepositories(db).userRoles.assign('u1', 'r1');
    expect(db.userRole.create).toHaveBeenCalledWith({ data: { userId: 'u1', roleId: 'r1' } });
  });

  it('permissionAudit.record writes an entry and resolves void', async () => {
    const { db } = createDb();
    const entry = { action: 'x', actorId: 'u', resource: 'r', outcome: 'ALLOW' as const };
    await expect(createRepositories(db).permissionAudit.record(entry)).resolves.toBeUndefined();
    expect(db.permissionAuditLog.create).toHaveBeenCalledWith({ data: entry });
  });
});
