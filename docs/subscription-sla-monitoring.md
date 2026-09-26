# Subscription SLA Monitoring

> Issue: [#779](https://github.com/Smartdevs17/SubTrackr/issues/779)

## Overview

SubTrackr's Subscription SLA Monitoring system provides real-time tracking and enforcement of Service Level Agreements at the individual subscription level. It detects SLA breaches, generates alerts, calculates credits, and provides comprehensive analytics and reporting.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Subscription SLA System                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐  │
│  │  SLA Config   │───▶│  Metric Samples  │───▶│  Evaluation  │  │
│  │  (per tier)   │    │  (ring buffer)   │    │   Engine     │  │
│  └──────────────┘    └──────────────────┘    └──────┬───────┘  │
│                                                      │          │
│                                          ┌───────────┼────────┐ │
│                                          ▼           ▼        ▼ │
│                                    ┌──────────┐ ┌────────┐ ┌──┐│
│                                    │ Breaches │ │ Alerts │ │$$││
│                                    │ Tracking │ │ System │ │CR││
│                                    └────┬─────┘ └───┬────┘ └──┘│
│                                         │           │           │
│                                    ┌────▼───────────▼────┐      │
│                                    │  Analytics Engine    │      │
│                                    │  & Report Generator  │      │
│                                    └─────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

## Tier-Based SLA Definitions

Each subscription tier has predefined SLA targets:

| Tier       | Uptime    | Response Time | Error Rate | Latency | Credit % | Max Credit |
|------------|-----------|---------------|------------|---------|----------|------------|
| Free       | 95.00%    | 5000ms        | 10%        | 3000ms  | 0%       | $0         |
| Basic      | 99.00%    | 2000ms        | 5%         | 1500ms  | 5%       | $50        |
| Standard   | 99.50%    | 1000ms        | 2%         | 800ms   | 10%      | $100       |
| Premium    | 99.90%    | 500ms         | 1%         | 300ms   | 15%      | $250       |
| Enterprise | 99.99%    | 200ms         | 0.1%       | 100ms   | 25%      | $500       |

## Features

### 1. SLA Definition per Tier
- Pre-configured SLA targets for 5 subscription tiers
- Customizable targets via configuration overrides
- Support for uptime, response time, error rate, and latency metrics

### 2. Real-Time SLA Tracking
- Metric sample ingestion via `recordMetric()` / `recordMetricBatch()`
- Ring buffer storage (last 1000 samples per subscription)
- Automatic SLA evaluation on each metric recording
- Periodic background checks at configurable intervals

### 3. Breach Detection and Alerts
- Automatic breach detection when metrics violate SLA targets
- Severity classification: `warning`, `minor`, `major`, `critical`
- Alert generation with actionable messages
- Breach acknowledgment and resolution workflows
- Auto-resolution when metrics return to compliance

### 4. SLA Credits
- Automatic credit calculation based on breach severity
- Severity multipliers: warning (0.25x), minor (0.5x), major (1.0x), critical (2.0x)
- Per-tier credit percentage and maximum caps
- Credit balance tracking per subscription

### 5. SLA Reporting
- Daily, weekly, monthly, and quarterly report generation
- Period-filtered breach and compliance data
- Actionable recommendations based on analytics

### 6. SLA Analytics
- Overall compliance rates and averages
- Mean Time to Resolution (MTTR)
- Breach breakdowns by severity, metric, and tier
- Compliance trend over configurable time windows
- Top breached subscriptions ranking

### 7. SLA Dashboard
- Real-time status overview
- Status breakdown (compliant, at-risk, breached, critical)
- Recent breaches and alerts
- 7-day compliance trend

## Usage

### Frontend (React Native)

```typescript
import { useSubscriptionSlaMonitor } from '../hooks/useSubscriptionSlaMonitor';

function SLADashboard() {
  const {
    configureSla,
    recordMetric,
    activeBreaches,
    unreadAlerts,
    dashboard,
    getAnalytics,
  } = useSubscriptionSlaMonitor();

  // Configure SLA for a subscription
  configureSla('sub-123', 'premium');

  // Record metrics
  recordMetric('sub-123', 'uptime', 99.95);
  recordMetric('sub-123', 'response_time', 450);

  // Access dashboard
  console.log(dashboard.overview.compliantPercentage);
  console.log(`Active breaches: ${activeBreaches.length}`);
}
```

### Backend

```typescript
import { SubscriptionSlaMonitoringService } from './services/subscriptionSlaMonitoring';

const slaMonitor = new SubscriptionSlaMonitoringService([
  { type: 'console' },
  { type: 'slack', webhookUrl: process.env.SLACK_WEBHOOK },
]);

// Register a subscription
slaMonitor.configureSubscription('sub-123', 'enterprise');

// Record metrics from instrumented endpoints
slaMonitor.recordMetric({
  kind: 'uptime',
  value: 99.98,
  timestamp: Date.now(),
  subscriptionId: 'sub-123',
});

// Check health
const health = slaMonitor.getHealthSummary();
```

## File Structure

```
src/
├── types/
│   └── subscriptionSla.ts          # Type definitions & tier defaults
├── services/
│   └── subscriptionSlaMonitorService.ts  # Pure evaluation functions
├── store/
│   └── subscriptionSlaStore.ts     # Zustand state management
├── hooks/
│   └── useSubscriptionSlaMonitor.ts # React hook for components
backend/
├── services/
│   └── subscriptionSlaMonitoring.ts # Backend monitoring service
docs/
└── subscription-sla-monitoring.md  # This documentation
```

## Severity Classification

### Uptime Breaches
| Deviation | Severity |
|-----------|----------|
| ≥ 5%      | Critical |
| ≥ 2%      | Major    |
| ≥ 1%      | Minor    |
| < 1%      | Warning  |

### Other Metric Breaches
| Deviation | Severity |
|-----------|----------|
| ≥ 50%     | Critical |
| ≥ 25%     | Major    |
| ≥ 10%     | Minor    |
| < 10%     | Warning  |

## Escalation Rules

Default escalation rules per severity:

| Severity | Delay     | Action       |
|----------|-----------|-------------|
| Warning  | 30 min    | Alert       |
| Minor    | 15 min    | Alert       |
| Major    | 5 min     | Notify Admin|
| Critical | Immediate | Escalate    |
