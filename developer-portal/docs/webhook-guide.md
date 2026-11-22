# Webhook Integration Guide

## Overview

Webhooks allow your application to receive real-time HTTP notifications when events occur in SubTrackr. Subscribe to the lifecycle events that matter to you — SubTrackr will deliver signed POST requests to your endpoint with a structured JSON payload.

---

## Advanced Attribute & Event Filtering

SubTrackr provides granular filtering so your webhooks only receive relevant events. You can filter by event patterns, exclusion rules, and payload attribute conditions.

### Filter Configuration Example

```json
{
  "url": "https://your-app.com/webhooks/subtrackr",
  "events": ["subscription.*", "payment.succeeded"],
  "filterConfig": {
    "enabled": true,
    "eventPatterns": ["subscription.*", "payment.succeeded"],
    "excludePatterns": ["subscription.cancelled"],
    "ruleCombination": "AND",
    "attributeRules": [
      {
        "field": "data.plan.price",
        "operator": "gte",
        "value": 100
      },
      {
        "field": "data.plan.currency",
        "operator": "eq",
        "value": "USDC"
      }
    ],
    "fieldProjections": ["id", "type", "occurredAt", "data"]
  }
}
```

### Supported Filter Operators

| Operator | Meaning | Example |
|----------|---------|---------|
|  | Equals |  |
|  | Not Equals |  |
|  /  | Greater than / or equal |  |
|  /  | Less than / or equal |  |
|  /  | In array / Not in array |  |
|  | String substring or array item |  |
|  | Regular expression pattern |  |
|  | Field is present / non-null |  |

---

## Quick Start

### 1. Register a Webhook Endpoint

```bash
curl -X POST https://api.subtrackr.io/v1/webhooks \
  -H "Authorization: Bearer sk_test_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.com/webhooks/subtrackr",
    "events": ["subscription.created", "payment.failed"],
    "secretKey": "whsec_your_webhook_secret"
  }'
```

**Response:**

```json
{
  "id": "whk_abc123",
  "merchantId": "merchant_1",
  "url": "https://your-app.com/webhooks/subtrackr",
  "events": ["subscription.created", "payment.failed"],
  "isPaused": false,
  "createdAt": 1719100000000
}
```

---

## Event Type Filtering

### Wildcard Subscriptions

SubTrackr supports wildcard patterns so you can subscribe to broad categories without listing every individual event type.

| Pattern | Matches |
|---------|---------|
| `*` | **All** event types across all categories |
| `subscription.*` | All subscription lifecycle events |
| `payment.*` | All payment events |
| `invoice.*` | All invoice events |
| `trial.*` | All trial period events |
| `usage.*` | All usage metering events |
| `plan.*` | All plan change events |
| `subscription.created` | Exact match only |

**Example — Subscribe to all subscription events:**

```json
{
  "events": ["subscription.*", "payment.failed"]
}
```

---

## Full Event Catalog

### Subscription Events

| Event | Description |
|-------|-------------|
| `subscription.created` | New subscription created |
| `subscription.updated` | Subscription details updated |
| `subscription.cancelled` | Subscription cancelled |
| `subscription.paused` | Subscription paused |
| `subscription.resumed` | Subscription resumed from pause |
| `subscription.expired` | Subscription reached its end date |
| `subscription.renewed` | Subscription auto-renewed |
| `subscription.upgraded` | Plan upgrade completed |
| `subscription.downgraded` | Plan downgrade completed |
| `subscription.transfer_requested` | Ownership transfer requested |
| `subscription.transfer_completed` | Ownership transfer completed |
| `subscription.grace_period_started` | Grace period started after failed payment |
| `subscription.grace_period_ended` | Grace period expired |

### Payment Events

| Event | Description |
|-------|-------------|
| `payment.succeeded` | Payment processed successfully |
| `payment.failed` | Payment attempt failed |
| `payment.refunded` | Payment refunded |
| `payment.disputed` | Payment disputed by subscriber |
| `payment.chargeback` | Chargeback initiated |
| `payment.method_updated` | Payment method changed |
| `payment.retry_scheduled` | Failed payment retry scheduled |

### Invoice Events

