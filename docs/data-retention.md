# Data Retention Policy Enforcement

SubTrackr enforces GDPR storage limitation (Article 5(1)(e)) by automatically deleting,
anonymizing or archiving data once it passes its retention period. The implementation
lives in `backend/gdpr/` alongside the export and erasure tooling.

| File                         | Purpose                                                       |
| :--------------------------- | :------------------------------------------------------------ |
| `dataRetentionService.ts`    | Policy registry, legal holds, enforcement engine and reports  |
| `retentionEnforcementJob.ts` | Scheduler that runs enforcement on an interval (daily default) |
| `retentionController.ts`     | REST-style handlers for policy, hold and enforcement endpoints |

## Concepts

### Policies

A policy governs exactly one data source:

```ts
{
  id: 'deactivated-account-logs',
  source: 'activity_logs',   // matches a registered RetentionDataStore.sourceName
  retentionDays: 90,         // integer, 1–3650
  action: 'delete',          // 'delete' | 'anonymize' | 'archive'
  enabled: true,
  batchSize: 1000,           // optional, max records processed per run
}
```

Records whose timestamp is at or before `now - retentionDays` are expired. Policies are
validated on write (`validateRetentionPolicy`) and a source may only be governed by one policy.

### Default policies

`DEFAULT_RETENTION_POLICIES` mirrors the commitments in [gdpr.md](gdpr.md#4-retention-policy):

| Policy                     | Source            | Retention | Action    |
| :------------------------- | :---------------- | :-------- | :-------- |
| `deactivated-account-logs` | `activity_logs`   | 90 days   | delete    |
| `notification-history`     | `notifications`   | 180 days  | delete    |
| `billing-records`          | `billing_records` | 7 years   | anonymize |
| `audit-logs`               | `audit_logs`      | 7 years   | archive   |

### Data stores

Each data source plugs in by implementing `RetentionDataStore`:

```ts
const store: RetentionDataStore = {
  sourceName: 'activity_logs',
  findExpired: (cutoff, limit) => repo.findOlderThan(cutoff, limit), // [{ id, userId?, timestamp }]
  deleteRecords: (ids) => repo.deleteMany(ids),
  anonymizeRecords: (ids) => repo.anonymize(ids), // required for 'anonymize' policies
  archiveRecords: (ids) => repo.moveToColdStorage(ids), // required for 'archive' policies
};
retentionService.registerStore(store);
```

As a safety net, the engine re-checks every returned timestamp against the cutoff, so a
misbehaving store can never cause unexpired data to be removed.

### Legal holds

Legal holds exempt data from enforcement until released — for example during litigation
or a regulatory investigation.

- `scope: 'user'` holds every record owned by `targetId` (a userId).
- `scope: 'record'` holds a single record id.
- An optional `source` restricts the hold to one data source.

Held records are counted in `skippedLegalHold` in the report and remain untouched.

## Enforcement

```ts
import {
  DataRetentionService,
  DEFAULT_RETENTION_POLICIES,
  RetentionEnforcementJob,
} from './backend/gdpr';

const retention = new DataRetentionService(DEFAULT_RETENTION_POLICIES);
retention.registerStore(activityLogStore);

const job = new RetentionEnforcementJob(retention, {
  intervalMs: 24 * 60 * 60 * 1000,
  onReport: (report) => auditService.log('retention.enforced', report),
});
job.start();
```

`enforce({ dryRun, policyIds, now })` returns a `RetentionEnforcementReport`:

- `dryRun: true` reports what _would_ be processed without modifying data.
- Failures are isolated per policy: a missing store, an unsupported action or a store
  error is recorded in that policy's `error` and listed in `failedPolicies`; other
  policies still run.
- Only one run may execute at a time; a concurrent call throws `RetentionPolicyError`
  (the job silently skips overlapping ticks).
- The last 50 reports are kept in memory (`getLastReport`, `listReports`).

## API

`RetentionController` returns `GdprApiResponse` objects, matching `GdprController`.

| Method & path                            | Handler                  | Notes                                 |
| :--------------------------------------- | :----------------------- | :------------------------------------ |
| `GET /gdpr/retention/policies`           | `handleListPolicies`     |                                       |
| `PUT /gdpr/retention/policies/:id`       | `handleUpsertPolicy`     | 400 on validation error               |
| `DELETE /gdpr/retention/policies/:id`    | `handleRemovePolicy`     | 404 if unknown                        |
| `POST /gdpr/retention/enforce`           | `handleEnforce`          | Body `{ dryRun?, policyIds? }`; 409 if running |
| `GET /gdpr/retention/reports?limit=`     | `handleListReports`      | Default limit 10                      |
| `GET /gdpr/retention/holds`              | `handleListLegalHolds`   | Active holds only                     |
| `POST /gdpr/retention/holds`             | `handlePlaceLegalHold`   | Body `{ scope, targetId, reason, source? }` |
| `POST /gdpr/retention/holds/:id/release` | `handleReleaseLegalHold` | 404 if unknown or already released    |

## Testing

```bash
npm run test:backend -- backend/gdpr/__tests__/dataRetention.test.ts
```
