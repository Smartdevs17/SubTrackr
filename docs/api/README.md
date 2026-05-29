# SubTrackr API Documentation

**Current stable version: v1**

---

## Quick links

| Resource | Description |
|----------|-------------|
| [OpenAPI Spec](./openapi.yaml) | Machine-readable OpenAPI 3.0.3 specification |
| [Interactive Explorer](./swagger.html) | Swagger UI — try every endpoint in-browser |
| [Webhook Reference](./webhooks.md) | All event types, payloads, and retry policy |
| [JS/TS SDK](./sdk/javascript.md) | JavaScript and TypeScript examples |
| [Python SDK](./sdk/python.md) | Python examples |
| [Go SDK](./sdk/go.md) | Go examples |
| [Getting Started](./guides/getting-started.md) | First integration in 7 steps |
| [SaaS Integration](./guides/saas-integration.md) | Feature gating, dunning, upgrade flows |
| [Theme Integration](./guides/theme-integration.md) | White-label brand theming |

---

## API versioning

| Version | Status | End-of-life |
|---------|--------|-------------|
| `v1` | **Stable** — current | — |
| `v0` | Deprecated | 2025-06-01 |

Breaking changes are introduced under a new major version with a minimum
6-month deprecation window. Non-breaking additions (new optional fields, new
endpoints) may be added to `v1` at any time.

Specify the version in the path:

```
https://api.subtrackr.io/v1/subscriptions
```

---

## Authentication

All endpoints require a Bearer token:

```
Authorization: Bearer <your-api-key>
```

API keys are scoped to a merchant and can be rotated from **Settings → API Keys**.

---

## Rate limits

| Scope | Limit |
|-------|-------|
| Default per key | 60 requests / minute |
| Burst | 10 requests / second |
| Webhook delivery | 3 concurrent per endpoint |

Rate-limit headers are returned on every response:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset` (Unix timestamp)

---

## Environments

| Environment | Base URL | Purpose |
|-------------|----------|---------|
| Production | `https://api.subtrackr.io/v1` | Live traffic |
| Sandbox | `https://sandbox.subtrackr.io/v1` | Testing — no real charges |

Sandbox API keys are prefixed with `sk_test_`.

---

## Support

- API issues: [GitHub Issues](https://github.com/Smartdevs17/SubTrackr/issues)
- Email: api@subtrackr.io
