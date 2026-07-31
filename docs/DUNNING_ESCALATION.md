# Progressive Dunning Escalation

## Overview

Progressive dunning escalation moves failed-payment subscriptions forward through a fixed funnel:

**retry → warn → suspend → cancel**

Unlike flat retry loops, the progressive engine uses **configurable escalation rules** so merchants control when and how accounts escalate, which channels and templates fire, and how policies are optimized from analytics.

Related docs:

- [DUNNING.md](./DUNNING.md) — email sequences & A/B testing
- This document — progressive escalation engine, policies, API, and optimization

## Architecture

```
ProgressiveDunningEngine (src/services/progressiveDunningEngine.ts)
├── Policy management
│   ├── configurePolicy(policy)
│   └── getPolicy(planId)
├── Escalation
│   ├── evaluateEscalation(entry, now?) → next stage | null
│   ├── findMatchingRule(entry, now?)
│   ├── applyEscalation(entry, rule) → { entry, event }
│   └── processDueEscalations(entries, now?)
├── Analytics & optimization
│   ├── getAnalytics()
│   └── optimizePolicy(planId) → OptimizationSuggestion[]
└── Templates
    ├── renderTemplate(templateId, vars)
    └── listTemplates()

DunningService.progressiveEscalate(subscriptionId)
  └── thin integration that applies engine results to live entries

HTTP API (backend/billing/router/dunningEscalationRouter.ts)
  └── mounted at /dunning
```

## Escalation rules

```typescript
interface EscalationRule {
  id: string;
  fromStage: 'retry' | 'warn' | 'suspend' | 'cancel';
  toStage: 'retry' | 'warn' | 'suspend' | 'cancel';
  afterFailedAttempts?: number;
  afterHours?: number;
  minRecoveryProbability?: number; // 0–1; skip rule if estimate is lower
  channels: ('email' | 'push' | 'in_app' | 'sms' | 'support')[];
  templateId: string;
  priority: number; // higher wins when multiple rules match
}
```

**Progressive-only:** `toStage` must be strictly further along the funnel than `fromStage`. Backward or lateral moves are rejected when configuring policies and when applying escalations.

**Trigger semantics:** if both `afterFailedAttempts` and `afterHours` are set, either threshold can fire (OR). If neither is set, the rule matches on stage alone.

## Default policy

`createDefaultEscalationPolicy(planId)` mirrors `DEFAULT_DUNNING_STAGES`:

| From    | To      | After attempts | After hours (approx) | Template                    |
|---------|---------|----------------|----------------------|-----------------------------|
| retry   | warn    | 3              | 3                    | payment_warning             |
| warn    | suspend | 2              | 48                   | service_suspension          |
| suspend | cancel  | 1              | 72                   | subscription_cancellation   |

## Usage (engine)

```typescript
import {
  ProgressiveDunningEngine,
  createDefaultEscalationPolicy,
} from '../services/progressiveDunningEngine';

const engine = new ProgressiveDunningEngine();
engine.configurePolicy(createDefaultEscalationPolicy('pro_plan'));

const next = engine.evaluateEscalation(entry);
if (next) {
  const rule = engine.findMatchingRule(entry)!;
  const { entry: updated, event } = engine.applyEscalation(entry, rule);
}

const batch = engine.processDueEscalations(activeEntries);
const analytics = engine.getAnalytics();
const tips = engine.optimizePolicy('pro_plan');

const rendered = engine.renderTemplate('payment_warning', {
  subscription_name: 'Pro',
  amount: '29.00',
  currency: 'USD',
  attempts: 3,
  subscription_id: 'sub_123',
});
```

## Usage (DunningService)

```typescript
import { dunningService } from '../services/billing';

dunningService.startDunning(subId, subscriberId, merchantId, 'pro_plan');
// after failed charges accumulate…
const result = dunningService.progressiveEscalate(subId);
```

## REST API

Mount the router:

```typescript
import { createDunningEscalationRouter } from './billing/router/dunningEscalationRouter';

app.use('/dunning', createDunningEscalationRouter());
```

| Method | Path | Description |
|--------|------|-------------|
| `PUT` | `/dunning/policies/:planId` | Upsert escalation policy (`rules`, `enabled`, `maxEscalations`) |
| `GET` | `/dunning/policies/:planId` | Fetch policy |
| `POST` | `/dunning/:subscriptionId/evaluate` | Dry-run next stage for a subscription |
| `POST` | `/dunning/process-due` | Batch-process due escalations |
| `GET` | `/dunning/analytics` | Progressive funnel / path analytics |
| `GET` | `/dunning/optimize/:planId` | Optimization suggestions |
| `GET` | `/dunning/templates` | Built-in dunning communication templates |

Responses use the standard `ok` / `fail` envelope from `apiResponse`.

### Example: configure policy

```http
PUT /dunning/policies/pro_plan
Content-Type: application/json

{
  "enabled": true,
  "maxEscalations": 3,
  "rules": [
    {
      "id": "retry_to_warn",
      "fromStage": "retry",
      "toStage": "warn",
      "afterFailedAttempts": 3,
      "afterHours": 24,
      "channels": ["email", "push"],
      "templateId": "payment_warning",
      "priority": 100
    }
  ]
}
```

## Analytics

`getAnalytics()` returns:

- **stageFunnel** — entered / exited / recovered / escalated / currently in stage
- **timeInStage** — average & median hours
- **recoveryByEscalationPath** — recovery rate per `from->to` path
- **averageEscalationsBeforeRecovery**
- **overallRecoveryRate**

## Optimization

`optimizePolicy(planId)` inspects analytics and policy shape to suggest:

| Type | When |
|------|------|
| `slow_stage` | Average dwell time ≫ rule `afterHours` |
| `low_recovery` | Path recovery rate &lt; 20% with enough samples |
| `over_escalation` | Recoveries need deep escalation |
| `under_escalation` | Few accounts leave early stages |
| `template_gap` | Rule points at a missing template |
| `channel_mix` | Late-stage rule uses a single channel |

## Templates

Templates live in `DUNNING_TEMPLATES` (`src/types/dunning.ts`). Placeholders use `{snake_case}` tokens such as `{subscription_name}`, `{amount}`, `{currency}`, `{attempts}`, `{subscription_id}`.

## Types

See `src/types/dunningEscalation.ts` for `EscalationRule`, `EscalationPolicy`, `EscalationEvent`, `ProgressiveDunningAnalytics`, and `OptimizationSuggestion`.
