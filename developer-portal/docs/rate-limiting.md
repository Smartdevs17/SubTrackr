# Rate Limiting (Developer Portal)

SubTrackr enforces API rate limits with a **token bucket** algorithm and tier-based quotas (**free** / **pro** / **enterprise**).

## Quick reference

| Tier | Hourly | Daily | Burst | Refill rate |
|------|-------:|------:|------:|------------:|
| Free | 100 | 500 | 20 | 1 token/s |
| Pro | 1,000 | 10,000 | 100 | 5 tokens/s |
| Enterprise | 10,000 | 100,000 | 500 | 20 tokens/s |

Subscription mapping: `free` → free, `basic`/`premium` → pro, `enterprise` → enterprise.

## Response headers

Every non-bypassed response includes:

- `X-RateLimit-Limit` — hourly limit
- `X-RateLimit-Remaining` — remaining hourly quota
- `X-RateLimit-Reset` — Unix timestamp (seconds) when the hourly window resets
- `X-RateLimit-Policy` — e.g. `pro;hourly=1000;daily=10000`
- `Retry-After` — present on `429` responses (seconds)

## 429 Too Many Requests

```json
{
  "status": 429,
  "error": "rate_limit_exceeded",
  "message": "Rate limit exceeded. Retry after 12 seconds.",
  "retryAfter": 12,
  "limit": 100,
  "remaining": 0,
  "resetAt": 1722038400000
}
```

Wait for `Retry-After` (add jitter) before retrying.

## Trusted-client bypass

Internal service accounts can skip rate limiting:

```http
POST /rate-limits/bypass
Content-Type: application/json

{ "type": "key", "value": "sk_internal_...", "action": "add" }
```

Configure the same from **Developer Portal → API Keys → Rate Limits → Bypass**.

## Configuration UI

**Developer Portal → API Keys → Configure → Rate Limits** lets you:

- View live remaining quota (token bucket + windows)
- Override hourly / daily / monthly / burst / concurrent limits per key
- Toggle bypass for trusted keys

## Analytics dashboard

**Developer Portal → Rate Limits** shows:

- Overall hit rate and 429 counts
- Throttle rate by tier
- Top throttled API keys and endpoints

API: `GET /rate-limits/analytics`

## How the token bucket works

1. Each key starts with `burstLimit` tokens.
2. Tokens refill continuously at the tier refill rate (not a fixed window).
3. Each request costs one token.
4. When tokens are exhausted, the API returns `429` until refill catches up.
5. Hourly / daily / monthly counters remain as hard caps above the bucket.

Full reference: [`docs/rate-limiting.md`](../../docs/rate-limiting.md).
