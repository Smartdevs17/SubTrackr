# SaaS Integration Guide

A complete end-to-end pattern for integrating SubTrackr into a SaaS application:
feature gating, upgrade/downgrade flows, and dunning management.

---

## Architecture overview

```
User signs up
    │
    ▼
Create Customer (SubTrackr)
    │
    ▼
User selects plan → Create Subscription
    │
    ├─ status: trialing ──► trial_will_end webhook ──► prompt payment method
    │
    └─ status: active
           │
           ├─ invoice.paid ──► grant / maintain access
           ├─ invoice.payment_failed ──► past_due ──► dunning emails
           ├─ subscription.cancelled ──► revoke access at period end
           └─ subscription.updated ──► sync plan to feature flags
```

---

## Feature gating

Map each plan to a set of feature flags and check them on every protected
route:

```typescript
// plans.config.ts
export const PLAN_FEATURES: Record<string, string[]> = {
  plan_free:         ['basic_analytics'],
  plan_monthly_pro:  ['basic_analytics', 'advanced_analytics', 'api_access'],
  plan_enterprise:   ['basic_analytics', 'advanced_analytics', 'api_access', 'sso', 'audit_logs'],
};

// middleware/requireFeature.ts
import { SubTrackr } from '@subtrackr/sdk';
import { PLAN_FEATURES } from './plans.config';

export function requireFeature(feature: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const sub = await getActiveSubscription(req.user.id); // your DB lookup
    const features = PLAN_FEATURES[sub?.planId ?? 'plan_free'] ?? [];

    if (!features.includes(feature)) {
      return res.status(403).json({ error: 'upgrade_required', feature });
    }
    next();
  };
}

// Usage
app.get('/api/analytics/advanced', requireFeature('advanced_analytics'), handler);
```

---

## Upgrade / downgrade flow

```typescript
// Upgrade: switch plan immediately
async function upgradePlan(subscriptionId: string, newPlanId: string) {
  const updated = await client.subscriptions.update(subscriptionId, {
    planId: newPlanId,
  });
  // Webhook subscription.updated fires — sync feature flags
  return updated;
}

// Downgrade: switch at period end to avoid surprise charges
async function downgradePlan(subscriptionId: string, newPlanId: string) {
  const updated = await client.subscriptions.update(subscriptionId, {
    planId: newPlanId,
    // apply at next billing cycle
    prorationBehavior: 'none',
  });
  return updated;
}
```

---

## Dunning management

When `invoice.payment_failed` fires, kick off a dunning sequence:

```typescript
const DUNNING_SEQUENCE = [
  { delayDays: 0,  message: 'Your payment failed. Please update your card.' },
  { delayDays: 3,  message: 'Reminder: your account will be suspended in 4 days.' },
  { delayDays: 7,  message: 'Final notice: update payment to avoid cancellation.' },
];

async function startDunning(customerId: string, invoiceId: string) {
  for (const step of DUNNING_SEQUENCE) {
    await scheduleEmail({
      to: customer.email,
      sendAt: addDays(new Date(), step.delayDays),
      body: step.message,
      meta: { invoiceId },
    });
  }
}

// In your webhook handler
case 'invoice.payment_failed':
  await startDunning(event.data.customerId, event.data.id);
  break;

// Cancel after final dunning failure
case 'subscription.expired':
  await revokeAllAccess(event.data.customerId);
  break;
```

---

## Idempotent webhook processing

Always use the event `id` as a deduplication key:

```typescript
import { db } from './database';

async function processWebhookEvent(event: WebhookEvent) {
  const existing = await db.webhookEvents.findUnique({ where: { id: event.id } });
  if (existing) return; // already processed

  await db.webhookEvents.create({ data: { id: event.id, type: event.type } });

  // Now safe to process
  switch (event.type) {
    // ...
  }
}
```

---

## White-label theme per merchant

```typescript
// On merchant onboarding
const theme = await client.themes.create({
  id: `brand-${merchant.slug}`,
  name: merchant.name,
  mode: 'dark',
  colors: {
    primary:       merchant.brandColor,
    secondary:     darken(merchant.brandColor, 20),
    accent:        merchant.accentColor,
    // ... other colors
  },
  logoUri: merchant.logoUrl,
});

// Store theme.id in your merchant record
await db.merchants.update({ where: { id: merchant.id }, data: { themeId: theme.id } });
```

See [Theme Integration Guide](./theme-integration.md) for the full white-label setup.
