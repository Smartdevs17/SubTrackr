# Sandbox Environment Guide

## Overview

The SubTrackr Sandbox provides an isolated testing environment for developers to test their integrations without affecting production data.

## Features

- **Isolated Environment**: Complete data isolation from production
- **Pre-populated Test Data**: Sample subscriptions, payments, and webhooks
- **Rate Limiting**: Separate rate limits for sandbox environment
- **No Real Charges**: All transactions are simulated
- **Reset Capability**: Reset sandbox data at any time

## Getting Started

### 1. Access the Sandbox

Your sandbox environment is automatically created when you complete developer onboarding. Use your test API key to access it:

```bash
curl -X GET https://sandbox.subtrackr.io/v1/subscriptions \
  -H "Authorization: Bearer sk_test_your_api_key"
```

### 2. Sandbox URL

| Environment | Base URL |
|-------------|----------|
| Sandbox | `https://sandbox.subtrackr.io` |
| Production | `https://api.subtrackr.io` |

### 3. Test API Keys

Test API keys are prefixed with `sk_test_` and can only be used in the sandbox environment.

## Test Data

### Pre-populated Subscriptions

The sandbox comes with 8 sample subscriptions:

| ID | Name | Category | Price | Billing Cycle |
|----|------|----------|-------|---------------|
| sub_test_1 | Netflix | streaming | $15.99 | monthly |
| sub_test_2 | Spotify | streaming | $9.99 | monthly |
| sub_test_3 | Adobe CC | software | $54.99 | monthly |
| sub_test_4 | Slack | productivity | $8.75 | monthly |
| sub_test_5 | Gym Membership | fitness | $29.99 | monthly |
| sub_test_6 | GitHub Pro | software | $4.00 | monthly |
| sub_test_7 | Figma | software | $12.00 | monthly |
| sub_test_8 | Notion | productivity | $8.00 | monthly |

### Pre-populated Payments

Each subscription has 3 sample payments with various statuses:
- `completed`: Successfully processed
- `pending`: Awaiting processing
- `failed`: Processing failed

### Test Webhooks

A sample webhook is configured:
- URL: `https://example.com/webhook`
- Events: `subscription.created`, `payment.completed`
- Status: `active`

## Testing Scenarios

### Scenario 1: Create a Subscription

```bash
curl -X POST https://sandbox.subtrackr.io/v1/subscriptions \
  -H "Authorization: Bearer sk_test_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Subscription",
    "category": "software",
    "price": 29.99,
    "currency": "USD",
    "billingCycle": "monthly"
  }'
```

### Scenario 2: Process a Payment

```bash
curl -X POST https://sandbox.subtrackr.io/v1/payments \
  -H "Authorization: Bearer sk_test_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionId": "sub_test_1",
    "amount": 15.99,
    "currency": "USD",
    "method": "card"
  }'
```

### Scenario 3: Test Webhooks

```bash
# Trigger a test webhook event
curl -X POST https://sandbox.subtrackr.io/v1/webhooks/test \
  -H "Authorization: Bearer sk_test_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookId": "wh_test_1",
    "event": "subscription.created"
  }'
```

### Scenario 4: Handle Errors

Test error handling by sending invalid data:

```bash
# Invalid price (negative)
curl -X POST https://sandbox.subtrackr.io/v1/subscriptions \
  -H "Authorization: Bearer sk_test_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Invalid Subscription",
    "price": -10
  }'
```

Expected response:
```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Price must be a positive number",
    "details": {
      "field": "price",
      "issue": "must be a positive number"
    }
  }
}
```

## Sandbox Management

### Reset Sandbox Data

Reset all sandbox data to default state:

```bash
curl -X POST https://sandbox.subtrackr.io/v1/sandbox/reset \
  -H "Authorization: Bearer sk_test_your_api_key"
```

### Get Sandbox Status

Check sandbox environment status:

```bash
curl -X GET https://sandbox.subtrackr.io/v1/sandbox/status \
  -H "Authorization: Bearer sk_test_your_api_key"
```

Response:
```json
{
  "success": true,
  "data": {
    "environmentId": "sbx_123",
    "status": "active",
    "createdAt": "2024-01-01T00:00:00Z",
    "expiresAt": "2024-04-01T00:00:00Z",
    "usage": {
      "requests": 150,
      "storage": 2.5
    }
  }
}
```

### Get Sandbox Metrics

View sandbox usage metrics:

```bash
curl -X GET https://sandbox.subtrackr.io/v1/sandbox/metrics \
  -H "Authorization: Bearer sk_test_your_api_key"
```

## Rate Limits

Sandbox rate limits are separate from production:

| Limit | Value |
|-------|-------|
| Requests per minute | 60 |
| Requests per day | 10,000 |
| Storage | 100 MB |
| Concurrent connections | 10 |

## Testing Webhooks Locally

### Using ngrok

1. Install ngrok:
```bash
npm install -g ngrok
```

2. Start ngrok:
```bash
ngrok http 3000
```

3. Register webhook with ngrok URL:
```bash
curl -X POST https://sandbox.subtrackr.io/v1/webhooks \
  -H "Authorization: Bearer sk_test_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-ngrok-url.ngrok.io/webhook",
    "events": ["subscription.created", "payment.completed"]
  }'
```

### Using SubTrackr CLI

```bash
npm install -g @subtrackr/cli

subtrackr listen --forward-to localhost:3000/webhook
```

## Best Practices

1. **Use Sandbox for Development**: Always develop and test in sandbox first
2. **Test Error Scenarios**: Test how your app handles various error cases
3. **Reset Before Testing**: Reset sandbox data before starting a new test session
4. **Monitor Usage**: Keep track of your sandbox usage to avoid hitting limits
5. **Test Webhooks**: Verify your webhook handling works correctly

## Troubleshooting

### Common Issues

**Issue: 401 Unauthorized**
- Ensure you're using a test API key (`sk_test_...`)
- Check that the API key is valid and not revoked

**Issue: 429 Rate Limit Exceeded**
- Wait for the rate limit to reset
- Implement exponential backoff in your code

**Issue: Sandbox Data Not Resetting**
- Check sandbox status
- Ensure you're using the correct API key

### Getting Help

- **Documentation**: [docs.subtrackr.io/sandbox](https://docs.subtrackr.io/sandbox)
- **Support**: sandbox-support@subtrackr.io
- **Status**: [status.subtrackr.io](https://status.subtrackr.io)
