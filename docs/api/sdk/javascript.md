# JavaScript / TypeScript SDK Examples

## Installation

```bash
npm install @subtrackr/sdk
# or
yarn add @subtrackr/sdk
```

## Initialisation

```typescript
import { SubTrackr } from '@subtrackr/sdk';

const client = new SubTrackr({
  apiKey: process.env.SUBTRACKR_API_KEY!,
  // optional: use sandbox for testing
  baseUrl: 'https://sandbox.subtrackr.io/v1',
});
```

---

## Subscriptions

### Create a subscription

```typescript
const subscription = await client.subscriptions.create({
  customerId: 'cus_xyz789',
  planId: 'plan_monthly_pro',
  trialEnd: new Date('2025-03-01'),
});

console.log(subscription.id);   // sub_abc123
console.log(subscription.status); // 'trialing'
```

### List subscriptions (paginated)

```typescript
const page = await client.subscriptions.list({
  status: 'active',
  page: 1,
  limit: 20,
});

for (const sub of page.data) {
  console.log(`${sub.id} — ${sub.status}`);
}

if (page.hasNext) {
  const next = await client.subscriptions.list({ page: 2, limit: 20 });
}
```

### Cancel at period end

```typescript
const cancelled = await client.subscriptions.cancel('sub_abc123', {
  immediately: false,
  reason: 'Customer requested',
});
// cancelled.cancelAtPeriodEnd === true
```

### Cancel immediately

```typescript
await client.subscriptions.cancel('sub_abc123', { immediately: true });
```

### Pause and resume

```typescript
// Pause until a specific date
await client.subscriptions.pause('sub_abc123', {
  resumeAt: new Date('2025-06-01'),
});

// Resume manually
await client.subscriptions.resume('sub_abc123');
```

---

## Plans

```typescript
// Create a plan
const plan = await client.plans.create({
  name: 'Pro Monthly',
  price: 29.99,
  currency: 'USD',
  billingCycle: 'monthly',
  trialDays: 14,
  features: ['Unlimited projects', 'Priority support'],
});

// List all active plans
const plans = await client.plans.list({ active: true });
```

---

## Customers

```typescript
const customer = await client.customers.create({
  email: 'jane@example.com',
  name: 'Jane Doe',
  metadata: { externalId: 'user_12345' },
});

const retrieved = await client.customers.get(customer.id);
```

---

## Webhooks

```typescript
// Register an endpoint
const endpoint = await client.webhooks.create({
  url: 'https://example.com/webhooks/subtrackr',
  events: ['subscription.created', 'subscription.cancelled', 'invoice.paid'],
});

// IMPORTANT: store the signingSecret securely — it is only shown once
const { signingSecret } = endpoint;

// Verify an incoming webhook (e.g. in an Express handler)
import { verifyWebhookSignature } from '@subtrackr/sdk';

app.post('/webhooks/subtrackr', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['subtrackr-signature'] as string;
  const event = verifyWebhookSignature(req.body, sig, signingSecret);
  if (!event) return res.status(400).send('Invalid signature');

  switch (event.type) {
    case 'subscription.created':
      console.log('New subscription:', event.data.id);
      break;
    case 'invoice.paid':
      console.log('Invoice paid:', event.data.id, event.data.amount);
      break;
  }

  res.json({ received: true });
});
```

---

## Themes

```typescript
// Create a brand theme
const theme = await client.themes.create({
  id: 'brand-acme',
  name: 'Acme Corp',
  mode: 'dark',
  colors: {
    primary: '#ff6b35',
    secondary: '#004e89',
    accent: '#1a936f',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    textSecondary: '#cbd5e1',
    border: '#334155',
    overlay: 'rgba(15, 23, 42, 0.8)',
  },
  logoUri: 'https://cdn.acme.com/logo.png',
  font: { family: 'Inter', scale: 1.0 },
});

// The response includes generated CSS variables
console.log(theme.cssVariables?.['--st-primary']); // '#ff6b35'
```

---

## Error handling

```typescript
import { SubTrackrError } from '@subtrackr/sdk';

try {
  await client.subscriptions.get('sub_does_not_exist');
} catch (err) {
  if (err instanceof SubTrackrError) {
    console.error(err.code);    // 'subscription_not_found'
    console.error(err.message); // 'No subscription with id ...'
    console.error(err.status);  // 404
  }
}
```
