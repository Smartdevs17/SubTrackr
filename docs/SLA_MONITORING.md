# SLA Monitoring & Breach Detection

## Overview

The SLA monitoring system provides subscription-tier-based SLA definitions, real-time availability tracking, automated breach detection, credit calculation, and comprehensive analytics.

## Architecture

```
SlaMonitoringService
├── Tier Management
│   ├── setTierDefinition()    - Define SLA tiers
│   ├── getTierDefinition()    - Get tier config
│   ├── assignMerchantToTier() - Assign merchant to tier
│   └── getSlaConfigForTier()  - Get SLA config for tier
│
├── Credit Rules
│   ├── addCreditRule()        - Add credit calculation rule
│   ├── removeCreditRule()     - Remove credit rule
│   ├── listCreditRules()      - List all rules
│   └── calculateCreditAmount() - Calculate breach credit
│
├── Response Time Tracking
│   ├── recordResponseTime()   - Record response time
│   ├── getAverageResponseTime() - Get avg response time
│   └── isResponseTimeBreached() - Check response time SLA
│
├── Real-time Tracking
│   └── trackAvailability()    - Record availability event
│
├── Breach Detection
│   └── detectBreaches()       - Detect and create breaches
│
├── Analytics
│   └── getAnalytics()         - Get SLA analytics
│
└── Reporting
    └── generateSlaReport()    - Generate dashboard report
```

## SLA Tier Definitions

### Basic Tier
- **Uptime Target**: 99.0%
- **Measurement Interval**: 7 days
- **Response Time Target**: 5000ms
- **Max Breaches**: 3
- **Credit Percentage**: 5%
- **Auto Credit**: Disabled

### Premium Tier
- **Uptime Target**: 99.5%
- **Measurement Interval**: 7 days
- **Response Time Target**: 2000ms
- **Max Breaches**: 2
- **Credit Percentage**: 10%
- **Auto Credit**: Enabled

### Enterprise Tier
- **Uptime Target**: 99.9%
- **Measurement Interval**: 30 days
- **Response Time Target**: 1000ms
- **Max Breaches**: 1
- **Credit Percentage**: 20%
- **Auto Credit**: Enabled

## Credit Rules

| Rule | Uptime Threshold | Credit % | Max Credit | Auto Apply |
|------|-----------------|----------|------------|------------|
| Minor Breach | < 99.0% | 5% | $50 | Yes |
| Major Breach | < 95.0% | 15% | $200 | Yes |
| Critical Breach | < 90.0% | 30% | $500 | Yes |

## Breach Detection Algorithm

1. Calculate observed seconds within the measurement window
2. Sum downtime (weighted: full_outage=100%, partial_outage=50%, maintenance=0%)
3. Compute uptime percentage
4. Compare against tier-specific uptime target
5. If non-compliant and no active breach: create new breach with auto-calculated credit
6. If compliant and active breach exists: resolve the breach

## Analytics

- **Total/Compliant Merchants**: Overall compliance status
- **Average Uptime**: System-wide uptime
- **Total Breaches/Credits**: Breach history
- **Uptime by Tier**: Performance per SLA tier
- **Breach/Credit Trends**: 7-day trend analysis
- **Response Time Tracking**: Real-time response time monitoring

## API Endpoints

| Method | Description |
|--------|-------------|
| `setTierDefinition()` | Define or update SLA tier |
| `getTierDefinition()` | Get tier configuration |
| `listTierDefinitions()` | List all tiers |
| `assignMerchantToTier()` | Assign merchant to tier |
| `getSlaConfigForTier()` | Get SLA config for tier |
| `addCreditRule()` | Add credit rule |
| `removeCreditRule()` | Remove credit rule |
| `listCreditRules()` | List all credit rules |
| `calculateCreditAmount()` | Calculate breach credit |
| `recordResponseTime()` | Record response time |
| `getAverageResponseTime()` | Get average response time |
| `isResponseTimeBreached()` | Check response time breach |
| `trackAvailability()` | Record availability event |
| `detectBreaches()` | Detect breaches |
| `getAnalytics()` | Get SLA analytics |
| `generateSlaReport()` | Generate dashboard report |
| `getMonitoringEvents()` | Get monitoring events |

