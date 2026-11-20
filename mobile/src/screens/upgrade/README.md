# Plan Upgrade Screen (`mobile/src/screens/upgrade/`)

A self-contained, accessible, and high-performance in-app plan upgrade flow for SubTrackr mobile.

## Overview

Enables users to seamlessly upgrade between SubTrackr subscription tiers (`Starter` → `Pro` → `Enterprise`) with real-time proration, annual discounts, feature comparison, and telemetry.

## Key Capabilities

1. **Deterministic Proration**:
   `calculateProrationQuote()` accurately calculates unused time remaining in the current billing cycle and credits it toward the target plan.
2. **Annual vs Monthly Billing**:
   Segmented toggle with instant savings calculation (e.g. 20% discount on annual billing).
3. **Feature Diffing**:
   Dynamic checklist highlighting newly unlocked capabilities (e.g. ML renewal pre-flight, Soroban multi-chain indexer, compliant tax receipts).
4. **Accessibility (WCAG 2.1 AA Compliant)**:
   - Proper `accessibilityRole` (`radio`, `tab`, `button`, `alert`)
   - High-contrast visual cues
   - Touch targets meeting minimum dimensions (>= 48x48dp)
5. **Observability**:
   Pluggable `UpgradeMetrics` callbacks tracking view impressions, tier selections, cycle switches, upgrade starts, successes, and errors.

## Usage

```tsx
import { UpgradeScreen } from './screens/upgrade';

<UpgradeScreen
  currentTier="starter"
  currentBillingCycle="annual"
  daysRemainingInPeriod={12}
  totalDaysInPeriod={30}
  onCompleteUpgrade={async (targetTier, cycle) => {
    await billingApi.mutatePlan({ targetTier, cycle });
  }}
  onBack={() => navigation.goBack()}
/>
```
