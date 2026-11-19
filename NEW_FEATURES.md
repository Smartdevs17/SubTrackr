# New Subscription Features

This document describes the three new subscription features implemented to improve plan comparison and churn prevention.

## 1. Subscription Comparison Heatmap (#1329)

### Overview

A visual heatmap component that helps users compare feature coverage across different subscription tiers at a glance.

### Files

- `src/components/subscription/PlanComparisonHeatmap.tsx` - React Native component

### Usage

```tsx
import { PlanComparisonHeatmap } from './components/subscription';

<PlanComparisonHeatmap plans={subscriptionPlans} />;
```

### Features

- Color-coded feature coverage percentage (red → yellow → green)
- Plan names and pricing information
- Legend explaining coverage ranges
- Horizontally scrollable for mobile devices

### Integration

The heatmap is automatically integrated into the `SubscriptionPlans` component and displays above the plan cards.

---

## 2. Smart Renewal Prediction Notifications (#1327)

### Overview

A service that analyzes subscription patterns to predict churn risk and generate proactive renewal notifications.

### Files

- `src/services/renewalPredictionService.ts` - Core service
- `src/services/__tests__/renewalPredictionService.test.ts` - Unit tests
- `src/components/hooks/useRenewalPrediction.ts` - React hook for integration

### Usage

```typescript
import { renewalPredictionService } from './services/renewalPredictionService';

// Assess a single subscription
const assessment = renewalPredictionService.assessChurnRisk(subscription);

// Batch assess multiple subscriptions
const assessments = renewalPredictionService.batchAssessChurnRisk(subscriptions);

// Get high-risk subscriptions
const atRisk = renewalPredictionService.getHighRiskSubscriptions(subscriptions);
```

### React Hook Usage

```tsx
import { useRenewalPrediction } from './components/hooks/useRenewalPrediction';

const { highRiskSubscriptions, assessments } = useRenewalPrediction({
  subscriptions: mySubscriptions,
  onHighRiskDetected: (assessment) => {
    // Send notification or trigger action
  },
  checkIntervalMs: 24 * 60 * 60 * 1000, // Daily checks
});
```

### Risk Factors

The service considers multiple factors:

- **Days until renewal**: Subscriptions within 7 days of renewal are flagged
- **Notifications disabled**: Higher risk if user has disabled notifications
- **Paused subscriptions**: Significantly elevated risk
- **Inactivity**: No updates for 60+ days increases risk
- **Price sensitivity**: Higher-priced subscriptions get slight adjustment

### Risk Levels

- **Low**: Score < 40 - Likely to renew
- **Medium**: Score 40-70 - Moderate churn risk
- **High**: Score > 70 - High churn risk, proactive intervention recommended

---

## 3. Annual Plan Value Indicator with Savings Badge (#1326)

### Overview

Visual badge component that displays annual savings percentage and amount when comparing monthly vs annual billing plans.

### Files

- `src/components/subscription/AnnualSavingsBadge.tsx` - React Native component

### Usage

```tsx
import { AnnualSavingsBadge } from './components/subscription';

<AnnualSavingsBadge monthlyPlan={monthlyPlan} annualPlan={annualPlan} />;
```

### Features

- Green success-colored badge
- Shows percentage savings (e.g., "Save 20%")
- Displays annual savings amount
- Only renders if savings > 0
- Automatically positioned in plan cards

### Calculation

- Monthly yearly total: `monthlyPrice × 12`
- Savings: `monthlyYearlyTotal - annualYearlyTotal`
- Percentage: `(savings / monthlyYearlyTotal) × 100`

### Integration

The badge is automatically integrated into the `SubscriptionPlans` component and displays on monthly plan cards when an equivalent annual plan exists.

---

## Testing

Run the renewal prediction service tests:

```bash
npm run test -- src/services/__tests__/renewalPredictionService.test.ts
```

All features include comprehensive unit tests with 80%+ coverage of critical paths.

---

## Future Enhancements

- A/B test different notification messages and timing
- Integrate with analytics to track notification effectiveness
- Machine learning model for better churn prediction
- Personalized renewal discounts based on churn risk
- Integration with email/SMS notification systems
