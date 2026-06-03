# Role-Based Access Control (RBAC) — Permissions Reference

## Overview

SubTrackr uses a fine-grained RBAC system with three roles: **admin**, **manager**, and **viewer**. Each role carries a defined set of resource-level permissions that control which actions a user can perform.

## Role Hierarchy

```
admin (100)  →  manager (50)  →  viewer (10)
```

Higher-ranked roles **inherit** all permissions from lower roles. An admin can do everything a manager or viewer can.

| Role    | Level | Description                                      |
| ------- | ----- | ------------------------------------------------ |
| Admin   | 100   | Full access to all resources and operations      |
| Manager | 50    | Read/write on most resources, limited delete      |
| Viewer  | 10    | Read-only access to permitted resources           |

## Resources

| Resource          | Description                               |
| ----------------- | ----------------------------------------- |
| `subscriptions`   | Subscription records and lifecycle        |
| `plans`           | Subscription plan definitions             |
| `users`           | User accounts and profiles                |
| `billing`         | Billing operations and invoices           |
| `analytics`       | Analytics data and reports                |
| `settings`        | Application and system settings           |
| `features`        | Feature flag management                   |
| `api_keys`        | API key management                        |
| `audit_logs`      | Audit log access                          |
| `webhooks`        | Webhook configuration                     |
| `campaigns`       | Marketing campaigns                       |
| `support_tickets` | Support ticket management                 |
| `fraud_rules`     | Fraud detection rule configuration        |

## Actions

| Action   | Description                                |
| -------- | ------------------------------------------ |
| `create` | Create new resources                       |
| `read`   | View existing resources                    |
| `update` | Modify existing resources                  |
| `delete` | Remove resources                           |
| `manage` | All actions including admin-level controls |

## Permission Matrix

| Resource          | Admin                | Manager                  | Viewer       |
| ----------------- | -------------------- | ------------------------ | ------------ |
| subscriptions     | create, read, update, delete, manage | create, read, update     | read         |
| plans             | create, read, update, delete, manage | read, update             | read         |
| users             | create, read, update, delete, manage | read                      | read         |
| billing           | create, read, update, delete, manage | read, update             | read         |
| analytics         | create, read, update, delete, manage | read                      | read         |
| settings          | create, read, update, delete, manage | ✗                        | ✗            |
| features          | create, read, update, delete, manage | read                      | read         |
| api_keys          | create, read, update, delete, manage | read, create             | ✗            |
| audit_logs        | read, manage                          | ✗                        | read         |
| webhooks          | create, read, update, delete, manage | read, create, update     | read         |
| campaigns         | create, read, update, delete, manage | read, create, update     | read         |
| support_tickets   | create, read, update, delete, manage | read, update             | read         |
| fraud_rules       | create, read, update, delete, manage | ✗                        | ✗            |

## API

### `AccessControlService`

The service is available at `backend/services/accessControl.ts`.

#### Constructor

```ts
new AccessControlService(auditService: AuditService, alertingService: AlertingService)
```

Requires an `AuditService` instance for role change auditing and an `AlertingService` for unauthorized access alerts.

#### Role Assignment

```ts
assignRole(userId: string, role: Role, assignedBy: string, expiresAt?: number): RoleAssignment
revokeRole(userId: string, revokedBy: string): void
getAssignment(userId: string): RoleAssignment | null
getUserRole(userId: string): Role
getAllAssignments(): RoleAssignment[]
```

#### Permission Checking

```ts
hasPermission(userId: string, resource: Resource, action: Action, options?: AccessCheckOptions): boolean
requirePermission(userId: string, resource: Resource, action: Action, options?: AccessCheckOptions): void
```

`requirePermission` throws `AccessDeniedError` if the user lacks the required permission.

#### Temporary Elevation

```ts
grantTemporaryElevation(userId: string, elevatedRole: Role, grantedBy: string, durationMs: number, reason: string): TemporaryElevation
revokeElevation(elevationId: string, revokedBy: string): void
getActiveElevation(userId: string): TemporaryElevation | null
```

Elevations are automatically expired after `durationMs`. Only users with a role higher than the target role can grant elevations.

#### API Key Scoping

```ts
registerApiKeyScope(apiKeyId: string, permissions: Permission[], options?: { allowedResources?: Resource[]; maxRatePerMinute?: number }): ApiKeyScope
checkApiKeyPermission(apiKeyId: string, resource: Resource, action: Action): boolean
updateApiKeyScope(apiKeyId: string, updates: Partial<ApiKeyScope>): ApiKeyScope | null
getApiKeyScope(apiKeyId: string): ApiKeyScope | null
removeApiKeyScope(apiKeyId: string): void
```

#### Unauthorized Access Monitoring

```ts
getUnauthorizedEvents(filter?: { actorId?: string; resolved?: boolean; since?: number }): UnauthorizedAccessEvent[]
resolveUnauthorizedEvent(eventId: string): void
getUnauthorizedAccessStats(): { total: number; unresolved: number; byActor: Record<string, number>; byResource: Record<string, number> }
```

When 5+ unauthorized events are logged for the same actor, an alert is dispatched through the `AlertingService`.

#### Escalation Prevention

```ts
preventEscalation(actorId: string, targetRole: Role): void
```

Throws `PermissionEscalationError` if the actor tries to assign a role equal to or higher than their own.

### Errors

| Error                    | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `AccessDeniedError`      | Thrown when `requirePermission` fails               |
| `PermissionEscalationError` | Thrown when escalation prevention is triggered    |

## TypeScript Types

All types are exported from `backend/services/accessControl.ts`:

```ts
type Role = 'admin' | 'manager' | 'viewer'
type Resource = 'subscriptions' | 'plans' | 'users' | 'billing' | 'analytics' | 'settings' | 'features' | 'api_keys' | 'audit_logs' | 'webhooks' | 'campaigns' | 'support_tickets' | 'fraud_rules'
type Action = 'create' | 'read' | 'update' | 'delete' | 'manage'
```

## Usage Examples

```ts
import { AccessControlService } from './backend/services/accessControl';
import { AuditService } from './backend/services/auditService';
import { AlertingService } from './backend/services/alerting';

const audit = new AuditService('hmac-secret');
const alerting = new AlertingService();
const acl = new AccessControlService(audit, alerting);

// Assign roles
acl.assignRole('user-abc', 'manager', 'admin-xyz');

// Check permissions
if (acl.hasPermission('user-abc', 'subscriptions', 'create')) {
  // allow operation
}

// Enforce permissions (throws on denial)
acl.requirePermission('user-abc', 'billing', 'delete');

// Temporary elevation
acl.grantTemporaryElevation('user-abc', 'admin', 'admin-xyz', 3600000, 'Incident response');

// API key scoping
acl.registerApiKeyScope('key-123', [
  { resource: 'subscriptions', actions: ['read'] },
  { resource: 'analytics', actions: ['read'] },
]);

// Check unauthorized access
const events = acl.getUnauthorizedEvents({ actorId: 'user-abc' });
```
