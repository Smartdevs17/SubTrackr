# CORS Policy Management with Dynamic Origin Whitelisting

## Overview

Issue #772 implements dynamic CORS (Cross-Origin Resource Sharing) policy management for SubTrackr, supporting per-tenant origin whitelisting, preflight caching, violation logging, and analytics.

## Architecture

```
backend/services/shared/
├── corsMiddleware.ts    # CORS engine
└── index.ts            # Exports
```

## Features

### 1. Dynamic CORS Management

CORS policies are managed at runtime without server restarts:

```typescript
import { upsertCorsPolicy } from '../shared';

upsertCorsPolicy('tenant-123', {
  allowedOrigins: [
    { origin: 'https://app.example.com', isWildcard: false },
    { origin: '*.dev.example.com', isWildcard: true },
  ],
  allowCredentials: true,
  exposedHeaders: ['X-Request-ID'],
  maxAge: 86400,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
  active: true,
});
```

### 2. Per-Tenant Whitelisting

Each tenant can have its own CORS policy:

```typescript
import { getCorsPolicy, testCorsOrigin } from '../shared';

// Test if an origin is allowed
const result = testCorsOrigin('https://app.example.com', 'tenant-123');
// { allowed: true, policyId: 'cors-tenant-123-...', matchedPattern: 'https://app.example.com' }
```

### 3. Wildcard Patterns

Supports wildcard patterns for subdomain matching:

```typescript
upsertCorsPolicy('tenant-123', {
  allowedOrigins: [
    { origin: '*.example.com', isWildcard: true },  // matches any subdomain
    { origin: 'https://*.dev.example.com', isWildcard: true },
  ],
  // ...
});
```

### 4. Preflight Caching

Preflight responses are cached to reduce latency:

```typescript
import { processCorsRequest, clearPreflightCache } from '../shared';

// Handles preflight caching automatically
const { headers, allowed } = processCorsRequest({
  origin: 'https://app.example.com',
  method: 'OPTIONS',
  tenantId: 'tenant-123',
});
```

### 5. CORS Violation Logging

All CORS violations are recorded for security monitoring:

```typescript
import { getCorsViolations } from '../shared';

// Get recent violations for a tenant
const violations = getCorsViolations({
  tenantId: 'tenant-123',
  since: '2026-01-01T00:00:00Z',
  limit: 50,
});
```

### 6. CORS Analytics

Track CORS usage and violations:

```typescript
import { getCorsAnalytics } from '../shared';

const analytics = getCorsAnalytics();
// {
//   totalRequests: 15000,
//   allowedRequests: 14500,
//   blockedRequests: 500,
//   uniqueOrigins: 25,
//   violationsByOrigin: { 'https://evil.com': 500 },
//   violationsByTenant: { 'tenant-123': 300 },
//   preflightCacheHitRate: 0.85,
// }
```

### 7. Express-style Middleware

```typescript
import { createCorsMiddleware } from '../shared';

// Apply CORS middleware to all routes
app.use(createCorsMiddleware('default-tenant'));

// Or with per-route tenant
app.use('/api/v1', (req, res, next) => {
  req.tenantId = req.headers['x-tenant-id'];
  createCorsMiddleware()(req, res, next);
});
```

## API Reference

### Policy Management

| Function | Description |
|----------|-------------|
| `upsertCorsPolicy(tenantId, config)` | Create or update a policy |
| `getCorsPolicy(tenantId)` | Get policy for a tenant |
| `getAllCorsPolicies()` | List all policies |
| `deleteCorsPolicy(tenantId)` | Delete a tenant's policy |

### Request Processing

| Function | Description |
|----------|-------------|
| `processCorsRequest(options)` | Process CORS request and return headers |
| `testCorsOrigin(origin, tenantId?)` | Test if an origin is allowed |
| `createCorsMiddleware(tenantId?)` | Create Express-style middleware |

### Monitoring

| Function | Description |
|----------|-------------|
| `getCorsAnalytics()` | Get CORS analytics snapshot |
| `getCorsViolations(options)` | Get recent violations |
| `clearPreflightCache()` | Clear preflight response cache |

## Request Flow

```
Client Request
    │
    ▼
┌─────────────────┐
│ CORS Middleware  │
└─────────────────┘
    │
    ├─ Preflight (OPTIONS)
    │   │
    │   ▼
    │ ┌───────────────┐
    │ │ Check Cache    │
    │ └───────────────┘
    │   │
    │   ├─ Cache Hit → Return cached headers
    │   │
    │   └─ Cache Miss
    │       │
    │       ▼
    │     ┌─────────────────┐
    │     │ Find Policy     │
    │     └─────────────────┘
    │       │
    │       ├─ Policy Found → Build headers, cache, return
    │       │
    │       └─ No Policy → Return empty headers (blocked)
    │
    └─ Simple Request
        │
        ▼
      ┌─────────────────┐
      │ Find Policy     │
      └─────────────────┘
        │
        ├─ Policy Found → Apply headers, continue
        │
        └─ No Policy → Record violation, block
```

## Error Response

Blocked requests receive an empty CORS headers set, which causes the browser to block the response. Violations are logged for monitoring:

```json
{
  "requestId": "req-1703980800000",
  "origin": "https://evil.com",
  "method": "GET",
  "tenantId": "tenant-123",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "path": "/api/v1/subscriptions",
  "reason": "Origin not in allowlist"
}
```

## Security Considerations

1. **No `Access-Control-Allow-Origin: *`**: The middleware never uses the wildcard header; it always echoes the specific origin
2. **Credentials**: `Access-Control-Allow-Credentials: true` is only set when explicitly configured
3. **Preflight Validation**: All OPTIONS requests are validated against the policy
4. **Violation Logging**: All blocked attempts are recorded for security analysis
5. **Cache Invalidation**: Policies changes immediately affect new requests
