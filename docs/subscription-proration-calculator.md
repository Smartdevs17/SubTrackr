# Subscription Proration Calculator with Transparency

> Issue: [#784](https://github.com/Smartdevs17/SubTrackr/issues/784)

## Overview

SubTrackr's Subscription Proration Calculator provides transparent, exact-day calculations for plan changes (upgrades, downgrades, cancellations, and billing cycle switches). It removes opacity around mid-cycle adjustments by generating itemized line-item breakdowns, human-readable explanations, tax adjustments, credit memo applications, and historical analytics.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              Transparent Proration Calculator                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │ Calculation Req │───▶│  Calculator     │───▶│ Transparent │ │
│  │ (Plan A ➔ B)    │    │  Engine         │    │ Line Items  │ │
│  └─────────────────┘    └────────┬────────┘    └──────┬──────┘ │
│                                  │                    │        │
│                                  ▼                    ▼        │
│                         ┌─────────────────┐   ┌──────────────┐ │
│                         │ Human-Readable  │   │ Net Balance  │ │
│                         │ Explanation Text│   │ & Credit Memo│ │
│                         └─────────────────┘   └──────────────┘ │
│                                  │                    │        │
│                                  └─────────┬──────────┘        │
│                                            ▼                   │
│                                   ┌─────────────────┐          │
│                                   │ Proration Store │          │
│                                   │ & Analytics     │          │
│                                   └─────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Calculation Formula

Proration uses exact-day calculations based on cycle boundaries:

$$\text{Daily Rate (Old)} = \frac{\text{Old Plan Price}}{\text{Cycle Total Days}}$$

$$\text{Daily Rate (New)} = \frac{\text{New Plan Price}}{\text{New Cycle Total Days}}$$

$$\text{Unused Credit} = \text{Daily Rate (Old)} \times \text{Days Remaining}$$

$$\text{Prorated Charge} = \text{Daily Rate (New)} \times \text{Days Remaining}$$

$$\text{Net Adjustment} = \text{Prorated Charge} - \text{Unused Credit}$$

If $\text{Net Adjustment} > 0$, the customer pays the difference immediately.
If $\text{Net Adjustment} < 0$, the customer receives an account credit.

## Key Features

1. **Proration Calculator**: Real-time exact-day calculation engine supporting plan upgrades, downgrades, cancellations, and cycle changes.
2. **Transparent Proration Display**: Line-item breakdown displaying unused days credited vs. remaining days charged, with clear human-readable explanations.
3. **Proration Analytics**: Track total calculations, upgrades, downgrades, revenue collected, credits issued, and top upgrade paths over time.
4. **Proration Configuration**: Customizable policies (`exact_day`, `calendar_month`), tax rules, and minimum charge thresholds.
5. **Proration API**: Server-side service (`ProrationApiService`) exposing REST endpoints for backend integration.
6. **State Management & UI**: Persistent Zustand store (`useProrationStore`), React hook (`useProrationCalculator`), and React Native screen component (`ProrationCalculatorScreen`).

## Mid-cycle proration engine

When a customer changes plans before the next renewal date, the engine computes the adjustment from the exact number of remaining days in the active cycle:

$$
\text{Adjustment} = \frac{(\text{newPrice} - \text{oldPrice}) \times \text{remainingDays}}{\text{periodDays}}
$$

- If the result is positive, the customer is charged the difference immediately.
- If the result is negative, a credit memo is created for the unused portion of the old plan.
- If the change is scheduled for the end of the cycle, the adjustment is zero.

Example: a $30 plan changes to $60 when 15 of 30 days remain in the cycle.

$$
\frac{(60 - 30) \times 15}{30} = 15
$$

The customer is charged $15 immediately.

## Usage

### React Hook Example

```tsx
import { useProrationCalculator } from '../hooks/useProrationCalculator';

function PlanChangeModal() {
  const { calculate, activePreview, applyProration } = useProrationCalculator();

  const handlePreview = () => {
    const result = calculate({
      currentPlanId: 'basic-monthly',
      currentPlanName: 'Basic Plan',
      currentPrice: 29.99,
      currentCycle: BillingCycle.MONTHLY,
      newPlanId: 'pro-monthly',
      newPlanName: 'Pro Plan',
      newPrice: 59.99,
      newCycle: BillingCycle.MONTHLY,
      cycleStartDate: '2026-07-01',
      cycleEndDate: '2026-07-31',
      effectiveDate: '2026-07-16',
    });

    console.log(result.explanationText);
    console.log(`Net due: $${result.netProratedAmount}`);
  };
}
```

### Backend API Example

```typescript
import { ProrationApiService } from './services/prorationApiService';

const prorationApi = new ProrationApiService({
  includeTax: true,
  defaultTaxRate: 10,
});

const result = prorationApi.calculateProration({
  subscriptionId: 'sub_9912',
  currentPlanId: 'p1',
  currentPlanName: 'Starter',
  currentPrice: 15,
  currentCycle: BillingCycle.MONTHLY,
  newPlanId: 'p2',
  newPlanName: 'Growth',
  newPrice: 45,
  newCycle: BillingCycle.MONTHLY,
  cycleStartDate: Date.now() - 10 * 86400000,
  cycleEndDate: Date.now() + 20 * 86400000,
});
```

## File Structure

```
src/
├── types/
│   └── prorationCalculator.ts        # Type definitions & default config
├── services/
│   ├── prorationCalculatorService.ts # Core calculator & analytics engine
│   └── __tests__/
│       └── prorationCalculatorService.test.ts # Unit tests
├── store/
│   └── prorationStore.ts             # Zustand store
├── hooks/
│   └── useProrationCalculator.ts     # React hook
└── components/subscription/
    └── ProrationCalculatorScreen.tsx # Transparent UI component
backend/
└── services/
    └── prorationApiService.ts        # Backend service API
docs/
└── subscription-proration-calculator.md # Documentation
```
