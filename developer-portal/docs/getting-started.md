# Integration Guide: Getting Started with SubTrackr

## Overview

This guide will walk you through integrating SubTrackr into your application step by step.

## Prerequisites

- Node.js 16+ or Python 3.8+ or Go 1.18+
- A SubTrackr developer account
- An API key (test or live)

## Step 1: Install the SDK

Choose your preferred language:

### Node.js

```bash
npm install @subtrackr/sdk
```

### Python

```bash
pip install subtrackr
```

### Go

```bash
go get github.com/subtrackr/subtrackr-go
```

## Step 2: Initialize the Client

### Node.js

```javascript
import SubTrackr from '@subtrackr/sdk';

const client = new SubTrackr({
  apiKey: process.env.SUBTRACKR_API_KEY,
  environment: 'sandbox', // or 'production'
});
```

### Python

```python
import subtrackr
import os

client = subtrackr.Client(
    api_key=os.environ.get('SUBTRACKR_API_KEY'),
    environment='sandbox'  # or 'production'
)
```

### Go

```go
package main

import (
    "os"
    "github.com/subtrackr/subtrackr-go"
)

func main() {
    client := subtrackr.NewClient(
        os.Getenv("SUBTRACKR_API_KEY"),
        subtrackr.WithEnvironment("sandbox"),
    )
}
```

## Step 3: Create a Subscription

### Node.js

```javascript
const subscription = await client.subscriptions.create({
  name: 'Netflix',
  category: 'streaming',
  price: 15.99,
  currency: 'USD',
  billingCycle: 'monthly',
  startDate: new Date().toISOString(),
});

console.log('Created subscription:', subscription.id);
```

### Python

```python
subscription = client.subscriptions.create(
    name='Netflix',
    category='streaming',
    price=15.99,
    currency='USD',
    billing_cycle='monthly',
    start_date=datetime.now().isoformat()
)

print(f'Created subscription: {subscription.id}')
```

### Go

```go
subscription, err := client.Subscriptions.Create(&subtrackr.SubscriptionInput{
    Name:         "Netflix",
    Category:     "streaming",
    Price:        15.99,
    Currency:     "USD",
    BillingCycle: "monthly",
    StartDate:    time.Now().Format(time.RFC3339),
})

if err != nil {
    log.Fatal(err)
}

fmt.Printf("Created subscription: %s\n", subscription.ID)
```

## Step 4: List Subscriptions

### Node.js

```javascript
const subscriptions = await client.subscriptions.list({
  status: 'active',
  page: 1,
  limit: 20,
});

console.log(`Found ${subscriptions.data.length} subscriptions`);
```

### Python

```python
subscriptions = client.subscriptions.list(
    status='active',
    page=1,
    limit=20
)

print(f'Found {len(subscriptions.data)} subscriptions')
```

### Go

```go
subscriptions, err := client.Subscriptions.List(&subtrackr.ListOptions{
    Status: "active",
    Page:   1,
    Limit:  20,
})

if err != nil {
    log.Fatal(err)
}

fmt.Printf("Found %d subscriptions\n", len(subscriptions.Data))
```

## Step 5: Set Up Webhooks

### Register a Webhook

```javascript
const webhook = await client.webhooks.create({
  url: 'https://your-app.com/webhook',
  events: ['subscription.created', 'payment.completed'],
  secret: 'your_webhook_secret',
});

console.log('Webhook created:', webhook.id);
```

### Handle Webhook Events

```javascript
import express from 'express';
import crypto from 'crypto';

const app = express();

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-subtrackr-signature'];
  const payload = req.body;

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', 'your_webhook_secret')
    .update(payload)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(payload);

  switch (event.type) {
    case 'subscription.created':
      console.log('New subscription created:', event.data.subscription);
      break;
    case 'payment.completed':
      console.log('Payment completed:', event.data.payment);
      break;
    default:
      console.log('Unhandled event:', event.type);
  }

  res.status(200).send('OK');
});

app.listen(3000, () => {
  console.log('Webhook server running on port 3000');
});
```

## Step 6: Track Usage

### Record API Usage

```javascript
// Usage is automatically tracked when using the SDK
// You can also manually record usage:

await client.usage.track({
  endpoint: '/v1/subscriptions',
  method: 'GET',
  responseTime: 150,
  success: true,
});
```

### Get Usage Metrics

```javascript
const usage = await client.usage.getMetrics({
  startDate: '2024-01-01',
  endDate: '2024-01-31',
});

console.log('Total requests:', usage.totalRequests);
console.log('Success rate:', usage.successRate);
```

## Step 7: Error Handling

### Node.js

```javascript
try {
  const subscription = await client.subscriptions.create({
    name: 'Netflix',
    category: 'streaming',
    price: -10, // Invalid price
  });
} catch (error) {
  if (error.code === 'INVALID_REQUEST') {
    console.error('Validation error:', error.message);
    console.error('Details:', error.details);
  } else if (error.code === 'RATE_LIMIT_EXCEEDED') {
    console.error('Rate limit exceeded. Retry after:', error.retryAfter);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Python

```python
try:
    subscription = client.subscriptions.create(
        name='Netflix',
        category='streaming',
        price=-10  # Invalid price
    )
except subtrackr.ValidationError as e:
    print(f'Validation error: {e.message}')
    print(f'Details: {e.details}')
except subtrackr.RateLimitError as e:
    print(f'Rate limit exceeded. Retry after: {e.retry_after}')
except subtrackr.SubTrackrError as e:
    print(f'Unexpected error: {e}')
```

## Step 8: Testing with Sandbox

### Using Test Data

The sandbox environment comes with pre-populated test data:

```javascript
// Get test subscriptions
const testSubscriptions = await client.sandbox.getTestData();
console.log('Test subscriptions:', testSubscriptions.subscriptions);

// Reset sandbox data
await client.sandbox.reset();
```

### Testing Webhooks Locally

Use the SubTrackr CLI to forward webhooks to your local environment:

```bash
npm install -g @subtrackr/cli

subtrackr listen --forward-to localhost:3000/webhook
```

## Best Practices

1. **Use Environment Variables**: Never hardcode API keys
2. **Handle Errors Gracefully**: Implement proper error handling
3. **Use Idempotency Keys**: For critical operations
4. **Implement Retry Logic**: With exponential backoff
5. **Validate Webhook Signatures**: Always verify webhook authenticity
6. **Use Test Keys for Development**: Never use live keys in development

## Next Steps

- Read the [API Reference](./api-reference.md) for detailed endpoint documentation
- Explore [Advanced Topics](./advanced-topics.md) for more features
- Join our [Community](https://community.subtrackr.io) for support

## Support

- **Email**: support@subtrackr.io
- **Documentation**: [docs.subtrackr.io](https://docs.subtrackr.io)
- **GitHub**: [github.com/subtrackr](https://github.com/subtrackr)
