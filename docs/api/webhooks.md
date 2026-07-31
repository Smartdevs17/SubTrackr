# Webhook Event Reference

SubTrackr sends HTTP POST requests to your registered endpoint whenever a
billing event occurs. Every request includes a `Subtrackr-Signature` header
you should verify before processing the payload.

---

## Payload envelope

Every webhook payload follows this structure:

```json
{
  "id":        "evt_abc123",
  "type":      "subscription.created",
  "apiVersion": "2024-01-01",
  "createdAt": "2025-01-15T10:30:00Z",
  "data":      { ... }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique event ID. Use this for idempotency. |
| `type` | string | Event type (see table below). |
| `apiVersion` | string | API version that generated this event. |
| `createdAt` | ISO 8601 | When the event occurred. |
| `data` | object | Event-specific payload (see each event below). |

---

## Signature verification

SubTrackr signs every webhook using HMAC-SHA256.

```
Subtrackr-Signature: sha256=<hex_digest>
```

**Verification steps:**

1. Extract the raw request body (do NOT parse JSON first).
2. Compute `HMAC-SHA256(body, signingSecret)`.
3. Compare with the value after `sha256=` using a constant-time comparison.
4. Reject requests where the signature does not match.

---

## Retries

Failed deliveries (non-2xx response, timeout > 30 s) are retried with
exponential back-off:

| Attempt | Delay |
|---------|-------|
| 1st retry | 5 minutes |
| 2nd retry | 30 minutes |
| 3rd retry | 2 hours |
| 4th retry | 5 hours |
| 5th retry | 10 hours |

After 5 failed attempts the event is marked `failed` and no further retries occur.
Check the dashboard under **Webhooks → Delivery Logs** to inspect failures.

---

## Event catalogue

### Subscription events

#### `subscription.created`

Fired when a new subscription is created (including trials).

```json
{
  "id": "evt_001",
  "type": "subscription.created",
  "apiVersion": "2024-01-01",
  "createdAt": "2025-01-15T10:30:00Z",
  "data": {
    "id": "sub_abc123",
    "customerId": "cus_xyz789",
    "planId": "plan_monthly_pro",
    "status": "trialing",
    "currentPeriodStart": "2025-01-15T10:30:00Z",
    "currentPeriodEnd": "2025-02-15T10:30:00Z",
    "trialEnd": "2025-03-01T00:00:00Z",
    "cancelAtPeriodEnd": false
  }
}
```

---

#### `subscription.updated`

Fired when a subscription's plan, status, or metadata changes.

```json
{
  "type": "subscription.updated",
  "data": {
    "id": "sub_abc123",
    "previousPlanId": "plan_monthly_basic",
    "planId": "plan_monthly_pro",
    "status": "active"
  }
}
```

---

#### `subscription.cancelled`

Fired when a subscription is cancelled (immediately or scheduled).

```json
{
  "type": "subscription.cancelled",
  "data": {
    "id": "sub_abc123",
    "customerId": "cus_xyz789",
    "cancelledAt": "2025-01-20T14:00:00Z",
    "cancelAtPeriodEnd": false,
    "reason": "Customer requested"
  }
}
```

---

#### `subscription.paused`

Fired when a subscription is paused.

```json
{
  "type": "subscription.paused",
  "data": {
    "id": "sub_abc123",
    "pausedAt": "2025-01-20T14:00:00Z",
    "resumeAt": "2025-06-01T00:00:00Z"
  }
}
```

---

#### `subscription.resumed`

Fired when a paused subscription is resumed.

```json
{
  "type": "subscription.resumed",
  "data": {
    "id": "sub_abc123",
    "resumedAt": "2025-06-01T00:00:00Z",
    "status": "active"
  }
}
```

---

#### `subscription.trial_will_end`

Sent **3 days before** a trial period ends. Use this to prompt the customer to
add a payment method.

```json
{
  "type": "subscription.trial_will_end",
  "data": {
    "id": "sub_abc123",
    "trialEnd": "2025-03-01T00:00:00Z"
  }
}
```

---

#### `subscription.expired`

Fired when a subscription reaches its `currentPeriodEnd` without renewal.

```json
{
  "type": "subscription.expired",
  "data": {
    "id": "sub_abc123",
    "expiredAt": "2025-02-15T10:30:00Z"
  }
}
```

---

### Invoice events

#### `invoice.created`

Fired when a new invoice is drafted at the start of a billing cycle.

```json
{
  "type": "invoice.created",
  "data": {
    "id": "inv_001",
    "subscriptionId": "sub_abc123",
    "customerId": "cus_xyz789",
    "amount": 29.99,
    "currency": "USD",
    "status": "open",
    "dueDate": "2025-02-15T10:30:00Z"
  }
}
```

---

#### `invoice.paid`

Fired when a charge succeeds.

```json
{
  "type": "invoice.paid",
  "data": {
    "id": "inv_001",
    "subscriptionId": "sub_abc123",
    "amount": 29.99,
    "currency": "USD",
    "status": "paid",
    "paidAt": "2025-02-15T10:35:00Z"
  }
}
```

---

#### `invoice.payment_failed`

Fired when a charge attempt fails. The subscription enters `past_due`.

```json
{
  "type": "invoice.payment_failed",
  "data": {
    "id": "inv_001",
    "subscriptionId": "sub_abc123",
    "amount": 29.99,
    "currency": "USD",
    "failureCode": "card_declined",
    "failureMessage": "Your card was declined.",
    "nextAttemptAt": "2025-02-18T10:35:00Z"
  }
}
```

---

### Customer events

#### `customer.created`

```json
{
  "type": "customer.created",
  "data": {
    "id": "cus_xyz789",
    "email": "jane@example.com",
    "name": "Jane Doe"
  }
}
```

---

## Idempotency

Your handler should be idempotent. SubTrackr may deliver the same event more
than once (e.g. after a network failure). Use `event.id` as a deduplication key:

```typescript
// Example with a Set in memory (use a DB in production)
const processed = new Set<string>();

function handleWebhook(event: WebhookEvent) {
  if (processed.has(event.id)) return; // already handled
  processed.add(event.id);
  // ... process event
}
```

---

## Testing webhooks locally

Use the SubTrackr CLI to forward events to your local server:

```bash
npx subtrackr webhook-forward --url http://localhost:3000/webhooks/subtrackr
```

Or replay a specific event from the dashboard:

```bash
npx subtrackr webhook-replay evt_abc123 --endpoint whe_001
```
