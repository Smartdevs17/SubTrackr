# Subscription Analytics — MRR, ARR & Cohort Analysis

## Overview

SubTrackr provides two analytics layers:

| Layer | File | Purpose |
|-------|------|---------|
| Pure functions | `src/services/analyticsService.ts` | Stateless calculation, used by both frontend and backend |
| Backend service | `backend/services/analytics/subscriptionAnalyticsService.ts` | Stateful wrapper with caching, derived metrics, and CSV export |
| React Native screen | `app/screens/AnalyticsDashboard.tsx` | UI with widget system, cohort heatmap, export buttons |
| Zustand store | `app/stores/analyticsStore.ts` | Mobile state management |

---

## Key Metrics

### MRR (Monthly Recurring Revenue)
Sum of all active subscriptions normalised to monthly revenue:
- Monthly → price as-is
- Yearly → price ÷ 12
- Weekly → price × 4.345

### ARR (Annual Recurring Revenue)
`ARR = MRR × 12`

### MRR Growth Rate
Month-over-month change: `(currMRR - prevMRR) / prevMRR × 100`

### ARPU
`ARPU = MRR / activeSubscriberCount`

### LTV (Lifetime Value)
`LTV = ARPU / grossChurnRate` (or `ARPU × 12` when churn is zero)

### Gross Churn Rate
`churnedSubscriptions / totalSubscriptions`

### Net Churn Rate
`(churnedRevenue - expansionRevenue) / (MRR + churnedRevenue)`

---

## Cohort Analysis

Subscriptions are grouped by their creation month (or week). Each cohort reports:
- `subscriptionsStarted` — new subscribers that month
- `activeSubscriptions` — still active at time of report
- `retentionRate` — active / started
- `revenue` — current MRR contribution

The last 6 cohorts form the `revenueTrend` series.

---

## Revenue Forecast

Two models are supported:

| Model | Formula | Best For |
|-------|---------|---------|
| `exponential` | `MRR × retention^month` | Stable SaaS with consistent churn |
| `linear` | Linear regression on last 6 months | Fast-growing or declining products |

Each forecast point includes `lowerBound` and `upperBound` confidence bands that widen with fewer data points.

---

## Backend Service API

```typescript
import { subscriptionAnalyticsService } from 'backend/services/analytics/subscriptionAnalyticsService';

// Full compute
const envelope = subscriptionAnalyticsService.compute(subscriptions, {
  merchantId: 'merch_123',
  forecastModel: 'exponential',
  forecastMonths: 6,
});

// MRR movement breakdown between two periods
const breakdown = subscriptionAnalyticsService.mrrBreakdown(prevSubs, currSubs);
// → { newMrr, expansionMrr, contractionMrr, churnMrr, netNewMrr, totalMrr }

// Cohort summary
const cohorts = subscriptionAnalyticsService.cohortSummary(envelope.report);
// → { totalCohorts, avgRetentionRate, bestCohort, worstCohort, cohorts }

// Churn summary with percentage strings
const churn = subscriptionAnalyticsService.churnSummary(envelope.report);
// → { grossChurnPct: '4.00%', monthsToZero: 25, ... }

// Forecast aggregate totals
const forecast = subscriptionAnalyticsService.forecastSummary(envelope.report);
// → { totalExpectedRevenue, bestCaseRevenue, worstCaseRevenue, months }

// CSV export
const csv = subscriptionAnalyticsService.exportCsv(envelope);

// Cache management
subscriptionAnalyticsService.invalidate('merch_123');
const cached = subscriptionAnalyticsService.getCached('merch_123');
```

---

## Retention Curve

Day 1 / 7 / 30 / 60 / 90 retention:

```typescript
import { calculateRetentionCurve } from 'src/services/analyticsService';

const curve = calculateRetentionCurve(subscriptions);
// [{ day: 1, retainedCount, cohortSize, retentionRate }, ...]
```

---

## Performance Benchmarks

| Input Size | compute() Time |
|------------|---------------|
| 100 subs   | < 1 ms        |
| 1 000 subs | < 5 ms        |
| 10 000 subs| < 50 ms       |

The service is CPU-bound and synchronous. For very large datasets (> 50 k subscriptions) consider streaming or chunking with `Array.prototype.reduce`.

---

## Dashboard Widgets (React Native)

The `AnalyticsDashboard` screen exposes these customisable widgets:

| Widget ID        | Shows |
|-----------------|-------|
| `overview`      | MRR, ARR, ARPU, LTV with growth badges |
| `revenueTrend`  | Last 6 months MRR with anomaly flags |
| `forecast`      | 3-month revenue forecast with confidence range |
| `cohortHeatmap` | Cohort retention heatmap + retention curve |
| `churnBreakdown`| Logo vs. revenue churn comparison |
| `planMigrations`| Sankey diagram + LTV by acquisition channel |

Widget order and visibility are persisted in `analyticsStore` via Zustand.
