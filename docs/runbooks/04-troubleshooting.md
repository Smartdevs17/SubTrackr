# Runbook: Troubleshooting Guide

Diagnosis and resolution steps for common operational issues.

---

## Contract Issues

### "Plan is not active" on subscribe

**Cause:** The plan was deactivated via `deactivate_plan`.

**Diagnosis:**

```bash
soroban contract invoke --id $CONTRACT_ID --network $NETWORK \
  -- get_plan --plan_id <ID>
# Check: "active": false
```

**Resolution:** Deactivation is irreversible. Create a new plan with the same parameters.

---

### "Already subscribed to this plan"

**Cause:** The subscriber has an existing Active or Paused subscription to this plan.

**Diagnosis:**

```bash
soroban contract invoke --id $CONTRACT_ID --network $NETWORK \
  -- get_user_subscriptions --subscriber $ADDRESS
# Find the existing subscription ID, then:
soroban contract invoke --id $CONTRACT_ID --network $NETWORK \
  -- get_subscription --subscription_id <ID>
```

**Resolution:** Cancel the existing subscription first, then re-subscribe.

---

### "Payment not yet due" on charge

**Cause:** `next_charge_at` is in the future.

**Diagnosis:**

```bash
soroban contract invoke --id $CONTRACT_ID --network $NETWORK \
  -- get_subscription --subscription_id <ID>
# Compare next_charge_at (Unix timestamp) with current time
```

**Resolution:** Wait until `next_charge_at`. No action needed.

---

### "No pending refund request" on approve/reject

**Cause:** `refund_requested_amount` is 0 — no refund was requested, or it was already processed.

**Diagnosis:**

```bash
soroban contract invoke --id $CONTRACT_ID --network $NETWORK \
  -- get_subscription --subscription_id <ID>
# Check: "refund_requested_amount": 0
```

**Resolution:** Confirm with the subscriber whether they submitted a refund request.

---

### Contract invocation times out

**Cause:** RPC endpoint is unreachable or overloaded.

**Steps:**

1. Check Stellar network status: https://status.stellar.org
2. Try the alternate RPC:
   ```bash
   export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org  # testnet
   # or
   export SOROBAN_RPC_URL=https://soroban.stellar.org          # mainnet
   ```
3. Retry the invocation
4. If persistent, open an incident (P2)

---

## Wallet Issues

### Wallet shows disconnected after app update

**Cause:** AsyncStorage wallet key may have been cleared or schema changed.

**Steps:**

1. Trigger DR failover to restore from backup:
   ```ts
   const result = await disasterRecoveryService.failover();
   ```
2. If wallet key is restored, re-initialise Freighter connection
3. If no backup, prompt user to reconnect wallet

---

### "Wallet network does not match selected chain"

**Cause:** The wallet is connected to a different chain than the operation requires.

**Resolution:** Instruct the user to switch networks in their wallet to match the required chain ID.

| Chain    | Chain ID |
| -------- | -------- |
| Ethereum | 1        |
| Polygon  | 137      |
| Arbitrum | 42161    |

---

### "Monthly amount is too small to stream"

**Cause:** Superfluid flow rate rounds to zero per second (amount too small).

**Resolution:** Increase the monthly amount. Minimum viable amount: `1 / 2,592,000` of the token's smallest unit per second must be non-zero.

---

### Gas estimation fails for Superfluid createFlow

**Cause:** RPC connectivity issue or unsupported token.

**Steps:**

1. Verify the token is a supported Superfluid super token
2. Check chain RPC connectivity
3. Retry — transient RPC failures are common

---

## Notification Issues

### Renewal reminders not firing

**Diagnosis checklist:**

- [ ] `notificationService.getPermissionStatus()` returns `GRANTED`
- [ ] `subscription.isActive === true`
- [ ] `subscription.notificationsEnabled !== false`
- [ ] `subscription.nextBillingDate` is in the future
- [ ] Android: `ensureAndroidNotificationChannel()` was called at startup
- [ ] `syncRenewalReminders` was called after the last subscription mutation

**Resolution:** Re-sync reminders:

```ts
await notificationService.syncRenewalReminders(allSubscriptions);
```

---

### Charge success/failure notification not shown

**Cause:** `presentChargeSuccessNotification` / `presentChargeFailedNotification` not called after billing outcome.

**Resolution:** Ensure `recordBillingOutcome` in `subscriptionStore` is called with the correct outcome after every charge attempt.

---

## Monitoring & Alerting Issues

### Alert not firing despite high failure rate

**Diagnosis:**

```ts
const dashboard = monitoringService.getDashboard();
console.log(dashboard.successRate, dashboard.failureCount);

// Check if rule exists
// Rules are set at MonitoringService construction time
```

**Resolution:** Verify `MonitoringService` was instantiated with `defaultRules()` or the custom rule was added via `addRule()`.

---

### Duplicate alerts firing

**Cause:** `resolveAlert` was not called after the previous incident was resolved.

**Resolution:**

```ts
const active = monitoringService.getActiveAlerts();
// Resolve stale alerts
active.forEach((a) => monitoringService.resolveAlert(a.id));
```

---

## Backup & Recovery Issues

### Backup checksum failure

**Diagnosis:**

```ts
const result = await disasterRecoveryService.verifyBackup(manifest.id);
console.log(result.errors);
```

**Resolution:**

1. Do not restore the corrupted backup
2. List all backups and verify each:
   ```ts
   const backups = await disasterRecoveryService.listBackups();
   for (const b of backups) {
     const v = await disasterRecoveryService.verifyBackup(b.id);
     if (v.valid) {
       /* restore this one */ break;
     }
   }
   ```
3. Delete the corrupted backup after restoring a valid one

---

### DR drill fails RTO check

**Cause:** Restore duration exceeded 5 minutes (300,000ms).

**Steps:**

1. Check AsyncStorage size — large subscription lists slow restore
2. Consider reducing backup scope to critical keys only
3. Profile `restoreBackup()` to identify the slow step

---

## Audit Log Issues

### Audit chain verification fails

**Diagnosis:**

```ts
const result = auditService.verify();
console.log(result.firstInvalidIndex);
```

**Cause:** Log was tampered with or the HMAC secret changed between events.

**Resolution:**

- Do not delete or modify audit events
- If secret rotation is needed, export the current log first:
  ```ts
  const csv = auditService.export('csv');
  ```
- Treat chain break as a potential security incident (P1)
