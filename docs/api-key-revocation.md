# API Key Revocation & Leak Detection

SubTrackr can revoke merchant API keys instantly and detects exposed or abused keys automatically. Leaked keys are revoked (or flagged for review) before they can be used against a merchant account, and every action is recorded in an audit trail.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Revocation](#revocation)
3. [Leak Detection](#leak-detection)
4. [Incident Lifecycle](#incident-lifecycle)
5. [Policy](#policy)
6. [Request Middleware](#request-middleware)
7. [Events & Audit Trail](#events--audit-trail)
8. [API Reference](#api-reference)
9. [Error Codes](#error-codes)

---

## Architecture

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `ApiKeyRotationService` | `backend/services/auth/domain/ApiKeyRotationService.ts` | Key storage (SHA-256 hashes only), rotation, `revokeKey`, hash lookups |
| `ApiKeyRevocationService` | `backend/services/auth/domain/ApiKeyRevocationService.ts` | Revocation, leak scanning, breach-feed matching, usage anomaly detection, incidents, policy, audit |
| `ApiKeyRevocationController` | `backend/services/auth/controller/apiKeyRevocationController.ts` | `ApiResponse` envelopes and input validation |
| `createApiKeyRevocationRouter` | `backend/services/auth/router/authRouter.ts` | Express routes mounted at `/api/v1/api-keys` |
| `createApiKeyUsageMiddleware` | `backend/services/auth/middleware/apiKeyUsageMiddleware.ts` | Authenticates `X-Api-Key` and feeds usage into anomaly detection |

The revocation routes are operator/admin endpoints. Mount them behind your admin authentication middleware (for example via the `beforeCache` option of `createApiServer`).

---

## Revocation

- `revokeKey(keyId, { reason, actorId })` — immediate, no grace period and no replacement key (use rotation when a replacement is needed). Subsequent `validateKey()` calls throw `AUTH_API_KEY_REVOKED`.
- `revokeAllForMerchant(merchantId, { reason, actorId })` — revoke every non-revoked key of a merchant (account compromise, offboarding).

Revoking a key closes all of its open leak incidents.

---

## Leak Detection

Keys are never stored in plain text, so detection works by hashing candidates and matching them against stored hashes.

| Method | Trigger | Default action |
|--------|---------|----------------|
| `pattern_scan` | `scanForLeaks(content, source)` finds strings matching `sk_…` / `sk_live_…` / `sk_test_…` whose SHA-256 matches a live key (commits, CI logs, pastes, support tickets, webhooks from secret-scanning partners) | **Auto-revoke** |
| `hash_match` | `checkLeakedHashes(hashes, source)` receives SHA-256 digests from a breach feed that does not share raw secrets | **Auto-revoke** |
| `manual_report` | `reportLeak(keyId, { source, actorId })` — a merchant or operator reports a key as exposed | **Auto-revoke** |
| `usage_anomaly` | `recordUsage()` sees more distinct client IPs or more requests inside the sliding window than the policy allows | **Flag for review** |

Incidents only store a redacted fingerprint of the key (`sk_live_…abcd`), never the secret itself. Repeated detections of the same key and method do not create duplicate open incidents; already revoked keys are ignored.

---

## Incident Lifecycle

```
            ┌──────────── auto-revoke policy ────────────► auto_revoked
detected ──►│
            └──► open ──► confirmIncident()  ─────────────► revoked
                     └──► dismissIncident() (false positive) ► dismissed
```

Manually revoking a key also moves its open incidents to `revoked`.

---

## Policy

Policies are per merchant with a `default` fallback.

| Field | Default | Description |
|-------|---------|-------------|
| `autoRevokeOnExposure` | `true` | Revoke immediately on `pattern_scan`, `hash_match` and `manual_report` detections |
| `autoRevokeOnAnomaly` | `false` | Revoke immediately on usage anomalies (otherwise flag) |
| `anomalyWindowMs` | `3600000` | Sliding window for usage tracking |
| `maxDistinctIps` | `10` | Distinct client IPs allowed per key inside the window |
| `maxRequestsPerWindow` | `10000` | Requests allowed per key inside the window |

Numeric fields must be positive; boolean fields must be booleans; unknown fields are ignored.

---

## Request Middleware

```ts
import { createApiKeyUsageMiddleware } from './services/auth/middleware/apiKeyUsageMiddleware';

router.use(createApiKeyUsageMiddleware());
```

The middleware rejects missing, unknown, expired and revoked keys (`401`), records each accepted request with the client IP for anomaly detection, and rejects the triggering request when the anomaly policy auto-revokes the key. The authenticated key is exposed as `res.locals.apiKey = { keyId, merchantId }`.

---

## Events & Audit Trail

Domain events are published on the shared event bus:

| Event | Payload |
|-------|---------|
| `auth.api_key_revoked` | `keyId`, `merchantId`, `reason`, `revokedBy`, `revokedAt` |
| `auth.api_key_leak_detected` | `incidentId`, `keyId`, `merchantId`, `method`, `source`, `autoRevoked`, `detectedAt` |

Event publishing failures are logged and never block a revocation.

The audit trail (`getAuditLog({ merchantId?, keyId?, limit? })`, newest first) records `revoked`, `leak_detected`, `anomaly_flagged` and `incident_dismissed` entries with the actor (`system:leak-detector` for automatic actions), reason and related incident.

---

## API Reference

All routes are mounted at `/api/v1/api-keys` and return the standard `ApiResponse` envelope.

| Method | Path | Body / Query | Description |
|--------|------|--------------|-------------|
| `POST` | `/:keyId/revoke` | `{ actorId, reason? }` | Revoke a key |
| `POST` | `/:keyId/report-leak` | `{ actorId, source? }` | Report a key as exposed |
| `POST` | `/merchants/:merchantId/revoke-all` | `{ actorId, reason? }` | Revoke all keys of a merchant |
| `POST` | `/leaks/scan` | `{ content?, hashes?, source? }` | Scan text and/or SHA-256 digests for exposed keys |
| `GET` | `/leaks/incidents` | `?merchantId&keyId&status` | List incidents |
| `POST` | `/leaks/incidents/:incidentId/confirm` | `{ actorId }` | Confirm and revoke |
| `POST` | `/leaks/incidents/:incidentId/dismiss` | `{ actorId, reason? }` | Dismiss as false positive |
| `GET` | `/leaks/policy/:merchantId` | — | Read leak detection policy |
| `PATCH` | `/leaks/policy/:merchantId` | partial policy | Update leak detection policy |
| `GET` | `/revocations/audit` | `?merchantId&keyId&limit` | Audit trail |

Example — scan a CI log:

```bash
curl -X POST https://api.subtrackr.app/api/v1/api-keys/leaks/scan \
  -H 'Content-Type: application/json' \
  -d '{"content": "<log output>", "source": "github-actions:acme/app#1234"}'
```

```json
{
  "success": true,
  "data": {
    "scannedCandidates": 1,
    "incidents": [
      {
        "id": "leak_m1x2y3_ab12cd34ef56",
        "keyId": "key_4f2a9c1e7b3d5a60",
        "merchantId": "merchant_42",
        "method": "pattern_scan",
        "severity": "critical",
        "status": "auto_revoked",
        "source": "github-actions:acme/app#1234",
        "redactedKey": "sk_Zx9Q…Pq3w"
      }
    ]
  }
}
```

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `AUTH_API_KEY_NOT_FOUND` | 404 | Unknown key ID |
| `AUTH_API_KEY_REVOKED` | 401 | Key has been revoked |
| `AUTH_API_KEY_ALREADY_REVOKED` | 409 | Revocation or leak report on a key that is already revoked |
| `AUTH_LEAK_INCIDENT_NOT_FOUND` | 404 | Unknown incident ID |
| `AUTH_LEAK_INCIDENT_CLOSED` | 409 | Incident is no longer open |
| `VALIDATION_ERROR` | 422 | Missing `actorId`, invalid scan payload or invalid policy values |
