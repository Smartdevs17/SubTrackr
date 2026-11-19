# RBAC Permission Cache

`PermissionGuard` runs on every route decorated with `@RequirePermission(...)`.
Before this change each guarded request performed a `userRole` join to resolve
the caller's effective permissions. Role assignments change far less often than
requests arrive, so the resolved list is now memoised.

## Behaviour

- **Location**: `backend/auth/rbac/permissionCache.ts`
- **Key**: user id
- **Value**: a frozen copy of the user's resolved permission strings
- **TTL**: 30 s (`DEFAULT_PERMISSION_CACHE_TTL_MS`)
- **Miss path**: always falls back to the database; the cache is never
  authoritative.

The audit-log write is intentionally *not* cached — every request still records
an `ALLOW`/`DENY` entry.

## Invalidation

| Mutation | Action |
| --- | --- |
| `RoleService.assignRoleToUser` | `invalidate(actorId)`, `invalidate(targetUserId)` |
| `RoleService.deleteRole` | `clear()` (re-assignment touches an unknown set of users) |

The TTL is the safety net for any mutation path that forgets to invalidate, so
a stale grant can never outlive the TTL window. Keep the TTL short when adding
new permission-mutating endpoints.

## Testing

- `backend/auth/rbac/__tests__/permissionCache.test.ts` — cache semantics.
- `backend/auth/middleware/__tests__/permission.guard.test.ts` — reuse, TTL
  expiry, denial caching and invalidation from the guard's perspective.
- `backend/auth/rbac/__tests__/role.service.test.ts` — invalidation on the
  mutation paths.
