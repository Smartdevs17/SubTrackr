# Runbook: Incident Response

Procedures for detecting, classifying, escalating, and resolving incidents in SubTrackr.

---

## Severity Classification

| Severity      | Criteria                                                        | Initial Response  | Escalation                      |
| ------------- | --------------------------------------------------------------- | ----------------- | ------------------------------- |
| P1 — Critical | Service down, mass payment failures, data loss, security breach | 15 min            | Immediate — wake on-call lead   |
| P2 — High     | Failure rate >10%, notification outage, contract unreachable    | 1 hour            | After 30 min without resolution |
| P3 — Medium   | Single-user billing issue, degraded performance                 | 4 hours           | Next business day if unresolved |
| P4 — Low      | UI glitch, minor doc gap, non-critical warning                  | Next business day | N/A                             |

---

## Incident Response Lifecycle

```
Detect → Triage → Contain → Investigate → Resolve → Post-mortem
```

### 1. Detect

Alerts fire from:

- `MonitoringService` — transaction failure rate >30% triggers `high-failure-rate` alert
- `MonitoringService` — avg gas >500,000 triggers `gas-spike` alert
- `AlertingService` — dispatches to Slack / PagerDuty / console
- Manual report from user or merchant

### 2. Triage

Acknowledge the alert in PagerDuty within the SLA window. Determine:

- Is the contract reachable on Soroban RPC?
- Is the failure isolated (single user/plan) or widespread?
- Is there a security component (unauthorized access, data exposure)?

```bash
# Quick health check — get total subscription count
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_subscription_count
```

### 3. Contain

Stop the bleeding before investigating root cause.

| Scenario              | Containment Action                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Mass payment failures | Pause affected plans via `deactivate_plan`                                                |
| Compromised admin key | Rotate key; redeploy contract if necessary                                                |
| Runaway charge loop   | Identify caller; block at RPC level if possible                                           |
| Corrupted local state | Trigger DR failover (see [DISASTER_RECOVERY_RUNBOOK.md](../DISASTER_RECOVERY_RUNBOOK.md)) |

### 4. Investigate

Check monitoring dashboard:

```ts
const dashboard = monitoringService.getDashboard();
// {
//   totalTransactions, successRate, failureCount,
//   avgGasUsed, activeAlerts, recentMetrics
// }
```

Query audit log for suspicious activity:

```ts
const events = auditService.query({
  from: Date.now() - 3_600_000, // last hour
  action: 'SUBSCRIPTION_CANCELLED',
});
```

Check active alerts:

```ts
const alerts = monitoringService.getActiveAlerts();
```

### 5. Resolve

Apply fix. Resolve the alert once confirmed stable:

```ts
monitoringService.resolveAlert(alertId);
```

Notify affected users via notification service if billing was impacted:

```ts
await notificationService.presentChargeFailedNotification(
  sub,
  'Service disruption — no charge applied'
);
```

### 6. Post-mortem

For P1/P2 incidents, complete a post-mortem within 48 hours covering:

- Timeline of events
- Root cause
- Impact (users affected, revenue impact)
- Corrective actions with owners and due dates

---

## Common Incident Scenarios

### Scenario A — High Transaction Failure Rate

**Alert:** `high-failure-rate` (failure rate >30%)

**Steps:**

1. Check `dashboard.failureCount` and `dashboard.recentMetrics`
2. Identify if failures are concentrated on a specific plan or token
3. Verify token contract is operational on the relevant chain
4. If token contract is down, deactivate affected plans temporarily
5. Resolve alert once failure rate drops below threshold

---

### Scenario B — Contract Unreachable

**Symptoms:** All `soroban contract invoke` calls time out or return RPC errors.

**Steps:**

1. Check Stellar network status: https://status.stellar.org
2. Try alternate RPC endpoint (testnet: `https://soroban-testnet.stellar.org`, mainnet: `https://soroban.stellar.org`)
3. If network-wide outage, communicate status to users; no action on contract needed
4. If isolated RPC issue, switch `SOROBAN_RPC_URL` env var and redeploy app config

---

### Scenario C — Unauthorized Refund Approvals

**Symptoms:** Unexpected `refund_approved` events in contract event stream.

**Steps:**

1. Immediately rotate the admin key
2. Query all recent `approve_refund` calls via Soroban event stream
3. Assess financial impact
4. If contract admin key is compromised, redeploy contract with new admin
5. File security advisory (see [SECURITY.md](../SECURITY.md))

---

### Scenario D — Notification Delivery Failure

**Symptoms:** Users not receiving billing reminders or charge notifications.

**Steps:**

1. Check Expo push notification service status
2. Verify `notificationService.getPermissionStatus()` returns `GRANTED` for affected users
3. Confirm `syncRenewalReminders` is being called after subscription mutations
4. Check Android notification channel is configured: `ensureAndroidNotificationChannel()`
5. Re-sync reminders manually if needed

---

## Escalation Contacts

| Condition                    | Escalate To                                                |
| ---------------------------- | ---------------------------------------------------------- |
| P1 security incident         | Security team + on-call lead immediately                   |
| Contract redeployment needed | Contract admin key holder                                  |
| Stellar network outage       | Monitor https://status.stellar.org; no internal escalation |
| Persistent P2 >2 hours       | Engineering lead                                           |
