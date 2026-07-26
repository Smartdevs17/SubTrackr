# SubTrackr API Documentation

Welcome to the SubTrackr API documentation. This guide will help you integrate subscription management into your applications.

## Getting Started

### 1. Create a Developer Account

Sign up at [developer.subtrackr.io](https://developer.subtrackr.io) to get started.

### 2. Get Your API Keys

After registration, navigate to **Settings > API Keys** to generate your keys:

- **Test Keys** (`sk_test_...`): For development and testing
- **Live Keys** (`sk_live_...`): For production use

### 3. Make Your First Request

```bash
curl -X GET https://api.subtrackr.io/v1/subscriptions \
  -H "Authorization: Bearer sk_test_your_api_key" \
  -H "Content-Type: application/json"
```

## Authentication

All API requests require authentication via Bearer token:

```
Authorization: Bearer sk_test_your_api_key
```

### API Key Types

| Type | Prefix | Use Case |
|------|--------|----------|
| Test | `sk_test_` | Development, testing, sandbox |
| Live | `sk_live_` | Production environment |

### Rate Limits

| Tier | Requests/Minute | Requests/Hour | Requests/Day |
|------|-----------------|---------------|--------------|
| Free | 20 | 1,000 | 10,000 |
| Pro | 100 | 5,000 | 50,000 |
| Enterprise | 1,000 | 50,000 | 500,000 |

## Endpoints

### Subscriptions

#### List Subscriptions

```http
GET /v1/subscriptions
```

**Query Parameters:**
- `status` (optional): Filter by status (`active`, `cancelled`, `paused`)
- `category` (optional): Filter by category
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20, max: 100)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "sub_123",
      "name": "Netflix",
      "category": "streaming",
      "price": 15.99,
      "currency": "USD",
      "billingCycle": "monthly",
      "status": "active",
      "nextBillingDate": "2024-02-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "hasNext": false
  }
}
```

#### Create Subscription

```http
POST /v1/subscriptions
```

**Request Body:**
```json
{
  "name": "Netflix",
  "category": "streaming",
  "price": 15.99,
  "currency": "USD",
  "billingCycle": "monthly",
  "startDate": "2024-01-01T00:00:00Z"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "sub_123",
    "name": "Netflix",
    "category": "streaming",
    "price": 15.99,
    "currency": "USD",
    "billingCycle": "monthly",
    "status": "active",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

#### Get Subscription

```http
GET /v1/subscriptions/:id
```

#### Update Subscription

```http
PUT /v1/subscriptions/:id
```

#### Delete Subscription

```http
DELETE /v1/subscriptions/:id
```

### Payments

#### List Payments

```http
GET /v1/payments
```

#### Create Payment

```http
POST /v1/payments
```

### Webhooks

#### List Webhooks

```http
GET /v1/webhooks
```

#### Create Webhook

```http
POST /v1/webhooks
```

**Request Body:**
```json
{
  "url": "https://your-app.com/webhook",
  "events": ["subscription.created", "payment.completed"],
  "secret": "your_webhook_secret"
}
```

### Analytics

#### Get Usage Analytics

```http
GET /v1/analytics/usage
```

#### Get Subscription Analytics

```http
GET /v1/analytics/subscriptions
```

## Error Handling

The API returns standard HTTP status codes:

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 429 | Rate Limit Exceeded |
| 500 | Internal Server Error |

### CoreError Enum

All contract errors use a standardized `CoreError` enum (defined in `subtrackr-types`), ensuring consistent error handling across contracts:

```rust
#[contracterror]
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CoreError {
    Unauthorized = 100,
    AlreadyInitialized = 200,
    NotInitialized = 201,
    InvalidAmount = 300,
    InvalidInterval = 301,
    InsufficientCredit = 400,
    PaymentFailed = 401,
    NotFound = 500,
    DuplicateEntry = 501,
    StorageError = 600,
    ExternalError = 700,
}
```

**Error Response Format:
```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "The request body is invalid",
    "details": {
      "field": "price",
      "issue": "must be a positive number"
    },
    "coreError": {
      "code": 300,
      "variant": "InvalidAmount",
      "userMessage": "The amount is invalid"
    }
  }
}
```

## Webhooks

### Webhook Events

| Event | Description |
|-------|-------------|
| `subscription.created` | New subscription created |
| `subscription.updated` | Subscription updated |
| `subscription.cancelled` | Subscription cancelled |
| `payment.completed` | Payment successfully processed |
| `payment.failed` | Payment processing failed |
| `invoice.generated` | New invoice generated |

### Webhook Payload

```json
{
  "id": "evt_123",
  "type": "subscription.created",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "subscription": {
      "id": "sub_123",
      "name": "Netflix"
    }
  }
}
```

### Verifying Webhooks

Verify webhook signatures using HMAC-SHA256:

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

## SDKs

### JavaScript/Node.js

```bash
npm install @subtrackr/sdk
```

```javascript
import SubTrackr from '@subtrackr/sdk';

const client = new SubTrackr({
  apiKey: 'sk_test_your_api_key',
});

const subscriptions = await client.subscriptions.list();
```

### Python

```bash
pip install subtrackr
```

```python
import subtrackr

client = subtrackr.Client(api_key='sk_test_your_api_key')

subscriptions = client.subscriptions.list()
```

### Go

```bash
go get github.com/subtrackr/subtrackr-go
```

```go
import "github.com/subtrackr/subtrackr-go"

client := subtrackr.NewClient("sk_test_your_api_key")

subscriptions, err := client.Subscriptions.List()
```

## Sandbox Environment

The sandbox environment provides an isolated testing environment with pre-populated test data.

### Accessing the Sandbox

Use test API keys (`sk_test_...`) to access the sandbox environment.

### Test Data

The sandbox comes with pre-populated test data:
- 8 sample subscriptions
- Sample payments
- Test webhooks

### Resetting Sandbox

Reset your sandbox data via the API:

```http
POST /v1/sandbox/reset
```

## Support

- **Documentation**: [docs.subtrackr.io](https://docs.subtrackr.io)
- **API Status**: [status.subtrackr.io](https://status.subtrackr.io)
- **Support Email**: support@subtrackr.io
- **Community**: [community.subtrackr.io](https://community.subtrackr.io)
