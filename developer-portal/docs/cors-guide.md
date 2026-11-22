# CORS Policy Management

## Overview

SubTrackr supports dynamic CORS (Cross-Origin Resource Sharing) policy management for multi-tenant deployments. This allows each tenant to configure their own allowed origins without server restarts.

## Quick Start

### Configure CORS for Your Tenant

```bash
curl -X POST https://api.subtrackr.com/v1/cors/policies \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "your-tenant-id",
    "allowedOrigins": [
      "https://app.yourdomain.com",
      "*.dev.yourdomain.com"
    ],
    "allowCredentials": true,
    "maxAge": 86400
  }'
```

### Test an Origin

```bash
curl -X GET "https://api.subtrackr.com/v1/cors/test?origin=https://app.yourdomain.com&tenantId=your-tenant-id" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowedOrigins` | string[] | required | List of allowed origins (supports wildcards) |
| `allowCredentials` | boolean | false | Include Access-Control-Allow-Credentials header |
| `exposedHeaders` | string[] | [] | Headers to expose to the browser |
| `maxAge` | number | 86400 | Preflight cache duration in seconds |
| `allowMethods` | string[] | [GET,POST,PUT,PATCH,DELETE] | Allowed HTTP methods |
| `allowHeaders` | string[] | [Content-Type,Authorization] | Allowed request headers |

## Wildcard Patterns

Use `*` for subdomain matching:

| Pattern | Matches |
|---------|---------|
| `*.example.com` | `app.example.com`, `api.example.com` |
| `https://*.dev.example.com` | `https://staging.dev.example.com` |
| `*.app.example.com` | `staging.app.example.com` |

## JavaScript SDK

```typescript
import { SubTrackr } from '@subtrackr/sdk';

const client = new SubTrackr({
  apiKey: 'YOUR_API_KEY',
  tenantId: 'your-tenant-id',
});

// Configure CORS
await client.cors.updatePolicy({
  allowedOrigins: ['https://app.example.com'],
  allowCredentials: true,
});

// Test an origin
const result = await client.cors.testOrigin('https://app.example.com');
// { allowed: true, matchedPattern: 'https://app.example.com' }
```

## Error Handling

Blocked requests receive empty CORS headers, which causes the browser to block the response. Monitor violations via the analytics endpoint:

```typescript
const analytics = await client.cors.getAnalytics();
console.log(`Blocked requests: ${analytics.blockedRequests}`);
```

## Security Best Practices

1. **Be Specific**: Use exact origins instead of wildcards when possible
2. **No Credentials with Wildcards**: Don't combine `allowCredentials: true` with `*`
3. **Monitor Violations**: Regularly check CORS analytics for suspicious activity
4. **Limit Methods**: Only allow methods your API actually uses
5. **HTTPS Only**: Always use HTTPS origins in production
