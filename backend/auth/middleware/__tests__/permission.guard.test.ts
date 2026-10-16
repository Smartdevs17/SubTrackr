// backend/auth/middleware/__tests__/permission.guard.test.ts
//
// `@nestjs/*` is not part of the root workspace install (the backend runs its
// own dependency tree), so the framework is replaced with virtual stubs and
// the guard is exercised as a plain class.

jest.mock(
  '@nestjs/common',
  () => ({
    Injectable: () => (target: unknown) => target,
    ForbiddenException: class ForbiddenException extends Error {},
  }),
  { virtual: true }
);

jest.mock(
  '@nestjs/core',
  () => ({
    Reflector: class Reflector {},
  }),
  { virtual: true }
);

jest.mock(
  'src/prisma/prisma.service',
  () => ({ PrismaService: class PrismaService {} }),
  { virtual: true }
);

import { PermissionGuard } from '../permission.guard';
import { permissionCache } from '../../rbac/permissionCache';

const REQUIRE_PERMISSION_KEY = 'require:permission';

function createContext(requiredPermission: string | null, userId = 'user-1') {
  const request = { user: userId ? { id: userId } : undefined, params: { id: 'res-1' } };
  const reflector = {
    get: jest.fn().mockReturnValue(requiredPermission),
  };
  const prisma = {
    userRole: {
      findMany: jest.fn().mockResolvedValue([
        {
          role: {
            permissions: [
              { permission: 'invoice:read' },
              { permission: 'invoice:write' },
            ],
          },
        },
      ]),
    },
    permissionAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const context = {
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };
  const guard = new PermissionGuard(reflector as any, prisma as any);
  return { guard, context, prisma, request };
}

describe('PermissionGuard', () => {
  beforeEach(() => {
    permissionCache.clear();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('skips the permission lookup for routes without metadata', async () => {
    const { guard, context, prisma } = createContext(null);

    await expect(guard.canActivate(context as any)).resolves.toBe(true);

    expect(prisma.userRole.findMany).not.toHaveBeenCalled();
    expect(prisma.permissionAuditLog.create).not.toHaveBeenCalled();
  });

  it('resolves permissions once and reuses the cache on later requests', async () => {
    const { guard, context, prisma } = createContext(REQUIRE_PERMISSION_KEY);

    await expect(guard.canActivate(context as any)).resolves.toBe(true);
    await expect(guard.canActivate(context as any)).resolves.toBe(true);

    expect(prisma.userRole.findMany).toHaveBeenCalledTimes(1);
    // The audit trail is still written for every request.
    expect(prisma.permissionAuditLog.create).toHaveBeenCalledTimes(2);
  });

  it('serves the cached denial without re-querying', async () => {
    const { guard, context, prisma } = createContext(REQUIRE_PERMISSION_KEY);
    prisma.userRole.findMany.mockResolvedValue([]);

    await expect(guard.canActivate(context as any)).rejects.toThrow();
    await expect(guard.canActivate(context as any)).rejects.toThrow();

    expect(prisma.userRole.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.permissionAuditLog.create).toHaveBeenCalledTimes(2);
  });

  it('drops the cached entry once the TTL elapses', async () => {
    jest.useFakeTimers();
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);

    const { guard, context, prisma } = createContext(REQUIRE_PERMISSION_KEY);

    await guard.canActivate(context as any);
    now.mockReturnValue(1_000_000 + 59_000);
    await guard.canActivate(context as any);
    expect(prisma.userRole.findMany).toHaveBeenCalledTimes(1);

    // Past the 30 s default TTL the entry is stale and must be re-resolved.
    now.mockReturnValue(1_000_000 + 61_000);
    await guard.canActivate(context as any);
    expect(prisma.userRole.findMany).toHaveBeenCalledTimes(2);

    now.mockRestore();
  });

  it('re-resolves immediately after the cache is invalidated', async () => {
    const { guard, context, prisma } = createContext(REQUIRE_PERMISSION_KEY);

    await guard.canActivate(context as any);
    permissionCache.invalidate('user-1');
    await guard.canActivate(context as any);

    expect(prisma.userRole.findMany).toHaveBeenCalledTimes(2);
  });

  it('rejects requests without an authenticated user', async () => {
    const { guard, context, prisma } = createContext(REQUIRE_PERMISSION_KEY, null as any);

    await expect(guard.canActivate(context as any)).resolves.toBe(false);

    expect(prisma.userRole.findMany).not.toHaveBeenCalled();
  });
});
