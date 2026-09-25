# Audit Logging for Sensitive Operations

## Overview

SubTrackr now audits all sensitive operations through a central registry and
dedicated controller, building on the existing hash-chain audit infrastructure.

## Architecture

### Sensitive Operations Registry (`backend/audit/sensitiveOperations.ts`)

A central catalogue of every operation that must be audited, including:

| Category           | Example Operations                                        |
| ------------------ | --------------------------------------------------------- |
| authentication     | login, logout, password_change, mfa_disable, api_key_rotate |
| payment            | charge, refund, method_add, method_remove                 |
| data_access        | data_export (GDPR)                                        |
| data_modification  | subscription create/cancel/modify, profile_update, data_delete |
| admin              | user_role_change, config_change, billing_plan_change       |
| security           | access_denied, suspicious_activity                         |
| compliance         | data_retention_purge                                       |

Each operation definition includes:
- **severity** — `low` | `medium` | `high` | `critical`
- **captureState** — whether old/new state snapshots are recorded
- **requiresReason** — whether a reason string is mandatory

### Sensitive Operations Audit Controller (`backend/audit/controller/sensitiveOpsAuditController.ts`)

Provides three primary methods:

1. **`audit(operationKey, context)`** — records a simple event
2. **`auditWithState(operationKey, context, oldState, newState)`** — records with state capture
3. **`wrap(operationKey, context, handler, getState?)`** — wraps an async handler, auditing on success or failure

The controller validates operation keys, enforces required metadata (e.g. reason for refunds), and merges category/severity into the audit entry metadata.

## Usage

```typescript
import { HashChainService, AuditWriter, SensitiveOpsAuditController } from './audit';

const chain = new HashChainService();
const writer = new AuditWriter(chain);
const auditController = new SensitiveOpsAuditController(writer);

// Simple audit
auditController.audit('auth.login', {
  actorId: 'user-123',
  resourceId: 'user-123',
  ipAddress: '192.168.1.1',
});

// With state capture
auditController.auditWithState(
  'subscription.cancel',
  { actorId: 'user-123', resourceId: 'sub-1', reason: 'No longer needed' },
  { status: 'active' },
  { status: 'cancelled' },
);

// Wrap an async handler
const charged = auditController.wrap(
  'payment.charge',
  { actorId: 'user-123', resourceId: 'pay-1' },
  async () => chargeCard('user-123', 9.99),
  () => ({ oldState: null, newState: { charged: true } }),
);
```

## Adding New Sensitive Operations

Add an entry to `SENSITIVE_OPERATIONS` in `sensitiveOperations.ts`:

```typescript
'my.new_operation': {
  key: 'my.new_operation',
  label: 'My new operation',
  category: 'data_modification',
  severity: 'medium',
  resourceType: 'my_resource',
  captureState: true,
  requiresReason: false,
},
```

## Testing

```bash
npm run test:backend -- --testPathPattern=sensitiveOperations
```
