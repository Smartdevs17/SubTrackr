# SubTrackr Disaster Recovery Runbook

## RTO / RPO Targets

| Target                             | Value         | Description                                           |
| ---------------------------------- | ------------- | ----------------------------------------------------- |
| **RTO** (Recovery Time Objective)  | **5 minutes** | Maximum tolerable downtime before service is restored |
| **RPO** (Recovery Point Objective) | **1 hour**    | Maximum tolerable data loss window                    |

These values are enforced in code via `RTO_SECONDS = 300` and `RPO_SECONDS = 3600` in `backend/dr/DisasterRecoveryService.ts`.

---

## Architecture

SubTrackr is a mobile-first React Native app. All user state (subscriptions, wallet, transaction queue, contract cache, oracle prices) is persisted in **AsyncStorage** on the device. The DR service snapshots these keys, stores encrypted manifests alongside the data, and can restore them on demand.

```
AsyncStorage keys backed up:
  subtrackr-subscriptions   — subscription list (Zustand persist)
  subtrackr-wallet          — wallet connection state
  subtrackr-tx-queue        — pending transaction queue
  subtrackr-contract-cache  — Soroban contract state cache
  subtrackr-oracle-prices   — Oracle-sourced price data
```

### Geographic Redundancy

Backups are automatically replicated to replica regions:

| Region           | Role       |
| ---------------- | ---------- |
| `us-east-1`      | Primary    |
| `eu-west-1`      | Replica    |
| `ap-southeast-1` | Replica    |

### Cross-Service Consistency

Each backup includes a **consistency proof** with a version vector and a **contract snapshot** alongside the application state. The `verifyCrossServiceConsistency()` method checks that all service keys are present and that the contract snapshot matches the stored contract data.

---

## Backup Procedure

### Automatic (recommended)

Schedule `disasterRecoveryService.createBackup()` on app foreground/background transitions:

```ts
import { AppState } from 'react-native';
import { disasterRecoveryService } from '../backend/dr/DisasterRecoveryService';

AppState.addEventListener('change', (state) => {
  if (state === 'background') disasterRecoveryService.createBackup();
});
```

### Manual

```ts
const manifest = await disasterRecoveryService.createBackup();
console.log('Backup created:', manifest.id, 'region:', manifest.region);
```

Up to **10 backups** are retained; older ones are pruned automatically. Backups are replicated to all replica regions on creation.

### Contract State Backup

Contract state (oracle prices, Soroban cache) is automatically included in every full backup. For standalone contract state snapshots:

```ts
const { snapshotId, keys } = await disasterRecoveryService.backupContractState();
console.log('Contract snapshot:', snapshotId, 'keys:', keys);
```

---

## Backup Verification

Run after every backup to confirm integrity:

```ts
const result = await disasterRecoveryService.verifyBackup(manifest.id);
if (!result.valid) {
  console.error('Backup invalid:', result.errors);
}
if (result.warnings) {
  console.warn('Backup warnings:', result.warnings);
}
```

Verification checks:

1. Backup exists in storage
2. Checksum (djb2) matches stored value
3. Schema version matches current `BACKUP_VERSION`
4. Backup contains at least one key
5. Contract snapshot matches stored contract keys (warning)
6. Consistency marker matches between proof and manifest (warning)
7. Backup age is within RPO window (warning only — does not block restore)

### Cross-Service Consistency Check

```ts
const consistency = await disasterRecoveryService.verifyCrossServiceConsistency(manifest.id);
if (!consistency.consistent) {
  console.error('Cross-service inconsistency:', consistency.details);
}
```

---

## Failover Procedure

### Automatic failover (data corruption / app crash)

```ts
const result = await disasterRecoveryService.failover();
if (result.success) {
  console.log('Restored keys:', result.restoredKeys);
  if (result.contractRestored) console.log('Contract state also restored');
} else {
  console.error('Failover failed:', result.errors);
}
```

### Region-specific failover

```ts
const result = await disasterRecoveryService.failover('eu-west-1');
```

### Manual restore from a specific backup

```ts
const backups = await disasterRecoveryService.listBackups();
const result = await disasterRecoveryService.restoreBackup(backups[0].id);
```

### Contract State Restore

