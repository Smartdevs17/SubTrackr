# Webhook Integration Guide

## Overview

Webhooks allow your application to receive real-time notifications when events occur in SubTrackr. This guide covers how to set up, verify, and handle webhooks.

## Setting Up Webhooks

### 1. Register a Webhook Endpoint

```bash
curl -X POST https://api.subtrackr.io/v1/webhooks \
  -H "Authorization: Bearer sk_test_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.com/webhooks/subtrackr",
    "events": [
      "subscription.created",
      "subscription.updated",
      "subscription.cancelled",
      "payment.completed",
      "payment.failed"
    ],
    "secret": "whsec_your_webhook_secret"
  }'
```

### 2. Available Events

| Event | Description |
|-------|-------------|
| `subscription.created` | A new subscription was created |
| `subscription.updated` | A subscription was updated |
| `subscription.cancelled` | A subscription was cancelled |
| `subscription.paused` | A subscription was paused |
| `subscription.resumed` | A subscription was resumed |
| `payment.completed` | A payment was successfully processed |
| `payment.failed` | A payment processing failed |
| `payment.refunded` | A payment was refunded |
| `invoice.generated` | A new invoice was generated |
| `invoice.paid` | An invoice was paid |
| `invoice.overdue` | An invoice is past due |

### 3. Webhook Payload Structure

```json
{
  "id": "evt_123456789",
  "type": "subscription.created",
  "apiVersion": "2024-01-01",
  "created": 1704067200,
  "data": {
    "object": {
      "id": "sub_123",
      "name": "Netflix",
      "status": "active",
      "price": 15.99,
      "currency": "USD",
      "billingCycle": "monthly",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  },
  "livemode": false,
  "pendingWebhooks": 1,
  "request": {
    "id": "req_123",
    "idempotencyKey": "idem_123"
  }
}
```

## Verifying Webhooks

Always verify webhook signatures to ensure they're from SubTrackr.

### Node.js

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const timestamp = signature.split(',')[0].split('=')[1];
  const signatures = signature.split(',')[1].split('=')[1];
  
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signatures, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

// Express middleware
app.post('/webhooks/subtrackr', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-subtrackr-signature'];
  const payload = req.body;
  
  if (!verifyWebhookSignature(payload, signature, process.env.WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }
  
  const event = JSON.parse(payload);
  handleWebhookEvent(event);
  
  res.status(200).json({ received: true });
});
```

### Python

```python
import hmac
import hashlib
from flask import Flask, request, jsonify

app = Flask(__name__)

def verify_webhook_signature(payload, signature, secret):
    timestamp = signature.split(',')[0].split('=')[1]
    signatures = signature.split(',')[1].split('=')[1]
    
    signed_payload = f"{timestamp}.{payload}"
    expected_signature = hmac.new(
        secret.encode(),
        signed_payload.encode(),
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(signatures, expected_signature)

@app.route('/webhooks/subtrackr', methods=['POST'])
def handle_webhook():
    signature = request.headers.get('X-Subtrackr-Signature')
    payload = request.data.decode('utf-8')
    
    if not verify_webhook_signature(payload, signature, os.environ['WEBHOOK_SECRET']):
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
    "fmt"
    "io"
    "net/http"
    "strings"
)

func verifyWebhookSignature(payload, signature, secret string) bool {
    parts := strings.Split(signature, ",")
    if len(parts) != 2 {
        return false
    }
    
    timestamp := strings.Split(parts[0], "=")[1]
    sig := strings.Split(parts[1], "=")[1]
    
    signedPayload := fmt.Sprintf("%s.%s", timestamp, payload)
    
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write([]byte(signedPayload))
    expectedSignature := hex.EncodeToString(mac.Sum(nil))
    
    return hmac.Equal([]byte(sig), []byte(expectedSignature))
}