| Event | Description |
|-------|-------------|
| `invoice.created` | Invoice generated |
| `invoice.finalized` | Invoice finalized and ready for payment |
| `invoice.paid` | Invoice paid |
| `invoice.voided` | Invoice voided |
| `invoice.overdue` | Invoice past due |

### Trial Events

| Event | Description |
|-------|-------------|
| `trial.started` | Trial period started |
| `trial.ending_soon` | Trial ending within 3 days |
| `trial.ended` | Trial period ended |
| `trial.converted` | Trial converted to paid subscription |

### Usage Events

| Event | Description |
|-------|-------------|
| `usage.threshold_reached` | Usage threshold reached |
| `usage.limit_exceeded` | Usage limit exceeded |
| `usage.recorded` | Usage data point recorded |

### Plan Events

| Event | Description |
|-------|-------------|
| `plan.created` | New plan created |
| `plan.updated` | Plan details updated |
| `plan.archived` | Plan archived (no new subscriptions) |
| `plan.price_changed` | Plan price changed |

---

## Webhook Payload Structure

Every webhook delivery sends a JSON POST body with this shape:

```json
{
  "id": "tevt_abc123",
  "webhookId": "whk_abc123",
  "eventType": "subscription.created",
  "occurredAt": 1719100000000,
  "merchantId": "merchant_1",
  "payloadVersion": 1,
  "subscription": {
    "id": "sub_1",
    "planId": "plan_1",
    "subscriberId": "user_1",
    "status": "active",
    "startedAt": 1719000000000
  },
  "plan": {
    "id": "plan_1",
    "merchantId": "merchant_1",
    "name": "Pro",
    "price": 500,
    "token": "USDC"
  }
}
```

### HTTP Headers Sent with Every Delivery

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-SubTrackr-Signature` | HMAC-SHA256 hex digest — see Verification |
| `X-SubTrackr-Event-Type` | The event type string (e.g. `subscription.created`) |
| `X-SubTrackr-Event-Id` | Unique event identifier |
| `Idempotency-Key` | Stable key for idempotent processing |
| `X-SubTrackr-Payload-Truncated` | `"true"` only when payload exceeds 1 MB |
| `X-SubTrackr-Payload-Hash` | SHA-256 of the full payload (truncated deliveries only) |

---

## Verifying Webhook Signatures

SubTrackr signs every delivery using **HMAC-SHA256** over the JSON body using your webhook secret. Always verify the signature before processing the event.

The `X-SubTrackr-Signature` header contains the raw hex digest of:

```
HMAC-SHA256(key=secretKey, data=JSON.stringify(payload))
```

### Node.js / TypeScript

```typescript
import crypto from 'crypto';

function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);

  if (actualBytes.length !== expectedBytes.length) return false;
  return crypto.timingSafeEqual(actualBytes, expectedBytes);
}

// Express handler
import express from 'express';
const app = express();

app.post(
  '/webhooks/subtrackr',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const signature = req.headers['x-subtrackr-signature'] as string;

    if (!verifyWebhookSignature(req.body, signature, process.env.WEBHOOK_SECRET!)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body.toString());
    handleWebhookEvent(event);   // see "Handling Events" below

    res.status(200).json({ received: true });
  }
);
```

### Python

```python
import hmac
import hashlib
import os
from flask import Flask, request, jsonify

app = Flask(__name__)

def verify_webhook_signature(raw_body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        raw_body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)

@app.route('/webhooks/subtrackr', methods=['POST'])
def handle_webhook():
    signature = request.headers.get('X-SubTrackr-Signature', '')
    raw_body  = request.data

    if not verify_webhook_signature(raw_body, signature, os.environ['WEBHOOK_SECRET']):
        return jsonify({'error': 'Invalid signature'}), 401

    event = request.json
    handle_webhook_event(event)
    return jsonify({'received': True}), 200
```

### Go

```go
package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "io"
    "net/http"
    "os"
)

func verifyWebhookSignature(rawBody []byte, signature, secret string) bool {
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write(rawBody)
    expected := hex.EncodeToString(mac.Sum(nil))
    return hmac.Equal([]byte(signature), []byte(expected))
}

