# Data Retention and Purge Jobs

## Overview

SubTrackr enforces data retention policies to prevent unbounded data growth.
The system defines how long each category of data may be kept and automatically
purges, anonymizes, or archives expired records on a schedule.

## Architecture

```
┌─────────────────────────┐
│  PurgeJobScheduler      │  Coordinates everything
│  (purgeJobScheduler.ts) │
└───────────┬─────────────┘
            │
  ┌─────────┴─────────┐
  │                   │
  ▼                   ▼
┌─────────────┐   ┌──────────────────┐
│ DataRetention│   │ RetentionEnforce │
│ Service      │   │ mentJob          │
│ (policies,   │   │ (periodic runner)│
│  holds,      │   └──────────────────┘
│  enforce)    │
└──────┬───────┘
       │
       ▼
┌─────────────────────┐
│ PostgresRetention   │  SQL-backed store
│ Store               │  (findExpired, delete,
│ (per data source)   │   anonymize, archive)
└─────────────────────┘
```

## Default Retention Policies

| Policy ID | Source | Retention | Action | Description |
|---|---|---|---|---|
| `deactivated-account-logs` | `activity_logs` | 90 days | delete | Activity logs of deactivated accounts |
| `notification-history` | `notifications` | 180 days | delete | Delivered notification history |
| `billing-records` | `billing_records` | 7 years | anonymize | Invoices and payment records (tax/accounting) |
| `audit-logs` | `audit_logs` | 7 years | archive | Security and compliance audit trail |

### Actions

- **delete** — Records are permanently deleted from the database.
- **anonymize** — PII columns (email, name, phone, address) are set to NULL.
- **archive** — Records are marked with `archived_at = now()` for later migration to cold storage.

## Legal Holds

Legal holds prevent records from being purged regardless of their age. Holds
can be scoped to:

- **user** — all records for a given user ID are protected
- **record** — a specific record ID is protected

Holds can optionally be restricted to a single data source. The
`PostgresRetentionStore` checks the `retention_legal_holds` table before
returning expired records, so held records are never acted upon.

## Database Tables (migration 010)

### `retention_policies`
Persistent policy definitions. Loaded on startup and merged with
`DEFAULT_RETENTION_POLICIES`.

### `retention_enforcement_log`
Append-only audit trail. One row per policy per enforcement run, recording
cutoff timestamp, records found, legal-hold skips, records processed, and
any errors.

### `retention_legal_holds`
Persistent legal holds that survive application restarts.

## Scheduling

The `PurgeJobScheduler` starts a `RetentionEnforcementJob` that runs
enforcement every 24 hours by default. The interval is configurable:

```typescript
const scheduler = new PurgeJobScheduler(pool, {
  intervalMs: 12 * 60 * 60 * 1000, // every 12 hours
});
await scheduler.start();
```

Manual enforcement is also available:

```typescript
const report = await scheduler.runNow();
```

## REST API

The `RetentionController` exposes endpoints for policy management, legal
holds, and manual enforcement:

| Method | Path | Description |
|---|---|---|
| GET | `/gdpr/retention/policies` | List all policies |
| PUT | `/gdpr/retention/policies/:id` | Create or update a policy |
| DELETE | `/gdpr/retention/policies/:id` | Remove a policy |
| POST | `/gdpr/retention/enforce` | Trigger enforcement (optional `dryRun`, `policyIds`) |
| GET | `/gdpr/retention/reports` | List enforcement reports |
| POST | `/gdpr/retention/holds` | Place a legal hold |
| POST | `/gdpr/retention/holds/:id/release` | Release a legal hold |
| GET | `/gdpr/retention/holds` | List active legal holds |

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `RETENTION_INTERVAL_MS` | `86400000` | Enforcement interval (ms) |
| `RETENTION_BATCH_SIZE` | `1000` | Max records per policy per run |
