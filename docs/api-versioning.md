# API Versioning & Deprecation Management

`backend/services/shared/apiVersioning.ts`

---

## Overview

SubTrackr uses a **URL-path-first, header-fallback, query-param-fallback** versioning strategy with a central registry that tracks each version's full lifecycle: `draft → active → deprecated → sunset`.

Deprecated versions continue to serve requests but receive RFC 8594 headers (`Deprecation`, `Sunset`, `Link`, `Warning`) so clients know to upgrade. Sunset versions return `410 Gone` immediately.

---

## Current state

| Version | Lifecycle | Served at |
|---|---|---|
| `v1` | active (default) | every route in `backend/server.ts` and `/api/v1/*` in `backend/server/createApiServer.ts` |

Both servers run `createVersionMiddleware(versionRegistry)` on every request.
Responses carry `api-version: v1` (the Express app also keeps the older
`X-API-Version: 1`). A request that names a version the registry does not know,
for example `api-version: v9` or `/v9/plans`, is rejected with
`400 VERSION_NOT_FOUND` instead of being served as v1.

## Strategy

- **Major versions only.** A new version (`v2`, `v3`, …) is created only for a
  breaking change: removing or renaming a field, endpoint or enum value,
  changing a type or a default, or making an optional input required.
- **Additive changes stay in the current version.** New endpoints, new optional
  fields and new enum values for output are not breaking. Clients must ignore
  unknown response fields.
- **One codebase.** Old and new versions are served side by side; handlers
  branch on the resolved version instead of forking the code.
- **New versions start as `draft`**, are exercised internally, then
  `registry.activate()` makes them public and, once stable, `setDefault()`
  moves unversioned requests over.

## Deprecation policy

1. A version can be deprecated only after its successor is `active`.
2. Deprecation is announced in `CHANGELOG.md` and the developer portal with the
   sunset date and a migration guide (`migrationUrl`).
3. From the deprecation date every response on that version carries
   `Deprecation`, `Sunset`, `Link: <…>; rel="successor-version"` and `Warning`
   headers.
4. The sunset date is at least **6 months** after the deprecation date.
5. Usage is watched through `registry.getStats()` and the deprecation report
   (`backend/services/shared/apiDeprecationReport.ts`); remaining heavy users
   are contacted before sunset.
6. On the sunset date `registry.sunset()` is called and the version answers
   `410 Gone` with `VERSION_SUNSET`.

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

If any of steps 1 to 3 names a version that is not registered, resolution stops
and the middleware answers `400 VERSION_NOT_FOUND`. The default only applies
when the request does not name a version at all.

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
// v1: active (default)
```

Register the next version here as `draft` when its first breaking change lands.

---

## Running tests

```bash
npx jest --config jest.backend.config.js \
  backend/services/shared/__tests__/apiVersioning.test.ts
```
