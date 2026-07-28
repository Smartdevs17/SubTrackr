# Rate Limiting

SubTrackr's API enforces rate limits to ensure fair usage and platform stability. Every API key and user account has request quotas based on their subscription tier.

---

## Table of Contents

1. [Overview](#overview)
2. [Rate Limit Tiers](#rate-limit-tiers)
3. [How Rate Limits Work](#how-rate-limits-work)
4. [Response Headers](#response-headers)
5. [Rate Limit Error Response](#rate-limit-error-response)
6. [Per-User Limits](#per-user-limits)
7. [Bypass for Trusted Clients](#bypass-for-trusted-clients)
8. [Custom Limits per API Key](#custom-limits-per-api-key)
9. [Analytics & Monitoring](#analytics--monitoring)
10. [Best Practices](#best-practices)
11. [API Reference](#api-reference)
12. [FAQ](#faq)

---

## Overview

Rate limiting protects the SubTrackr API from abusive traffic patterns while guaranteeing capacity for all users. Limits operate on three complementary windows:

| Window | Description |
|--------|-------------|
| **Hourly** | Rolling 60-minute window |
| **Daily** | Rolling 24-hour window |
| **Monthly** | Rolling 30-day window |

In addition, a **burst token bucket** smooths short-lived traffic spikes, and a **concurrency limit** caps simultaneous in-flight requests per key.

---

## Rate Limit Tiers

| Tier | Hourly | Daily | Monthly | Burst | Concurrent |
|------|-------:|------:|--------:|------:|-----------:|
| **Free** | 100 | 500 | 10,000 | 20 | 2 |
| **Basic** | 500 | 2,500 | 50,000 | 50 | 5 |
| **Premium** | 1,000 | 10,000 | 200,000 | 100 | 10 |
| **Enterprise** | 10,000 | 100,000 | 2,000,000 | 500 | 50 |

> **Note:** Tier limits are defaults. Per-key custom limits and bypass overrides take precedence. See [Custom Limits per API Key](#custom-limits-per-api-key).

---

## How Rate Limits Work

### Token bucket (burst)

Each API key has a token bucket refilled at **1 token per second** up to the burst limit. A request consumes one token. If the bucket is empty the request is rejected even if the hourly window has remaining capacity.

### Window counters

Three independent sliding-window counters track requests per hour, per day, and per month. The most restrictive limit that has been exhausted determines the `Retry-After` value.

### Concurrency

A lightweight concurrency counter prevents stampedes. If an API key has `concurrentLimit` simultaneous in-flight requests, new requests are rejected until one of the active ones completes.

### Request identity

The rate limiter identifies requests by, in order of preference:

1. `X-API-Key` header
2. `Authorization: Bearer <token>` header
3. `X-User-ID` header
4. Client IP address (unauthenticated fallback)

---

## Response Headers

Every non-bypassed API response includes the following headers:

| Header | Type | Description |
|--------|------|-------------|
| `X-RateLimit-Limit` | integer | Hourly request limit for this API key |
| `X-RateLimit-Remaining` | integer | Requests remaining in the current hourly window |
| `X-RateLimit-Reset` | Unix timestamp (s) | Time when the hourly window resets |
| `X-RateLimit-Policy` | string | Active policy, e.g. `premium;hourly=1000;daily=10000` |
| `X-UserRateLimit-Limit` | integer | Per-user aggregate hourly limit |
| `X-UserRateLimit-Remaining` | integer | Per-user requests remaining this hour |
| `X-UserRateLimit-Reset` | Unix timestamp (s) | When the per-user hourly window resets |

On a `429` response:

| Header | Type | Description |
|--------|------|-------------|
| `Retry-After` | integer (seconds) | How many seconds to wait before retrying |

---

## Rate Limit Error Response

When a limit is exceeded the API returns HTTP **429 Too Many Requests**:

```json
{
  "status": 429,
  "error": "rate_limit_exceeded",
  "message": "Rate limit exceeded. Retry after 47 seconds.",
  "retryAfter": 47,
  "limit": 100,
  "remaining": 0,
  "resetAt": 1722038400000
}
```

### Soft-limit warnings

Before a key reaches its limit the service emits a soft-limit warning at **80%** and **95%** usage. These do not reject requests but are returned in the response body alongside successful responses.

```json
{
  "warning": "soft_limit_reached",
  "usagePercent": 82,
  "limit": 100,
  "current": 82,
  "tier": "FREE",
  "message": "API usage at 82% of hourly limit (82/100)"
}
```

---

## Per-User Limits

In addition to per-key limits, SubTrackr enforces aggregate per-user limits to prevent circumventing quotas by creating many API keys. The per-user hourly limit is **5× the tier's per-key hourly limit**.

| Tier | User Hourly | User Daily | User Monthly |
|------|------------:|-----------:|-------------:|
| Free | 500 | 2,500 | 50,000 |
| Basic | 2,500 | 12,500 | 250,000 |
| Premium | 5,000 | 50,000 | 1,000,000 |
| Enterprise | 50,000 | 500,000 | 10,000,000 |

Per-user counters are tracked separately from per-key counters. Both must be within limits for a request to succeed.

---

## Bypass for Trusted Clients

Some internal service accounts (webhooks, CI jobs, monitoring agents) need to bypass rate limiting. SubTrackr provides a **bypass list** for this purpose.

### Adding a bypass via the API

```http
POST /rate-limits/bypass
Content-Type: application/json
Authorization: Bearer <admin-token>

{
  "type": "key",
  "value": "sk_internal_monitoring_abc123",
  "action": "add"
}
```

```http
POST /rate-limits/bypass
Content-Type: application/json

{
  "type": "user",
  "value": "user_service_account_456",
  "action": "add"
}
```

### Removing a bypass

```http
POST /rate-limits/bypass
Content-Type: application/json

{
  "type": "key",
  "value": "sk_internal_monitoring_abc123",
  "action": "remove"
}
```

### Developer portal

Go to **Developer Portal → API Keys → ⚙ Configure → Rate Limits → Bypass Rate Limiting** and toggle the switch.

> ⚠️ Bypassed keys are fully exempt from all rate checks. Restrict bypass to keys that are provably non-abusive.

---

## Custom Limits per API Key

You can override tier defaults on a per-key basis. This is useful for:
- Dedicated integration keys that need higher burst capacity.
- Test keys that should have a very low limit.
- Sandbox keys isolated from production quotas.

### Setting custom limits

```http
POST /rate-limits/config
Content-Type: application/json

{
  "apiKey": "sk_live_abc123",
  "limits": {
    "hourlyLimit": 2000,
    "dailyLimit": 20000,
    "monthlyLimit": 400000,
    "burstLimit": 200,
    "concurrentLimit": 20
  }
}
```

Omit any field to keep the tier default for that dimension.

### Developer portal

Go to **Developer Portal → API Keys → ⚙ Configure → Rate Limits → Custom Limits**.

---

## Analytics & Monitoring

### Rate limit analytics endpoint

```http
GET /rate-limits/analytics
GET /rate-limits/analytics?tier=PREMIUM
```

Response:

```json
{
  "rateLimits": {
    "totalRequests": 54821,
    "rateLimitHits": 142,
    "hitRate": 0.0026,
    "topThrottledKeys": [
      { "key": "sk_live_abc123", "hits": 87 },
      { "key": "sk_live_def456", "hits": 31 }
    ],
    "topThrottledEndpoints": [
      { "endpoint": "POST /subscriptions", "hits": 95 },
      { "endpoint": "GET /analytics", "hits": 47 }
    ],
    "byTier": {
      "FREE":       { "requests": 12400, "hits": 98, "hitRate": 0.0079 },
      "BASIC":      { "requests": 28600, "hits": 44, "hitRate": 0.0015 },
      "PREMIUM":    { "requests": 11000, "hits": 0,  "hitRate": 0 },
      "ENTERPRISE": { "requests": 2821,  "hits": 0,  "hitRate": 0 }
    }
  }
}
```

### Rate limit status for a key

```http
GET /rate-limits/status?apiKey=sk_live_abc123&tier=BASIC
```

Response:

```json
{
  "limits": {
    "tier": "BASIC",
    "hourlyLimit": 500,
    "dailyLimit": 2500,
    "monthlyLimit": 50000,
    "burstLimit": 50,
    "concurrentLimit": 5
  },
  "current": {
    "hourly": 23,
    "daily": 310,
    "monthly": 4120,
    "burstTokens": 42
  },
  "remaining": {
    "hourly": 477,
    "daily": 2190,
    "monthly": 45880,
    "burstTokens": 42
  },
  "resetAt": {
    "hourly": 1722038400000,
    "daily": 1722081600000,
    "monthly": 1724630400000
  }
}
```

### Developer portal dashboard

Navigate to **Developer Portal → Rate Limits** to see:
- Hit rate over time (hourly chart)
- Throttle rate by tier
- Top throttled API keys
- Top throttled endpoints
- Guidance on reducing throttling

---

## Best Practices

### Implement exponential back-off

When you receive a `429` response, wait for the number of seconds indicated by `Retry-After` before retrying. Add jitter to avoid synchronized retry storms:

```ts
async function requestWithBackoff(fn: () => Promise<Response>, maxRetries = 5): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fn();
    if (res.status !== 429) return res;

    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
    const jitter = Math.random() * 1000;
    await new Promise(r => setTimeout(r, retryAfter * 1000 + jitter));
  }
  throw new Error('Max retries reached');
}
```

### Cache responses

Reduce request volume by caching API responses client-side. Subscription and plan data rarely changes more than once per minute.

### Use webhooks for event-driven flows

Instead of polling `GET /subscriptions` every few seconds, subscribe to webhook events like `subscription.updated` to receive real-time notifications without consuming rate-limit quota.

### Monitor `X-RateLimit-Remaining`

Log the `X-RateLimit-Remaining` header in your API client. Alert when it drops below 10% to give yourself time to throttle your own consumers before hitting the limit.

### Batch where possible

Use `POST /subscriptions/batch` and similar batch endpoints to reduce the number of individual API calls.

---

## API Reference

### `GET /rate-limits/analytics`

Returns aggregate rate-limiting analytics.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `tier` | string | Filter to a specific tier (`FREE`, `BASIC`, `PREMIUM`, `ENTERPRISE`) |

---

### `GET /rate-limits/status`

Returns the current rate-limit status for one API key.

**Query params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `apiKey` | string | Yes | The API key to inspect |
| `tier` | string | No | Tier to apply (default: `FREE`) |

---

### `POST /rate-limits/bypass`

Add or remove an entry from the bypass list.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"key"` \| `"user"` | Yes | Whether to bypass an API key or a user ID |
| `value` | string | Yes | The API key or user ID |
| `action` | `"add"` \| `"remove"` | Yes | Whether to add or remove the entry |

**Response:**

```json
{
  "bypassKeys": ["sk_internal_abc123"],
  "bypassUsers": ["user_svc_456"]
}
```

---

### `POST /rate-limits/config`

Set custom rate limits for a specific API key.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiKey` | string | Yes | The API key to configure |
| `limits.hourlyLimit` | number | No | Override hourly request limit |
| `limits.dailyLimit` | number | No | Override daily request limit |
| `limits.monthlyLimit` | number | No | Override monthly request limit |
| `limits.burstLimit` | number | No | Override burst token bucket size |
| `limits.concurrentLimit` | number | No | Override max concurrent requests |

---

## FAQ

**Q: What happens when I hit the monthly limit?**  
A: All requests are rejected with a `429` until the monthly window resets (~30 days from the first request of the month). Consider upgrading your tier.

**Q: Do webhooks count against my rate limit?**  
A: No. Inbound webhook callbacks from SubTrackr to your server do not consume your API quota.

**Q: Can I increase limits without upgrading my tier?**  
A: Yes, via custom per-key limits (see [Custom Limits per API Key](#custom-limits-per-api-key)). For sustained high volume, upgrading your tier is the better long-term solution.

**Q: Are rate limits shared between test and production keys?**  
A: No. Sandbox/test keys have separate quota buckets from production keys.

**Q: How do I get real-time rate limit data in my dashboard?**  
A: Read the `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers from every API response, or poll `GET /rate-limits/status?apiKey=<key>` periodically.