func handleWebhook(w http.ResponseWriter, r *http.Request) {
    signature := r.Header.Get("X-Subtrackr-Signature")
    payload, _ := io.ReadAll(r.Body)
    
    if !verifyWebhookSignature(string(payload), signature, os.Getenv("WEBHOOK_SECRET")) {
        http.Error(w, "Invalid signature", http.StatusUnauthorized)
        return
    }
    
    var event map[string]interface{}
    json.Unmarshal(payload, &event)
    
    handleWebhookEvent(event)
    
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]bool{"received": true})
}
```

## Handling Webhook Events

### Event Handler Pattern

```javascript
async function handleWebhookEvent(event) {
  switch (event.type) {
    case 'subscription.created':
      await handleSubscriptionCreated(event.data.object);
      break;
    
    case 'subscription.updated':
      await handleSubscriptionUpdated(event.data.object);
      break;
    
    case 'subscription.cancelled':
      await handleSubscriptionCancelled(event.data.object);
      break;
    
    case 'payment.completed':
      await handlePaymentCompleted(event.data.object);
      break;
    
    case 'payment.failed':
      await handlePaymentFailed(event.data.object);
      break;
    
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

async function handleSubscriptionCreated(subscription) {
  // Update your database
  await db.subscriptions.create({
    id: subscription.id,
    name: subscription.name,
    status: subscription.status,
    price: subscription.price,
  });
  
  // Send welcome email
  await emailService.send({
    to: subscription.customerEmail,
    template: 'subscription-welcome',
    data: { subscription },
  });
}

async function handlePaymentCompleted(payment) {
  // Update payment status
  await db.payments.update(payment.id, {
    status: 'completed',
    paidAt: new Date(),
  });
  
  // Send receipt
  await emailService.send({
    to: payment.customerEmail,
    template: 'payment-receipt',
    data: { payment },
  });
}
```

## Idempotency

Webhooks may be delivered multiple times. Implement idempotency to avoid duplicate processing:

```javascript
const processedEvents = new Set();

async function handleWebhookEvent(event) {
  // Check if already processed
  if (processedEvents.has(event.id)) {
    console.log(`Event ${event.id} already processed, skipping`);
    return;
  }
  
  try {
    // Process event
    await processEvent(event);
    
    // Mark as processed
    processedEvents.add(event.id);
  } catch (error) {
    console.error(`Error processing event ${event.id}:`, error);
    throw error;
  }
}
```

## Retry Policy

SubTrackr retries failed webhook deliveries with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |
| 6 | 8 hours |
| 7 | 24 hours |

### Responding to Webhooks

Return a `200` status code to acknowledge receipt:

```javascript
res.status(200).json({ received: true });
```

Any non-2xx response will trigger a retry.

## Testing Webhooks

### Using the Sandbox

Test webhooks in the sandbox environment:

```bash
# Trigger a test webhook
curl -X POST https://sandbox.subtrackr.io/v1/webhooks/test \
  -H "Authorization: Bearer sk_test_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "webhookId": "wh_123",
    "event": "subscription.created"
  }'
```

### Local Testing with ngrok

1. Start your local server:
```bash
node server.js
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
    "url": "https://your-ngrok-url.ngrok.io/webhooks/subtrackr",
    "events": ["subscription.created"]
  }'
```

### Using SubTrackr CLI

```bash
npm install -g @subtrackr/cli

# Listen for webhooks and forward to local server
subtrackr listen --forward-to localhost:3000/webhooks/subtrackr

# Trigger a test event
subtrackr trigger subscription.created
```

## Security Best Practices

1. **Always Verify Signatures**: Never process unverified webhooks
2. **Use HTTPS**: Webhook URLs must use HTTPS
3. **Store Secrets Securely**: Never expose webhook secrets
4. **Implement Idempotency**: Handle duplicate deliveries
5. **Respond Quickly**: Process webhooks asynchronously if needed
6. **Log All Events**: Keep an audit trail of webhook deliveries
7. **Monitor Failures**: Set up alerts for webhook delivery failures

## Troubleshooting

### Common Issues

**Webhooks not being received**
- Check webhook URL is correct and accessible
- Verify webhook is active (`status: "active"`)
- Check server logs for errors

**Signature verification failing**
- Ensure you're using the correct secret
- Check that you're verifying the raw payload
- Verify the timestamp is within tolerance

**Duplicate events**
- Implement idempotency using event IDs
- Check if your server is responding with 200

### Debug Mode

Enable debug logging:

```javascript
const client = new SubTrackr({
  apiKey: 'sk_test_your_api_key',
  debug: true,
});
```

## Support

- **Webhook Logs**: View delivery logs in the Developer Portal
- **Test Events**: Use the sandbox to test webhook delivery
- **Support**: webhooks@subtrackr.io