```ts
// Auto-restore contract state from latest backup
await disasterRecoveryService.restoreContractState();

// Or from a specific snapshot
await disasterRecoveryService.restoreContractState('cs_abc123');
```

---

## RTO/RPO Monitoring

The service automatically tracks RTO and RPO compliance on every backup and restore operation. Breaches are recorded as incidents.

### RTO Monitor

```ts
const rtoReport = await disasterRecoveryService.getRtoMonitorReport();
console.log('RTO breach rate:', rtoReport.breachRate);
console.log('Average restore duration:', rtoReport.averageDurationMs, 'ms');
console.log('Checks in last 24h:', rtoReport.last24hCount);
```

### RPO Monitor

```ts
const rpoReport = await disasterRecoveryService.getRpoMonitorReport();
console.log('RPO breach rate:', rpoReport.breachRate);
console.log('Average backup age:', rpoReport.averageAgeMs, 'ms');
```

### Incident Management

```ts
// View active incidents
const active = await disasterRecoveryService.getActiveIncidents();

// Resolve an incident
await disasterRecoveryService.resolveIncident(incidentId, 'on-call-engineer');

// View incident history
const history = await disasterRecoveryService.getIncidentHistory();
```

---

## DR Drill Scheduling

The DR drill scheduler automates regular testing. Configure it to run on a set interval:

```ts
// Run drill every 24 hours
await disasterRecoveryService.setDrillSchedule(24, true);

// Check if a drill is due
const due = await disasterRecoveryService.checkDrillDue();

// Run the scheduled drill
const result = await disasterRecoveryService.runScheduledDrill();
console.log('Drill passed:', result.passed, 'RTO compliant:', result.rtoCompliant, 'RPO compliant:', result.rpoCompliant);
```

### CI Integration

Add to `package.json`:

```json
"dr:drill": "jest backend/dr/__tests__/DisasterRecoveryService.test.ts --no-coverage",
"chaos": "jest chaos/__tests__/ --no-coverage"
```

Recommended schedule:
- **CI per PR**: Chaos experiments (network partition, service degradation, failure injection, geo partition, backup consistency)
- **Daily**: DR drill
- **Pre-release**: Full DR drill + chaos suite

---

## Geographic Redundancy

### Check Region Health

```ts
const statuses = await disasterRecoveryService.getRegionStatus();
for (const status of statuses) {
  console.log(`${status.region}: ${status.backupCount} backups, healthy=${status.healthy}`);
}

const health = await disasterRecoveryService.checkRegionHealth('eu-west-1');
if (!health.healthy) {
  console.error('Region health issues:', health.issues);
}
```

### Manual Replication

```ts
const count = await disasterRecoveryService.replicateBackupsToRegion('ap-northeast-1');
console.log(`Replicated ${count} backups to ap-northeast-1`);
```

---

## Recovery Runbooks

### Scenario 1 — Corrupted subscription data

**Symptoms:** App crashes on load, subscriptions list empty or malformed.

**Steps:**

1. Call `disasterRecoveryService.failover()`
2. If successful, reload the Zustand store: `useSubscriptionStore.persist.rehydrate()`
3. Verify subscription count matches expected
4. If no backup available, re-sync from Soroban contract via `walletService`

**Expected RTO:** < 1 minute

---

### Scenario 2 — Wallet state lost

**Symptoms:** Wallet shows disconnected after update or device restore.

**Steps:**

1. Call `disasterRecoveryService.failover()`
2. If wallet key restored, re-initialise Freighter connection
3. If not, prompt user to reconnect wallet (social login or Freighter)

**Expected RTO:** < 2 minutes

---

### Scenario 3 — Full device wipe / new device

**Symptoms:** Fresh install, no local data.

**Steps:**

1. No local backups available — AsyncStorage is empty
2. User must re-authenticate via Web3Auth or Freighter
3. Subscription history can be re-fetched from Soroban contract events
4. Manual re-entry required for Web2 subscriptions

**Expected RTO:** < 5 minutes (within RTO target)

---

### Scenario 4 — Backup checksum failure

**Symptoms:** `verifyBackup()` returns `valid: false` with checksum error.

**Steps:**

1. Do **not** restore the corrupted backup
2. Try the next backup: `listBackups()` → iterate and `verifyBackup()` each
3. Restore the first valid backup
4. Delete the corrupted backup: `deleteBackup(corruptedId)`
5. Immediately create a fresh backup after restore

