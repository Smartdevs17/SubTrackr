# API Versioning & Deprecation Management

`backend/services/shared/apiVersioning.ts`

---

## Overview

SubTrackr uses a **URL-path-first, header-fallback, query-param-fallback** versioning strategy with a central registry that tracks each version's full lifecycle: `draft → active → deprecated → sunset`.

Deprecated versions continue to serve requests but receive RFC 8594 headers (`Deprecation`, `Sunset`, `Link`, `Warning`) so clients know to upgrade. Sunset versions return `410 Gone` immediately.

---

## Quick start

```ts
import { versionRegistry, createVersionMiddleware } from '../services/shared/apiVersioning';

// Attach to your Node.js HTTP server or Express app
const versionMiddleware = createVersionMiddleware(versionRegistry);

server.on('request', async (req, res) => {
  let handled = false;
  await versionMiddleware(req, res, () => { handled = true; });
  if (!handled) return; // middleware blocked (sunset/unknown)

  // Continue with your route handler — version headers already set
});
```

---

## Version resolution order

For every request the middleware checks in priority order:

1. **URL path** — `/v2/subscriptions` → `v2`
2. **`api-version` header** — `api-version: v2`
3. **`version` query param** — `?version=v2`
4. **Default** — whatever `registry.setDefault()` was called with

---

## Version lifecycle

```
draft ──► active ──► deprecated ──► sunset
                         │               │
                    Warns client     Blocks with
                    (still serves)   410 Gone
```

| State | Request behaviour | Response headers |
|---|---|---|
| `draft` | Pass-through (internal use) | `api-version` only |
| `active` | Pass-through | `api-version` only |
| `deprecated` | Pass-through + warn | `api-version`, `Deprecation`, `Sunset`, `Link`, `Warning` |
| `sunset` | **Blocked — 410 Gone** | `api-version`, `Sunset`, `Link` |

---

## Registry API

### Register a version

```ts
import { ApiVersionRegistry } from '../services/shared/apiVersioning';

const registry = new ApiVersionRegistry();

registry
  .register({
    version: 'v1',
    lifecycle: 'deprecated',
    releasedAt: '2024-01-01T00:00:00Z',
    deprecatedAt: '2025-01-01T00:00:00Z',
    sunsetAt: '2026-06-01T00:00:00Z',
    successorVersion: 'v2',
    migrationUrl: 'https://docs.subtrackr.io/migration/v1-to-v2',
    description: 'Initial release.',
  })
  .register({
    version: 'v2',
    lifecycle: 'active',
    releasedAt: '2025-01-01T00:00:00Z',
    description: 'Current stable version.',
  })
  .setDefault('v2');
```

### Transition a version

```ts
// Deprecate an active version
registry.deprecate('v2', {
  deprecatedAt: '2026-01-01T00:00:00Z',
  sunsetAt: '2027-01-01T00:00:00Z',
  successorVersion: 'v3',
  migrationUrl: 'https://docs.subtrackr.io/migration/v2-to-v3',
});

// Sunset a deprecated version (starts blocking immediately)
registry.sunset('v1');

// Activate a draft version after internal testing
registry.activate('v3');
```

### Query the registry

```ts
registry.getActive()          // VersionConfig[]
registry.getDeprecated()      // VersionConfig[]
registry.getSunset()          // VersionConfig[]
registry.getLatestActive()    // highest-numbered active version
registry.getDeprecationWarning('v1')  // DeprecationWarning | null
```

---

## Deprecation headers (RFC 8594)

When a deprecated version is used, the middleware attaches:

```http
api-version: v1
Deprecation: Wed, 01 Jan 2025 00:00:00 GMT
Sunset: Sun, 01 Jun 2026 00:00:00 GMT
Link: <https://docs.subtrackr.io/migration/v1-to-v2>; rel="successor-version"
Warning: 299 - "API version "v1" is deprecated. This version sunsets in 180 day(s). Upgrade to v2."
```

---

## Sunset response (410 Gone)

```json
{
  "success": false,
  "error": {
    "code": "VERSION_SUNSET",
    "message": "API version \"v1\" has been sunset and is no longer available. Please upgrade to v2. Migration guide: https://docs.subtrackr.io/migration/v1-to-v2"
  }
}
```

---

## Analytics

Track which versions are being used in production:

```ts
const stats = registry.getStats();
// {
//   totalVersions: 2,
//   activeVersions: 1,
//   deprecatedVersions: 1,
//   sunsetVersions: 0,
//   draftVersions: 0,
//   perVersion: [
//     { version: 'v1', requestCount: 1204, deprecatedRequestCount: 1204, lastSeenAt: '...' },
//     { version: 'v2', requestCount: 98321, deprecatedRequestCount: 0, lastSeenAt: '...' },
//   ]
// }

registry.resetAnalytics(); // reset counters (e.g. for test isolation)
```

---

## Custom handlers

Override default 410/400 behaviour:

```ts
const middleware = createVersionMiddleware(registry, {
  onSunset: (version, config) => ({
    statusCode: 410,
    body: JSON.stringify({ message: `${version} is gone. Use ${config.successorVersion}.` }),
    headers: { 'Content-Type': 'application/json' },
  }),
  onUnresolved: (requested) => ({
    statusCode: 400,
    body: JSON.stringify({ message: `Unknown API version: ${requested}` }),
  }),
});
```

---

## Singleton registry

The pre-configured registry (`versionRegistry`) is exported for application-wide use:

```ts
import { versionRegistry } from '../services/shared/apiVersioning';
// v1: deprecated (sunsets 2026-06-01), v2: active (default)
```

---

## Running tests

```bash
npx jest --config jest.backend.config.js \
  backend/services/shared/__tests__/apiVersioning.test.ts
```
