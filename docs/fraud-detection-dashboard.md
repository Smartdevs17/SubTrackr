# Fraud Detection Dashboard

## Overview

SubTrackr's fraud system operates across three layers:

| Layer | Location | Purpose |
|-------|----------|---------|
| On-chain scoring | `contracts/fraud/src/lib.rs` | Immutable risk assessment on Stellar/Soroban |
| Backend rule engine | `backend/fraud/domain/` | Pluggable TypeScript rules, A/B test support, SIGHUP hot-reload |
| Dashboard service | `backend/fraud/domain/FraudDashboardService.ts` | Aggregates scores → KPIs, review queue, reports |
| React Native UI | `src/screens/FraudDashboard.tsx` | Full control centre screen |
| Client detection | `src/services/fraudDetectionService.ts` | Mobile-side fraud checks with AsyncStorage |

---

## Risk Scoring

### Built-in Rules

| Rule | Category | Triggers When |
|------|----------|---------------|
| `VelocityRule` | velocity | Too many subscriptions created in a short window |
| `GeoAnomalyRule` | geolocation-anomaly | Country changes faster than travel allows |
| `DeviceFingerprintRule` | device-mismatch | Payment from unrecognised device |
| `AmountThresholdRule` | amount-threshold | Transaction amount deviates from baseline |
| `NewAccountRule` | new-account | Account < 7 days old with elevated activity |
| `VpnProxyRule` | vpn-proxy | VPN/proxy IP detected |
| `ChargebackRule` | chargeback | Subscriber has prior chargeback history |
| `UsageAnomalyRule` | usage-anomaly | Observed usage ≥ 2× expected |

### Score Thresholds

| Score | Action |
|-------|--------|
| 0–49  | `approve` |
| 50–79 | `flag` (manual review) |
| 80–100| `block` |

### False Positive Adjustment

```
adjustedScore = rawScore - (falsePositiveCount × 40)
```

Rules hot-reload on `SIGHUP`:
```bash
kill -HUP <node_pid>
```

---

## Dashboard Service API

```typescript
import { fraudDashboardService } from 'backend/fraud/domain/FraudDashboardService';
import type { FraudTransaction, FraudContext } from 'backend/fraud/domain/rules/FraudRule';

// Assess risk and auto-open investigation if flagged/blocked
const result = fraudDashboardService.assessRisk(transaction, context, {
  merchantName: 'Acme Corp',
  subscriptionName: 'Pro Plan',
  amount: 99.99,
  currency: 'USD',
});

// Get full dashboard payload
const payload = fraudDashboardService.getDashboardPayload();
// → { analytics, reviewQueue, subscriptions, assessments, merchants }

// Per-merchant report
const report = fraudDashboardService.getMerchantFraudReport('merch_1', 'Acme Corp');

// Case management
fraudDashboardService.approveSubscription(subscriptionId);
fraudDashboardService.blockSubscription(subscriptionId);
fraudDashboardService.resolveCase(subscriptionId, 'false_positive');

// Feedback loop
fraudDashboardService.submitFalsePositiveFeedback(subscriptionId, 'Manually reviewed - legitimate');
```

---

## A/B Testing Rules

The `RuleEngine` supports 50/50 (or custom) A/B splits on rule sets:

```typescript
const engine = fraudDashboardService.getRuleEngine();

engine.configureABTest({
  enabled: true,
  rulesA: ['VelocityRule'],          // only in group A
  rulesB: ['UsageAnomalyRule'],      // only in group B
});

// Group is assigned deterministically by subscriberId hash
```

---

## Investigation Lifecycle

```
open (pending) → review → resolve / escalate / dismiss
```

```typescript
const investigations = fraudDashboardService.getInvestigationService();

// Add reviewer notes
investigations.addNote(caseId, 'analyst@acme.com', 'Reviewed purchase history — legitimate');

// Assign a reviewer
investigations.assignReviewer(caseId, 'analyst@acme.com');

// Resolve
investigations.resolveCase(caseId, 'legitimate');
```

---

## Dashboard KPIs

| Metric | Description |
|--------|-------------|
| `totalChecks` | All subscriptions assessed |
| `approved / flagged / blocked` | Action breakdown |
| `avgRisk` | Average score across all checks |
| `velocityAlerts` | Rules with "velocity" in name that triggered |
| `anomalyAlerts` | Usage / anomaly rules that triggered |
| `geoAnomalyAlerts` | Geo rules that triggered |
| `chargebackPredictions` | Chargeback rules that triggered |
| `falsePositiveRate` | `feedbackCount / (flagged + blocked) × 100` |
| `modelConfidence` | `100 - falsePositiveRate × 2` |
| `manualReviewsClosed` | Reviewed + dismissed cases |

---

## On-Chain Contract (Soroban)

The Rust contract at `contracts/fraud/src/lib.rs` provides immutable on-chain risk assessment:

```rust
// Register a new subscription
SubTrackrFraud::register_subscription(env, subscriber, merchant_id, subscription_id, created_at);

// Record a chargeback
SubTrackrFraud::record_chargeback(env, subscriber, subscription_id);

// Get risk assessment
let score: RiskScore = SubTrackrFraud::assess_risk(env, subscriber);

// Get merchant fraud report
let report: FraudReport = SubTrackrFraud::get_fraud_report(env, merchant_id);
```

Prevention recommendations are generated on-chain by `contracts/fraud/src/prevention.rs`.

---

## Performance Benchmarks

| Operation | Time |
|-----------|------|
| `assessRisk()` (all 8 rules, no I/O) | < 2 ms |
| `getDashboardPayload()` with 100 tracked scores | < 5 ms |
| `getMerchantFraudReport()` | < 1 ms |

The rule engine is fully synchronous with no I/O. For production, wrap `assessRisk` in a queue worker to decouple it from the payment critical path.