---

### Scenario 5 — Cross-service inconsistency

**Symptoms:** `verifyCrossServiceConsistency()` returns `consistent: false`.

**Steps:**

1. Identify which services are inconsistent from `result.details`
2. Determine which backup has the most complete data
3. Restore from that backup with `restoreBackup(backupId)`
4. If contract state is inconsistent, restore contract state separately: `restoreContractState()`
5. Run `verifyCrossServiceConsistency()` again to confirm

---

### Scenario 6 — Region failover

**Symptoms:** Primary region (`us-east-1`) is unreachable.

**Steps:**

1. Check region health: `checkRegionHealth('eu-west-1')`
2. Fail over to healthy replica: `failover('eu-west-1')`
3. Verify data integrity with `verifyBackup()`
4. Create a fresh backup in the new primary region
5. Alert on-call team about region failover

**Expected RTO:** < 3 minutes

---

### Scenario 7 — DR during active incident

**Symptoms:** System is already degraded when a new failure occurs.

**Steps:**

1. Call `performDrDuringActiveIncident()` — this automatically:
   - Assesses active incidents
   - Runs failover for data corruption / backup failure incidents
   - Attempts region failover for region outage incidents
   - Creates a post-recovery backup
2. Review the step-by-step result
3. Escalate any failed steps to on-call

---

## Regular DR Testing

Run the built-in drill on every CI pipeline and before each release:

```ts
const drill = await disasterRecoveryService.runDrDrill();
console.assert(drill.passed, 'DR drill failed', drill);
console.assert(drill.rtoCompliant, `RTO exceeded: ${drill.recovery.durationMs}ms`);
console.assert(drill.rpoCompliant, `RPO exceeded`);
```

The drill:
1. Creates a backup
2. Verifies it (including cross-service consistency)
3. Restores it (including contract state)
4. Measures restore duration against RTO
5. Checks backup age against RPO
6. Updates region status

### Chaos Engineering Experiments

| Experiment             | Failure Simulated                      | Recovery Mechanism              |
| ---------------------- | -------------------------------------- | ------------------------------- |
| `network-partition`    | Connection refusals (80%)              | Exponential back-off retry      |
| `service-degradation`  | Persistent service timeout             | Circuit breaker                 |
| `failure-injection`    | 30% billing failures                   | Fault-tolerant retry loop       |
| `geo-partition`        | Primary region unavailable             | Failover to replica region      |
| `backup-consistency`   | Mismatched shared data between services | Inconsistency detection alert   |

---

## Chaos Engineering

Run all chaos experiments:

```bash
npx jest chaos/__tests__/ --no-coverage
```

### Geo-Partition Experiment

Simulates primary region failure and validates failover to a replica region:

```ts
import { simulateRegionFailover } from '../chaos/experiments/geo-partition';

const scenario = {
  primary: { region: 'us-east-1', available: false, latencyMs: 0 },
  replicas: [
    { region: 'eu-west-1', available: true, latencyMs: 80 },
  ],
};

const { failoverRegion, failoverDurationMs } = await simulateRegionFailover(operation, scenario);
console.log(`Failed over to ${failoverRegion} in ${failoverDurationMs}ms`);
```

### Backup Consistency Experiment

Simulates cross-service backup inconsistency and validates detection:

```ts
import { simulateCrossServiceBackup } from '../chaos/experiments/backup-consistency';

const check = simulateCrossServiceBackup(appData, contractData);
if (!check.consistent) {
  console.error('Inconsistent keys:', check.mismatches);
}
```

---

## Escalation

| Condition                     | Action                                                               |
| ----------------------------- | -------------------------------------------------------------------- |
| All backups corrupted         | Re-sync from Soroban contract; prompt user                           |
| RTO exceeded in drill         | Investigate AsyncStorage performance; consider reducing backup scope |
| RPO warning on verify         | Increase backup frequency (trigger on every state mutation)          |
| Region health check fails     | Fail over to healthy replica; investigate region                     |
| Cross-service inconsistency   | Identify inconsistent service; restore from most complete backup     |
| Active incident during DR     | Run `performDrDuringActiveIncident()` for automated resolution       |
| RTO/RPO breach rate > 10%    | Escalate to engineering lead; review backup strategy                 |
