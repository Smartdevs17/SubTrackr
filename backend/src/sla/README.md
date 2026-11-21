# SLA monitoring

`backend/src/sla` measures each subscription against its tier's SLA. It alerts
while a breach is developing, and it issues service credits exactly once when
a billing period closes.

| File            | Responsibility                                                                  |
| --------------- | ------------------------------------------------------------------------------- |
| `types.ts`      | Public types and the injected collaborator interfaces                           |
| `tiers.ts`      | Default tier policies and validation                                            |
| `calculator.ts` | Pure maths: periods, downtime intervals, latency histogram, evaluation, credits |
| `monitor.ts`    | State, alerting, credit settlement, logs and metrics                            |

Nothing here talks to the network directly. Credits go through
`CreditService.issueCredit` (`backend/services/billing/creditService.ts`), and
alerts go through `AlertingService.dispatch`
(`backend/services/notification/alerting.ts`).

## Wiring

```ts
import { createSlaMonitor } from './sla';
import { creditService } from '../../services/billing/creditService';
import { AlertingService } from '../../services/notification/alerting';
import { logger } from './utils/logger';

const sla = createSlaMonitor({
  creditIssuer: creditService,
  alerts: new AlertingService([{ type: 'slack', webhookUrl: process.env.SLA_SLACK_WEBHOOK }]),
  logger,
  metrics, // anything with increment(name, labels) / gauge(name, value, labels)
});

sla.register({ subscriptionId: 'sub_1', accountId: 'acct_1', tier: 'enterprise', periodFee: 499 });

// Instrumentation
sla.recordRequest('sub_1', { latencyMs: 182, ok: true });
const incident = sla.openIncident({ description: 'API 5xx' }); // all subscriptions
sla.resolveIncident(incident.id);
sla.scheduleMaintenance(start, end, undefined, 'DB upgrade'); // excluded from downtime

// Schedulers
setInterval(() => void sla.check(), 60_000); // live alerts and gauges
cron('0 1 * * *', () => sla.closeCompletedPeriods()); // credits for finished months
```

## Model

- **Period:** the UTC calendar month. A subscription enrolled mid-month is
  measured from its enrolment time.
- **Uptime:** the measured time is the period minus maintenance windows.
  Downtime is outage time outside maintenance. An open incident counts until
  now.
- **Downtime budget:** `measured time × (100 − target) / 100`, over the whole
  period. A live check reports an uptime breach when downtime goes over the
  budget, which is the moment the month can no longer meet its target. An
  early outage that dents the ratio briefly doesn't count. An _at-risk_
  warning fires once `atRiskBudgetPercent` of the budget is used.
- **Latency and error rate:** p95 latency comes from a fixed-bucket histogram
  (bounded memory, and it never under-reports). Both are judged only after
  `minRequests` requests (100 by default) in the period.

## Default tiers

| Tier       | Uptime | p95 | Errors | Uptime credits (% of fee)    | Latency / error credit | Cap  | Breach alert |
| ---------- | ------ | --- | ------ | ---------------------------- | ---------------------- | ---- | ------------ |
| free       | 99.0%  | 5 s | 5%     | none                         | none                   | 0%   | info         |
| basic      | 99.0%  | 5 s | 2%     | <99: 5, <95: 15              | none                   | 15%  | info         |
| premium    | 99.5%  | 2 s | 1%     | <99.5: 10, <99: 25, <95: 50  | +5 each                | 50%  | warning      |
| enterprise | 99.9%  | 1 s | 0.5%   | <99.9: 10, <99: 25, <95: 100 | +10 each               | 100% | critical     |

Pass `tiers` to `createSlaMonitor` to override them. Policies are validated at
startup, so a schedule that credits less for worse uptime is rejected.

## Credit settlement

`closePeriod(subscriptionId, periodStart)` and `closeCompletedPeriods()`
evaluate a finished month and settle it once:

| Outcome                              | Status     | Behaviour                                                                                    |
| ------------------------------------ | ---------- | -------------------------------------------------------------------------------------------- |
| Compliant, or the tier has no credit | `not_owed` | Recorded. Never re-evaluated.                                                                |
| Credit issued                        | `issued`   | One ledger entry (actor `system:sla`). Closing again returns the same record.                |
| `issueCredit` throws                 | `failed`   | Logged, counted and alerted. The next close retries the same amount against the same report. |

Closing a period that hasn't ended throws `SlaError('period_open')`.

## Alerts

Each alert has a deterministic id, `sla:<subscription>:<periodStart>:<kind>:<metric>`,
so it fires once per period. `AlertingService` deduplicates by id as well.
A failed dispatch is logged and retried on the next `check()`.

| Rule                                             | Severity                            |
| ------------------------------------------------ | ----------------------------------- |
| `sla-breach-uptime` / `-latency` / `-error_rate` | the tier's `breachAlertSeverity`    |
| `sla-at-risk-uptime`                             | warning (info for info-level tiers) |
| `sla-credit-failed`                              | warning                             |

## Metrics

| Metric                                                                                                       | Type    | Labels                    |
| ------------------------------------------------------------------------------------------------------------ | ------- | ------------------------- |
| `sla_uptime_percent`, `sla_downtime_budget_consumed_percent`, `sla_p95_latency_ms`, `sla_error_rate_percent` | gauge   | `subscription_id`, `tier` |
| `sla_monitored_subscriptions`                                                                                | gauge   | none                      |
| `sla_credit_amount`                                                                                          | gauge   | `subscription_id`, `tier` |
| `sla_alerts_total`                                                                                           | counter | `rule`, `severity`        |
| `sla_alert_failures_total`                                                                                   | counter | `rule`                    |
| `sla_incidents_total`                                                                                        | counter | `kind`                    |
| `sla_periods_closed_total`                                                                                   | counter | `tier`, `compliant`       |
| `sla_credits_issued_total`, `sla_credit_failures_total`                                                      | counter | `tier`                    |

## Relation to other SLA code

`backend/services/shared/slaMonitoring.ts` holds merchant-level tier
definitions and reporting for the dashboard. The uptime targets of the
default tiers here match it. `contracts/sla` is the on-chain counterpart. The
earlier `backend/services/subscriptionSlaMonitoring.ts` was removed: it was
never imported and referenced modules that do not exist.

## Tests

```bash
npx jest --config jest.backend.config.js backend/src/sla
```