## Platform Monitoring Service Integration (`MonitoringService`)

The shared `MonitoringService` (`backend/services/shared/monitoring.ts`) performs **subscription SLA monitoring with breach detection** directly on the platform transaction stream. It powers the admin dashboard (`src/services/adminDashboardService.ts`) and the billing pipeline (`backend/services/batchChargeService.ts`).

### How it works

1. Register an SLA target per subscription with `setSlaTarget(subscriptionId, target)`.
2. Every recorded transaction triggers an SLA evaluation for its subscription.
3. Uptime is computed from the **success rate** of transactions inside the rolling measurement window (`measurementInterval`). `pending` transactions are ignored; no traffic in the window means compliant.
4. A **breach** is opened when uptime falls below `uptimeTarget`, and **auto-resolved** when uptime recovers to the target. Only one open breach per subscription at a time.
5. Each breach raises an alert (`ruleId: sla-breach:<subscriptionId>`) in the platform alert stream and issues a credit via the shared credit policy.

### Credit policy

Credit follows the platform-wide formula (same as `calculateCreditAmount` in `src/services/slaService.ts`):

```
credit = max(1, round((uptimeTarget − uptimePercentage) / uptimeTarget × measurementInterval × 100))
```

Capped by `creditCap` when set (0 = unlimited).

### Example

```typescript
import { MonitoringService } from './backend/services/shared/monitoring';

const monitoring = new MonitoringService();

monitoring.setSlaTarget('sub-123', {
  uptimeTarget: 99.5,        // 99.5% uptime
  measurementInterval: 604800, // rolling 7-day window
  creditCap: 250,            // max credit per breach
});

monitoring.recordTransaction({ id: 't1', subscriptionId: 'sub-123', amount: 10, currency: 'USD', status: 'success', timestamp: Date.now(), gasUsed: 210000 });
monitoring.recordTransaction({ id: 't2', subscriptionId: 'sub-123', amount: 10, currency: 'USD', status: 'failed', timestamp: Date.now(), gasUsed: 210000 });

const dash = monitoring.getDashboard();
console.log(dash.slaStatuses); // per-subscription compliance
console.log(dash.slaBreaches); // breach records
console.log(dash.slaSummary);  // aggregate health
```

### MonitoringService SLA API

| Method | Description |
|--------|-------------|
| `setSlaTarget(subscriptionId, target)` | Register or update an SLA target (evaluated immediately) |
| `removeSlaTarget(subscriptionId)` | Stop SLA monitoring for a subscription |
| `getSlaTarget(subscriptionId)` | Get the registered target |
| `getSlaStatus(subscriptionId)` | Live compliance status for a subscription |
| `getSlaStatuses()` | Compliance status for every monitored subscription |
| `getSlaSummary()` | Aggregate SLA health (monitored/compliant/breached/credits) |
| `getSlaBreaches(subscriptionId?)` | Breach records, newest first |
| `resolveSlaBreach(breachId)` | Manually resolve a breach (operator override) |
| `acknowledgeSlaBreach(breachId)` | Mark a breach acknowledged |
| `calculateSlaCreditAmount(target, uptimePercentage)` | Credit for a breach (exported helper) |

### Dashboard snapshot

`getDashboard()` now includes `slaStatuses`, `slaBreaches`, and `slaSummary` alongside the existing transaction metrics and alerts.

### Performance

Ingestion uses incremental O(1) counters; SLA evaluation is per-subscription over its window, bounded by a 5 000-event cap per subscription. Benchmarks (`backend/services/shared/__tests__/monitoringSla.benchmark.test.ts`) measure breach detection throughput — 20 000 transactions across 200 subscriptions evaluate in well under a second.
