# Sessions, Refresh-Token Rotation and Password Fallback

Issues #1776 (refresh-token rotation), #1777 (session listing and remote revocation) and #1778 (password fallback for passkey login).

All sign-in methods (passkey, password and the [OAuth device flow](./oauth-device-flow.md)) issue sessions through one service, so rotation, listing and revocation behave the same whichever method was used.

---

## Table of Contents

- [Model](#model)
- [Tokens](#tokens)
- [Refresh-Token Rotation and Reuse Detection](#refresh-token-rotation-and-reuse-detection)
- [Sessions: Listing and Revocation](#sessions-listing-and-revocation)
- [Password Fallback](#password-fallback)
- [Scopes](#scopes)
- [API Reference](#api-reference)
- [Error Codes](#error-codes)
- [Configuration](#configuration)
- [Testing](#testing)

---

## Model

```
                ┌──────────────── session (ServerSessionService) ───────────────┐
 sign-in ──►    │ id: sess_…  userId  device  geo  scopes  metadata.authMethod │
 (passkey,      │ token = access token (opaque, 30 min sliding TTL)             │
  password,     └──────────────────────────────┬────────────────────────────────┘
  device flow)                                 │ 1 : 1
                ┌──────────────── refresh-token family (SessionTokenService) ───┐
                │ currentTokenHash  generation  expiresAt  absoluteExpiresAt    │
                │ hashes of every token already rotated away                    │
                └───────────────────────────────────────────────────────────────┘
```

| Component | File | Role |
|-----------|------|------|
| `ServerSessionService` | `backend/services/auth/serverSessionService.ts` | Session records, device binding, access-token validation. Now carries `scopes`, can rotate a session's access token, and notifies listeners on every revocation |
| `SessionTokenService` | `backend/services/auth/domain/SessionTokenService.ts` | Issues session + refresh-token family, rotates on refresh, detects reuse, lists and revokes sessions |
| `PasswordCredentialService` | `backend/services/auth/domain/PasswordCredentialService.ts` | Password hashes, verification, lockout |
| `createRequireAuth` | `backend/services/auth/middleware/sessionAuth.ts` | Bearer / `X-Session-Token` authentication with scope enforcement |
| `createSessionRouter` | `backend/services/auth/router/sessionRouter.ts` | Routes, mounted at `/api/v1/auth` |

## Tokens

| Token | Format | Lifetime | Stored as |
|-------|--------|----------|-----------|
| Access token | 64 hex chars | 30 min, sliding on use | Session record key (unchanged from #1160) |
| Refresh token | `rt_` + 43 base64url chars (256 bits) | 7 days idle, 30 days absolute | SHA-256 digest only |

Interactive sign-ins return the tokens in headers, keeping them out of response bodies (the same convention as `POST /sessions`):

```
X-Session-Token: <access token>
X-Refresh-Token: <refresh token>
Cache-Control: no-store
```

The access token is sent as `Authorization: Bearer <token>` or `X-Session-Token: <token>`.

## Refresh-Token Rotation and Reuse Detection

`POST /api/v1/auth/oauth/token` with `grant_type=refresh_token` (form-encoded or JSON):

```bash
curl -X POST https://api.subtrackr.app/api/v1/auth/oauth/token \
  -d grant_type=refresh_token -d refresh_token=rt_…
```

```json
{
  "access_token": "9f2c…",
  "token_type": "Bearer",
  "expires_in": 1800,
  "refresh_token": "rt_…",
  "scope": "*"
}
```

- **Rotation on use.** Each successful refresh returns a new refresh token *and* a new access token. Both previous tokens stop working at once. The session keeps its `id`, so it shows up as the same entry in the session list.
- **Reuse detection.** The family remembers the digest of every refresh token it has issued. If a token that was already rotated away is presented again, either the client or an attacker holds a stolen copy, and the server cannot tell which. So the whole family is revoked: the session, its current access token and its current refresh token. The request gets `400 invalid_grant`, an audit entry is written, and an `auth.refresh_token_reuse_detected` event is published. (OAuth 2.0 Security BCP, RFC 9700 §4.14.2.)
- **Device binding.** A refresh from a device whose fingerprint differs from the session's is refused without rotating, so the legitimate device's token keeps working (#1766).
- **Revival.** A session whose access token idled out can be resumed with its refresh token until the refresh token itself expires. A revoked session can never be resumed.

> **Clients:** refresh is strictly single-use. Run at most one refresh at a time per session (serialise or de-duplicate concurrent refreshes). Two parallel refreshes with the same token would look like reuse and sign the user out.

## Sessions: Listing and Revocation

`GET /api/v1/auth/sessions` returns the caller's sessions that can still be used: the access token is live, or the refresh token can still mint a new one. Revoked sessions, and sessions whose access and refresh tokens have both lapsed, are excluded. The list never contains token material.

```json
{
  "success": true,
  "data": [
    {
      "id": "sess_3fa1c0d29b7e",
      "current": true,
      "authMethod": "passkey",
      "clientId": null,
      "scopes": ["*"],
      "device": { "platform": "web", "browser": "Chrome", "os": "macOS", "isMobile": false },
      "location": { "country": "NG", "region": null, "city": "Lagos" },
      "createdAt": 1760000000000,
      "lastActiveAt": 1760000300000,
      "accessTokenExpiresAt": 1760002100000,
      "refreshTokenExpiresAt": 1760605100000,
      "isSuspicious": false
    }
  ]
}
```

Revocation takes effect immediately. The session is marked revoked and its refresh-token family is revoked in the same call, so the revoked device's next request is rejected with `401`, and its next refresh with `invalid_grant`. This holds for every revocation path: `DELETE /sessions/:id`, `POST /sessions/revoke-others`, `POST /logout`, the legacy `/sessions/revoke*` routes in `backend/server.ts`, and concurrent-session eviction. All of them go through `ServerSessionService.revokeSession`, which notifies the token service.

Users can only revoke their own sessions. Another user's session id returns `404 AUTH_SESSION_NOT_FOUND`, the same as an unknown id.

## Password Fallback

Passkeys stay the primary sign-in method. A password is the fallback for devices without an authenticator, a dismissed WebAuthn prompt, or a lost passkey (see [passkeys.md](./passkeys.md#fallback-to-password)).

- `PUT /api/v1/auth/password` `{ newPassword, currentPassword? }` sets the password for the signed-in user (requires `auth:manage`). Changing an existing password requires `currentPassword`.
- `POST /api/v1/auth/login/password` `{ userId, password }` signs in and returns the same headers and body as a passkey login.
- Passwords are hashed with the repo's Argon2id-style KDF (`argon2Kdf.ts`) and compared in constant time. Policy: 12–256 characters.
- An unknown user and a wrong password give the identical `401 AUTH_INVALID_CREDENTIALS`, and unknown users are checked against a dummy hash so timing does not reveal which accounts exist.
- 5 failures within 15 minutes lock the account for 15 minutes (`429 AUTH_ACCOUNT_LOCKED` with `Retry-After`). While the lock is active, the correct password is refused too.

## Scopes

Sessions carry `scopes`. Interactive sign-ins get `["*"]`. Device-flow sessions get only the scopes the user approved, and keep them across refreshes. Routes declare the scope they need, and a token without it receives `403 AUTH_INSUFFICIENT_SCOPE` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="…"` (RFC 6750 §3.1).

| Scope | Grants |
|-------|--------|
| `sessions:read` | `GET /sessions` |
| `sessions:write` | `DELETE /sessions/:id`, `POST /sessions/revoke-others` |
| `auth:manage` | Passkey management, `PUT /password`, approving device sign-ins. Never grantable through the device flow |
| `profile:read`, `subscriptions:read`, `subscriptions:write` | Reserved for resource routes; use `createRequireAuth({ scope })` to enforce them |

Scope matching uses `hasScope` from `ApiKeyRotationService` (`*` and `prefix:*` wildcards are supported).

## API Reference

All routes are under `/api/v1/auth`.

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| `POST` | `/login/password` | — (CSRF) | `{ userId, password }` | Password sign-in; tokens in headers |
| `PUT` | `/password` | `auth:manage` | `{ newPassword, currentPassword? }` | Set or change password |
| `POST` | `/oauth/token` | — | `grant_type=refresh_token&refresh_token=…` | Rotate tokens (also serves the device flow) |
| `GET` | `/sessions` | `sessions:read` | — | List live sessions |
| `DELETE` | `/sessions/:sessionId` | `sessions:write` | — | Revoke one session |
| `POST` | `/sessions/revoke-others` | `sessions:write` | — | Revoke all other sessions |
| `POST` | `/logout` | any session | — | Revoke the calling session |

`/oauth/token` and `/oauth/device_authorization` are exempt from the double-submit CSRF check. They are called by non-browser clients and carry no ambient credentials, because the refresh token or device code travels in the body. All other state-changing routes keep the CSRF check (`GET /api/v1/csrf-token` bootstraps the token).

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `UNAUTHORIZED` | 401 | Missing, invalid, expired or revoked access token |
| `AUTH_INSUFFICIENT_SCOPE` | 403 | Token valid but lacks the route's scope |
| `AUTH_SESSION_NOT_FOUND` | 404 | No such session for the caller |
| `AUTH_INVALID_CREDENTIALS` | 401 | Unknown user or wrong password |
| `AUTH_ACCOUNT_LOCKED` | 429 | Too many failed password attempts |
| `AUTH_PASSWORD_POLICY_VIOLATION` | 422 | New password too short/long |
| `invalid_grant` (OAuth) | 400 | Refresh token unknown, expired, revoked or reused |

## Configuration

| Setting | Default | Where |
|---------|---------|-------|
| Access-token TTL | 30 min sliding | `ServerSessionService` `defaultTtlMs` / `slidingTtlMs` |
| Refresh-token idle TTL | 7 days | `SessionTokenService` `config.idleTtlMs` |
| Refresh-token absolute TTL | 30 days | `SessionTokenService` `config.absoluteTtlMs` |
| Password lockout | 5 failures / 15 min → 15 min lock | `PasswordCredentialService` config |
| Password KDF cost | `{ memoryCost: 1024, timeCost: 1, parallelism: 4 }` (~64 MiB, ~200 ms) | `DEFAULT_PASSWORD_POLICY.kdfParams` |

Like the rest of the auth module, these stores are in memory. Families past their absolute lifetime are swept by the 5-minute session sweep in `backend/server.ts`.

## Testing

```bash
npx jest --config jest.backend.config.js backend/services/auth
```

- `SessionTokenService.test.ts`: rotation, revival, device binding, reuse detection (family plus session revoked, event published), expiry, revocation through every path, listing accuracy, sweep.
- `PasswordCredentialService.test.ts`: hashing, policy, change-requires-current, identical errors, lockout window.
- `sessionRouter.test.ts`: a real Express server. Covers passkey failure → password fallback, passkey login → refresh, rotation and reuse over HTTP, list → remote revoke → next request 401, cross-user revocation, and the device flow with scope enforcement.
