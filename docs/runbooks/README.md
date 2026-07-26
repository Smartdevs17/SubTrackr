# SubTrackr Runbook Index

Operational runbooks for the SubTrackr platform. Each runbook covers a specific domain and is intended for on-call engineers and operations staff.

## Runbooks

| Runbook                                                        | Description                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| [01-subscription-lifecycle.md](./01-subscription-lifecycle.md) | Managing subscription states, billing cycles, and edge cases   |
| [02-incident-response.md](./02-incident-response.md)           | Incident classification, escalation, and resolution procedures |
| [03-deployment.md](./03-deployment.md)                         | Contract and app deployment procedures for all environments    |
| [04-troubleshooting.md](./04-troubleshooting.md)               | Diagnosing and resolving common operational issues             |
| [05-on-call-guide.md](./05-on-call-guide.md)                   | On-call responsibilities, tools, and shift handoff             |

## Quick Reference

### Severity Levels

| Level         | Response Time     | Examples                                                |
| ------------- | ----------------- | ------------------------------------------------------- |
| P1 — Critical | 15 min            | Contract unresponsive, mass payment failures, data loss |
| P2 — High     | 1 hour            | Elevated failure rate (>10%), notification outage       |
| P3 — Medium   | 4 hours           | Single-user billing issue, slow queries                 |
| P4 — Low      | Next business day | UI glitch, minor doc gap                                |

### Key Contacts

| Role             | Contact                        |
| ---------------- | ------------------------------ |
| On-call engineer | PagerDuty rotation             |
| Contract admin   | Soroban admin key holder       |
| Security         | security@subtrackr.example.com |

### RTO / RPO

| Target | Value     |
| ------ | --------- |
| RTO    | 5 minutes |
| RPO    | 1 hour    |

See [DISASTER_RECOVERY_RUNBOOK.md](../DISASTER_RECOVERY_RUNBOOK.md) for full DR procedures.
