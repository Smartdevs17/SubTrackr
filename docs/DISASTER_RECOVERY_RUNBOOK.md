# SubTrackr Disaster Recovery Runbook

## RTO / RPO Targets

| Target                             | Value         | Description                                           |
| ---------------------------------- | ------------- | ----------------------------------------------------- |
| **RTO** (Recovery Time Objective)  | **5 minutes** | Maximum tolerable downtime before service is restored |
| **RPO** (Recovery Point Objective) | **1 hour**    | Maximum tolerable data loss window                    |

These values are enforced in code via `RTO_SECONDS = 300` and `RPO_SECONDS = 3600` in `backend/dr/DisasterRecoveryService.ts`.

---

## Architecture

SubTrackr is a mobile-first React Native app. All user state (subscriptions, wallet, transaction queue) is persisted in **AsyncStorage** on the device. The DR service snapshots these keys, stores encrypted manifests alongside the data, and can restore them on demand.

```
AsyncStorage keys backed up:
  subtrackr-subscriptions   — subscription list (Zustand persist)
  subtrackr-wallet          — wallet connection state
  subtrackr-tx-queue        — pending transaction queue
```

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
console.log('Backup created:', manifest.id, 'checksum:', manifest.checksum);
```

Up to **5 backups** are retained; older ones are pruned automatically.

---

## Backup Verification

Run after every backup to confirm integrity:

```ts
const result = await disasterRecoveryService.verifyBackup(manifest.id);
if (!result.valid) {
  console.error('Backup invalid:', result.errors);
}
```

Verification checks:

1. Backup exists in storage
2. Checksum (djb2) matches stored value
3. Schema version matches current `BACKUP_VERSION`
4. Backup age is within RPO window (warning only — does not block restore)

---

## Failover Procedure

### Automatic failover (data corruption / app crash)

```ts
const result = await disasterRecoveryService.failover();
if (result.success) {
  console.log('Restored keys:', result.restoredKeys);
  // Reload app state from AsyncStorage
} else {
  console.error('Failover failed:', result.errors);
  // Escalate: prompt user to re-authenticate / re-sync from chain
}
```

`failover()` iterates backups newest-first, verifies each, and restores the first valid one.

### Manual restore from a specific backup

```ts
const backups = await disasterRecoveryService.listBackups();
const result = await disasterRecoveryService.restoreBackup(backups[0].id);
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

## Regular DR Testing

Run the built-in drill on every CI pipeline and before each release:

```ts
const drill = await disasterRecoveryService.runDrDrill();
console.assert(drill.passed, 'DR drill failed', drill);
console.assert(drill.rtoCompliant, `RTO exceeded: ${drill.recovery.durationMs}ms`);
```

The drill:

1. Creates a backup
2. Verifies it
3. Restores it
4. Measures restore duration against RTO

**CI integration** — add to `package.json` scripts:

```json
"dr:drill": "jest backend/dr/__tests__/DisasterRecoveryService.test.ts --no-coverage"
```

---

## Escalation

| Condition             | Action                                                               |
| --------------------- | -------------------------------------------------------------------- |
| All backups corrupted | Re-sync from Soroban contract; prompt user                           |
| RTO exceeded in drill | Investigate AsyncStorage performance; consider reducing backup scope |
| RPO warning on verify | Increase backup frequency (trigger on every state mutation)          |
