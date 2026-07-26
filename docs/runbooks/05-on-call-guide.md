# Runbook: On-Call Guide

Reference for engineers on the SubTrackr on-call rotation.

---

## Responsibilities

- Acknowledge PagerDuty alerts within SLA (P1: 15 min, P2: 1 hour)
- Triage and classify incidents using [02-incident-response.md](./02-incident-response.md)
- Escalate when resolution is not achievable within the SLA window
- Complete shift handoff notes before rotating off

---

## Tools & Access

| Tool                 | Purpose                            | Access                              |
| -------------------- | ---------------------------------- | ----------------------------------- |
| PagerDuty            | Alert routing and escalation       | On-call rotation                    |
| Soroban CLI          | Contract inspection and invocation | `soroban` binary + account identity |
| Stellar Expert       | Contract event explorer            | https://stellar.expert              |
| Stellar Status       | Network health                     | https://status.stellar.org          |
| Monitoring dashboard | `monitoringService.getDashboard()` | App backend                         |
| Audit log            | `auditService.query(...)`          | App backend                         |

---

## Start of Shift

1. Review open incidents and alerts from the outgoing engineer
2. Check monitoring dashboard for any active alerts:
   ```ts
   monitoringService.getActiveAlerts();
   ```
3. Verify contract is reachable:
   ```bash
   soroban contract invoke --id $CONTRACT_ID --network $NETWORK -- get_subscription_count
   ```
4. Confirm DR drill is green (run if last drill was >24 hours ago):
   ```bash
   npm run dr:drill
   ```
5. Review recent audit log for anomalies:
   ```ts
   auditService.query({ from: Date.now() - 86_400_000 }); // last 24h
   ```

---

## Alert Response Quick Reference

| Alert                   | Runbook                                                                                        | First Action                     |
| ----------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------- |
| `high-failure-rate`     | [02-incident-response.md](./02-incident-response.md#scenario-a--high-transaction-failure-rate) | Check `dashboard.recentMetrics`  |
| `gas-spike`             | [02-incident-response.md](./02-incident-response.md)                                           | Check for runaway charge loops   |
| Contract unreachable    | [02-incident-response.md](./02-incident-response.md#scenario-b--contract-unreachable)          | Check https://status.stellar.org |
| Notification outage     | [02-incident-response.md](./02-incident-response.md#scenario-d--notification-delivery-failure) | Check Expo push service          |
| Backup checksum failure | [04-troubleshooting.md](./04-troubleshooting.md#backup-checksum-failure)                       | List and verify all backups      |
| Audit chain break       | [04-troubleshooting.md](./04-troubleshooting.md#audit-chain-verification-fails)                | Treat as P1 security incident    |

---

## Escalation Matrix

| Condition                           | Escalate To               | How                                |
| ----------------------------------- | ------------------------- | ---------------------------------- |
| P1 incident unresolved after 15 min | Engineering lead          | PagerDuty escalation policy        |
| Contract redeployment required      | Contract admin key holder | Direct contact                     |
| Security breach suspected           | Security team             | security@subtrackr.example.com     |
| Stellar network outage              | No internal escalation    | Monitor https://status.stellar.org |

---

## Common Commands

```bash
# Check contract health
soroban contract invoke --id $CONTRACT_ID --network $NETWORK -- get_subscription_count
soroban contract invoke --id $CONTRACT_ID --network $NETWORK -- get_plan_count

# Inspect a subscription
soroban contract invoke --id $CONTRACT_ID --network $NETWORK \
  -- get_subscription --subscription_id <ID>

# Deactivate a plan (containment)
soroban contract invoke --id $CONTRACT_ID --network $NETWORK \
  -- deactivate_plan --merchant $MERCHANT --plan_id <ID>

# Run DR drill
npm run dr:drill

# Run integration tests
npx jest --testPathPattern="integration" --no-coverage
```

---

## End of Shift Handoff

Complete the following before rotating off:

- [ ] All P1/P2 incidents resolved or handed off with context
- [ ] Open alerts documented with current status
- [ ] Any contract state changes (deactivations, refunds) logged
- [ ] Handoff notes written and shared with incoming engineer
- [ ] DR drill run if not done in the last 24 hours

---

## Useful References

- [Subscription Lifecycle](./01-subscription-lifecycle.md)
- [Incident Response](./02-incident-response.md)
- [Deployment Procedures](./03-deployment.md)
- [Troubleshooting Guide](./04-troubleshooting.md)
- [Disaster Recovery Runbook](../DISASTER_RECOVERY_RUNBOOK.md)
- [API Reference](../API.md)
- [Security Policy](../security.md)
