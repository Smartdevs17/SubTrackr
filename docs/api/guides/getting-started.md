# Getting Started

This guide walks you through your first integration with the SubTrackr API —
from creating a customer to processing a subscription payment.

## Prerequisites

- A SubTrackr account (sign up at [app.subtrackr.io](https://app.subtrackr.io))
- An API key from **Settings → API Keys**
- Node.js 18+ (or Python 3.10+, or Go 1.21+)

---

## Step 1 — Install the SDK

```bash
npm install @subtrackr/sdk
```

## Step 2 — Initialise the client

```typescript
import { SubTrackr } from '@subtrackr/sdk';

const client = new SubTrackr({
  apiKey: process.env.SUBTRACKR_API_KEY!,
  baseUrl: 'https://sandbox.subtrackr.io/v1', // use sandbox first
});
```

## Step 3 — Create a plan

```typescript
const plan = await client.plans.create({
  name: 'Pro Monthly',
  price: 29.99,
  currency: 'USD',
  billingCycle: 'monthly',
  trialDays: 14,
  features: ['Unlimited projects', 'Priority support'],
});

console.log('Plan created:', plan.id); // plan_monthly_pro
```

## Step 4 — Create a customer

```typescript
const customer = await client.customers.create({
  email: 'jane@example.com',
  name: 'Jane Doe',
});

console.log('Customer created:', customer.id); // cus_xyz789
```

## Step 5 — Subscribe the customer

```typescript
const subscription = await client.subscriptions.create({
  customerId: customer.id,
  planId: plan.id,
  trialEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
});

console.log('Subscription created:', subscription.id);
console.log('Status:', subscription.status); // trialing
```

## Step 6 — Register a webhook

```typescript
const endpoint = await client.webhooks.create({
  url: 'https://your-app.com/webhooks/subtrackr',
  events: [
    'subscription.created',
    'subscription.trial_will_end',
    'invoice.paid',
    'invoice.payment_failed',
  ],
});

// Store this securely — never log or expose it
const signingSecret = endpoint.signingSecret;
```

## Step 7 — Handle webhook events

```typescript
import express from 'express';
import { verifyWebhookSignature } from '@subtrackr/sdk';

const app = express();

app.post(
  '/webhooks/subtrackr',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const sig = req.headers['subtrackr-signature'] as string;
    const event = verifyWebhookSignature(req.body, sig, signingSecret);

    if (!event) return res.status(400).send('Invalid signature');

    switch (event.type) {
      case 'subscription.trial_will_end':
        // Send reminder email to customer
        sendTrialEndingEmail(event.data.id);
        break;
      case 'invoice.paid':
        // Unlock features for paid tier
        grantAccess(event.data.customerId);
        break;
      case 'invoice.payment_failed':
        // Notify customer to update payment method
        sendPaymentFailedEmail(event.data.customerId);
        break;
    }

    res.json({ received: true });
  }
);

app.listen(3000);
```

---

## What's next?

- [Webhook Event Reference](../webhooks.md) — full event catalogue
- [White-label Themes](./theme-integration.md) — customise the UI for your brand
- [SaaS Integration Guide](./saas-integration.md) — end-to-end SaaS pattern
