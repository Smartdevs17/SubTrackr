# Plan Comparison & Recommendation Engine

Issue #776 – dedicated plan comparison and recommendation feature (separate from the upsell engine in `backend/services/upsell/recommendationService.ts`).

## Architecture

```
src/types/planComparison.ts          Shared domain types
src/services/planComparisonEngine.ts Pure TS engine (no RN deps)
src/store/planComparisonStore.ts     Zustand UI wrapper
src/screens/PlanComparisonScreen.tsx Side-by-side comparison UI
backend/subscription/controller/planComparisonController.ts
backend/subscription/router/planComparisonRouter.ts
```

The engine is pure TypeScript so it can run in Jest, Node API handlers, and the React Native app without platform imports.

### Core flows

1. **Compare** – `comparePlans(plans, options?)` builds a feature matrix, normalized price diffs, and winners (cheapest / most features / best value / per-category).
2. **Recommend** – `recommendPlan(plans, profile)` scores each plan against a `PreferenceProfile` and returns a ranked list with reasons.
3. **Track** – `PlanRecommendationTracker` stores comparison + recommendation events in memory for analytics.
4. **Share** – `createComparisonShare` / `resolveComparisonShare` mint and resolve opaque tokens.

## Recommendation scoring

Each candidate plan receives a composite score in `[0, 1]`:

| Factor | Default weight | Value-priority weight | Notes |
|--------|----------------|----------------------|-------|
| Budget fit | 0.30 | 0.20 | Prefers using budget without exceeding it |
| Feature match | 0.35 | 0.25 | Required features are a hard filter; preferred features raise score |
| Usage fit | 0.20 | 0.15 | Matches `tierRank` to `usageLevel` |
| Value score | 0.15 | 0.40 | Features per monthly dollar |

Plans missing any `requiredFeatures` are excluded. The current plan (`currentPlanId`) is skipped.

Monthly price normalization:

| Billing cycle | Multiplier to monthly |
|---------------|----------------------|
| daily | ×30 |
| weekly | ×(52/12) |
| monthly | ×1 |
| yearly | ×(1/12) |

## API

Mount with `createPlanComparisonRouter()` from `backend/subscription/router`.

| Method | Path | Body / params | Response `data` |
|--------|------|---------------|-----------------|
| POST | `/plans/compare` | `{ plans, options? }` | `PlanComparisonResult` |
| POST | `/plans/recommend` | `{ plans, profile? }` | `{ recommendations }` |
| POST | `/plans/recommendations/track` | `{ recommendationId, planId, eventType, ... }` | `RecommendationTrackingEvent` |
| GET | `/plans/comparisons/analytics` | — | `ComparisonAnalytics` |
| POST | `/plans/comparisons/share` | `{ comparisonId, planIds, payload?, ttlMs? }` | `ComparisonShare` |
| GET | `/plans/comparisons/share/:token` | `:token` | `ComparisonShare` |

All responses use the standard `ok` / `fail` envelope from `backend/services/shared/apiResponse.ts`.

### Example: compare

```http
POST /plans/compare
Content-Type: application/json

{
  "plans": [
    {
      "id": "basic",
      "name": "Basic",
      "price": 9.99,
      "currency": "USD",
      "billingCycle": "monthly",
      "features": [
        { "id": "api", "name": "API Access", "category": "integrations", "value": false }
      ]
    },
    {
      "id": "pro",
      "name": "Pro",
      "price": 29.99,
      "currency": "USD",
      "billingCycle": "monthly",
      "features": [
        { "id": "api", "name": "API Access", "category": "integrations", "value": true }
      ]
    }
  ],
  "options": { "normalizeBillingCycle": "monthly" }
}
```

### Example: recommend

```http
POST /plans/recommend
Content-Type: application/json

{
  "plans": [ /* ComparablePlan[] */ ],
  "profile": {
    "budget": 50,
    "requiredFeatures": ["api"],
    "preferredFeatures": ["support"],
    "usageLevel": "moderate",
    "prioritizeValue": true,
    "maxResults": 3
  }
}
```

## Analytics

`getComparisonAnalytics()` / `GET /plans/comparisons/analytics` returns:

- `totalComparisons`, `totalRecommendations`
- `impressions`, `clicks`, `accepts`, `dismissals`
- `conversionRate` = accepts / impressions
- `clickThroughRate` = clicks / impressions
- `mostComparedPairs` – top plan-id pairs by compare count
- `topRecommended` – plans most often returned by the recommender

## Client store

```ts
import { usePlanComparisonStore } from '../store/planComparisonStore';

const { setSelectedPlans, runComparison, runRecommendation, shareComparison } =
  usePlanComparisonStore();
```

Screen route: `PlanComparison` (see `RootStackParamList`).

## Relation to upsell recommendations

The upsell service (`RecommendationService`) targets checkout / renewal upsells with collaborative filtering. This engine compares arbitrary catalog plans against explicit preferences. Do not merge the two stores or event streams.