func handleWebhook(w http.ResponseWriter, r *http.Request) {
    signature := r.Header.Get("X-SubTrackr-Signature")
    rawBody, _ := io.ReadAll(r.Body)

    if !verifyWebhookSignature(rawBody, signature, os.Getenv("WEBHOOK_SECRET")) {
        http.Error(w, "Invalid signature", http.StatusUnauthorized)
        return
    }

    // ... process event
    w.WriteHeader(http.StatusOK)
}
```

---

## Retry Policy & Exponential Backoff

SubTrackr retries failed deliveries (any non-2xx response, or network timeout) using the following fixed schedule:

| Attempt | Delay after failure |
|---------|---------------------|
| 1st delivery | Immediate |
| Retry 1 | 1 minute |
| Retry 2 | 5 minutes |
| Retry 3 | 15 minutes |
| Retry 4 | 1 hour |
| Retry 5 | 6 hours |

After 5 failed retries the delivery is moved to the **Dead-Letter Queue (DLQ)** and can be manually replayed from the developer portal or via API.

### Custom Retry Policy

You can override the default schedule when registering a webhook:

```json
{
  "retryPolicy": {
    "maxRetries": 3,
    "initialDelayMs": 5000,
    "maxDelayMs": 300000,
    "backoffFactor": 2
  }
}
```

### Automatic Webhook Disablement

If your endpoint returns `410 Gone`, SubTrackr immediately stops all retries and marks the webhook as paused. Resume it manually once the endpoint is reinstated.

---

## Secret Rotation

Rotate your signing secret without dropped deliveries using the overlapping-key mechanism. The old secret remains valid during the transition window.

```bash
curl -X POST https://api.subtrackr.io/v1/webhooks/{webhookId}/rotate-secret \
  -H "Authorization: Bearer sk_live_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "newSecret": "whsec_new_secret_here",
    "overlapMs": 86400000
  }'
```

During the overlap window, SubTrackr accepts signatures from **both** the old and new secret. Update your service to use the new secret before the window expires.

---

## Webhook Testing Tools

### Test via API (`/v1/webhooks/:id/test`)

Send a simulated test delivery using realistic example payloads from the event catalog. Idempotency and rate limiting are bypassed so you can fire the endpoint repeatedly during development.

```bash
# Test with auto-selected event type (first subscribed event)
curl -X POST https://api.subtrackr.io/v1/webhooks/whk_abc123/test \
  -H "Authorization: Bearer sk_test_your_api_key"

# Test a specific event type
curl -X POST https://api.subtrackr.io/v1/webhooks/whk_abc123/test \
  -H "Authorization: Bearer sk_test_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "payment.failed",
    "customPayload": {
      "subscription": { "id": "sub_test_1", "status": "past_due" }
    }
  }'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "tdel_abc123",
    "status": "delivered",
    "attempts": 1,
    "responseCode": 200,
    "latencyMs": 145
  },
  "message": "Test delivery delivered"
}
```

### Test via Developer Portal

1. Navigate to **Developer Portal → Webhooks → Webhook Tester**
2. Enter your webhook URL or select a registered endpoint
3. Select the event type to simulate
4. Optionally customise the payload
5. Click **Send Test Webhook**
6. Review delivery status, HTTP response code, and latency

### Local Testing with ngrok

```bash
# 1. Start your local server
node server.js

# 2. Expose it with ngrok
ngrok http 3000

# 3. Register a webhook with the ngrok URL
curl -X POST https://api.subtrackr.io/v1/webhooks \
  -H "Authorization: Bearer sk_test_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-ngrok-id.ngrok.io/webhooks/subtrackr",
    "events": ["subscription.*"]
  }'
```

---

## Webhook Analytics

Query delivery analytics for any registered webhook:

```bash
curl https://api.subtrackr.io/v1/webhooks/{webhookId}/analytics \
  -H "Authorization: Bearer sk_live_your_api_key"
```

**Response:**

```json
{
  "webhookId": "whk_abc123",
  "totalDeliveries": 1842,
  "successfulDeliveries": 1801,
  "failedDeliveries": 41,
  "retryCount": 57,
  "pendingDeliveries": 0,
  "successRate": 0.977,
  "avgAttempts": 1.03,
  "avgLatencyMs": 187,
  "lastSuccessAt": 1719188400000,
  "lastFailureAt": 1719100800000
}
```

---

## Dead-Letter Queue

Deliveries that exhaust all retries land in the Dead-Letter Queue (DLQ). From the developer portal or API you can replay them individually.

```bash
# List dead-lettered deliveries for a webhook
curl https://api.subtrackr.io/v1/webhooks/{webhookId}/dead-letters \
  -H "Authorization: Bearer sk_live_your_api_key"

