# Subscription SLA Monitoring with Breach Detection

This document specifies the technical architecture, breach detection algorithms, penalty calculation formulas, and UI integration for SubTrackr's SLA monitoring engine.

## Overview

SubTrackr tracks subscription service availability, response latencies, and transaction error rates against SLA commitments (e.g. 99.9% uptime). When an SLA commitment is breached, the breach detection engine:
- Logs breach incidents with severity levels (`low`, `medium`, `high`, `critical`).
- Calculates automated service credit penalty refunds.
- Displays active breach alerts and compliance trends in `SlaDashboard.tsx`.

---

## Technical Architecture

### 1. Backend SLA Breach Detector (`backend/services/shared/monitoring.ts`)

- **Class `SlaBreachDetector`**:
  - `defaultTargetConfig(merchantId)`: Generates default SLA targets (99.9% uptime, 500ms max latency, 1.0% max error rate).
  - `evaluateBreaches(config, metrics, monthlyFee)`: Evaluates SLA rules against telemetry metric points to detect:
    1. **Uptime Drop**: Triggers when observed uptime is less than target (e.g. $< 99.9\%$).
    2. **Latency Spike**: Triggers when average response latency exceeds threshold ($> 500\text{ms}$).
    3. **Error Rate Surge**: Triggers when transaction error rate exceeds threshold ($> 1.0\%$).
  - `calculateCreditPenalty(uptimeDropPercent, subscriptionFee, rateBps)`: Calculates prorated penalty credit amounts.
  - `generateComplianceReport(config, metrics, breaches)`: Computes an aggregate SLA compliance snapshot.

### 2. Frontend Dashboard (`src/screens/SlaDashboard.tsx`)

- **`SlaDashboard.tsx`**:
  - **Summary Cards**: Displays Average Uptime, Open Breaches, Credits Issued, and Compliant Merchants.
  - **SLA Configurator**: Allows setting Uptime targets (%) and Measurement intervals (seconds).
  - **Service Availability Recorder**: Enables tracking healthy vs outage states with duration.
  - **Breach Management**: View active and historical SLA breach incidents, penalty credit amounts, and resolution status.

---

## Example Usage

```typescript
import { SlaBreachDetector } from '../../backend/services/shared/monitoring';

const config = SlaBreachDetector.defaultTargetConfig('merchant_123');
const breaches = SlaBreachDetector.evaluateBreaches(config, metricPoints, 150);

console.log(`Detected ${breaches.length} SLA breach(es).`);
```
