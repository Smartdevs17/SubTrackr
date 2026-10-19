// backend/auth/rbac/__tests__/role.service.test.ts
//
// The Nest framework is not installed in the root workspace, so it is stubbed
// virtually; the service itself is exercised as a plain class.

jest.mock(
  '@nestjs/common',
  () => ({
    Injectable: () => (target: unknown) => target,
    ConflictException: class ConflictException extends Error {},
    ForbiddenException: class ForbiddenException extends Error {},
  }),
  { virtual: true }
);

jest.mock(
  'src/prisma/prisma.service',
  () => ({ PrismaService: class PrismaService {} }),
  { virtual: true }
);

import { RoleService } from '../role.service';
import { permissionCache } from '../permissionCache';

function createPrisma() {
  return {
    role: {
      findUnique: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    userRole: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'assignment-1' }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        userRole: { updateMany: jest.fn().mockResolvedValue({}) },
        role: { delete: jest.fn().mockResolvedValue({}) },
      })
    ),
  };
}

describe('RoleService permission-cache invalidation', () => {
  beforeEach(() => {
    permissionCache.clear();
    jest.clearAllMocks();
  });

  it('invalidates both the actor and the target after a role assignment', async () => {
    const prisma = createPrisma();
    prisma.userRole.findMany.mockResolvedValue([
      { role: { permissions: [{ permission: 'billing:manage' }] } },
    ]);
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-1',
      permissions: [{ permission: 'billing:manage' }],
    });

    permissionCache.set('actor-1', ['billing:manage']);
    permissionCache.set('target-1', []);

    const service = new RoleService(prisma as any);
    await service.assignRoleToUser('actor-1', 'target-1', 'role-1');

    expect(permissionCache.get('actor-1')).toBeNull();
    expect(permissionCache.get('target-1')).toBeNull();
  });

  it('blocks privilege escalation and leaves the cache untouched on failure', async () => {
    const prisma = createPrisma();
    prisma.userRole.findMany.mockResolvedValue([
      { role: { permissions: [{ permission: 'invoice:read' }] } },
    ]);
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-1',
      permissions: [{ permission: 'billing:manage' }],
    });

    permissionCache.set('actor-1', ['invoice:read']);

    const service = new RoleService(prisma as any);
    await expect(
      service.assignRoleToUser('actor-1', 'target-1', 'role-1')
    ).rejects.toThrow();

    expect(prisma.userRole.create).not.toHaveBeenCalled();
    expect(permissionCache.get('actor-1')).toEqual(['invoice:read']);
  });

  it('clears the whole cache after a role deletion reassigns its users', async () => {
    const prisma = createPrisma();
    prisma.role.findUnique
      .mockResolvedValueOnce({ id: 'role-1', isCustom: true })
      .mockResolvedValueOnce({ id: 'viewer-1' });

    permissionCache.set('actor-1', ['billing:manage']);
    permissionCache.set('someone-else', ['invoice:read']);

    const service = new RoleService(prisma as any);
    await service.deleteRole('role-1');

    expect(permissionCache.size).toBe(0);
  });
});