# Replay a dead-lettered delivery
curl -X POST https://api.subtrackr.io/v1/deliveries/{deliveryId}/replay \
  -H "Authorization: Bearer sk_live_your_api_key"
```

---

## Idempotency

SubTrackr uses a 24-hour idempotency window. If the same event is delivered twice within 24 hours using the same `Idempotency-Key`, the second delivery is marked `skipped` and **not** sent to your endpoint.

Implement idempotency in your handler using the event `id` field:

```typescript
async function handleWebhookEvent(event: WebhookPayload) {
  const alreadyProcessed = await db.processedEvents.find(event.id);
  if (alreadyProcessed) return; // safe to skip

  await db.transaction(async (tx) => {
    await processEvent(tx, event);
    await tx.processedEvents.create({ id: event.id, processedAt: new Date() });
  });
}
```

---

## CRUD Reference

| Operation | Method | Path |
|-----------|--------|------|
| Register webhook | `POST` | `/v1/webhooks` |
| List webhooks | `GET` | `/v1/webhooks?merchantId=...` |
| Get webhook | `GET` | `/v1/webhooks/:id` |
| Update webhook | `PATCH` | `/v1/webhooks/:id` |
| Delete webhook | `DELETE` | `/v1/webhooks/:id` |
| Pause webhook | `POST` | `/v1/webhooks/:id/pause` |
| Resume webhook | `POST` | `/v1/webhooks/:id/resume` |
| Rotate secret | `POST` | `/v1/webhooks/:id/rotate-secret` |
| Send test delivery | `POST` | `/v1/webhooks/:id/test` |
| Get analytics | `GET` | `/v1/webhooks/:id/analytics` |
| List deliveries | `GET` | `/v1/webhooks/:id/deliveries` |
| Get delivery | `GET` | `/v1/deliveries/:id` |
| Retry delivery | `POST` | `/v1/deliveries/:id/retry` |
| List DLQ | `GET` | `/v1/webhooks/:id/dead-letters` |
| Replay DLQ entry | `POST` | `/v1/deliveries/:id/replay` |

---

## Security Best Practices

1. **Always Verify Signatures** — never process unverified requests
2. **Use HTTPS Only** — reject any endpoint using plain HTTP
3. **Store Secrets Securely** — use environment variables or a secrets manager
4. **Implement Idempotency** — use event IDs to guard against duplicate processing
5. **Respond within 5 seconds** — process asynchronously if your handler is slow
6. **Audit All Events** — log the full payload for debugging and compliance
7. **Monitor Delivery Rate** — set up alerts when `successRate` drops below your SLA
8. **Rotate Secrets Regularly** — use the overlapping-rotation mechanism for zero-downtime rotations

---

## Troubleshooting

### Webhooks not received
- Confirm your endpoint is publicly reachable (use ngrok locally)
- Check that the webhook is not paused (`isPaused: false`)
- Review delivery logs in the developer portal

### Signature verification failing
- Ensure you verify the **raw bytes** of the request body before JSON parsing
- Confirm you are using the correct webhook secret (not the API key)
- Check that your HMAC implementation does not wrap a timestamp around the body

### Duplicate events
- Implement idempotency using the `id` field from the event payload
- Ensure your endpoint returns `200` on the first delivery to prevent retries

### 410 Gone — webhook auto-disabled
- SubTrackr stops all retries when your endpoint returns `410`
- Fix the endpoint, then call `/v1/webhooks/:id/resume` to re-enable

---

## Support

- **Delivery Logs**: Developer Portal → Webhooks → Delivery History
- **Test Tools**: Developer Portal → Webhooks → Webhook Tester
- **Analytics**: Developer Portal → Webhooks → Analytics
- **Email**: webhooks@subtrackr.io
- **Community**: [Discord](https://discord.gg/subtrackr)
