# OAuth Device Authorization Flow (RFC 8628)

Issue #1779. Lets the SubTrackr CLI and other input-constrained devices (TVs, kiosks, headless scripts) sign a user in without typing a password on the device. The user approves the request on a phone or laptop where they are already signed in.

The issued session is a normal SubTrackr session (see [sessions-and-tokens.md](./sessions-and-tokens.md)). It has a rotating refresh token, appears in the user's session list, and can be revoked remotely. It is limited to the scopes the user approved.

---

## Flow

```
Device (CLI)                         SubTrackr API                       User's browser / app
    │ POST /oauth/device_authorization ──►                                       │
    │   client_id, scope                  │ device_code, user_code,              │
    │ ◄───────────────────────────────────│ verification_uri, expires_in, interval
    │                                                                            │
    │ show: "Open https://app.subtrackr.app/device and enter BDWX-KTPQ"          │
    │                                                                            │
    │ POST /oauth/token (device_code) ──► │ 400 authorization_pending            │
    │   … every `interval` seconds …      │                                      │
    │                                     │ ◄── GET /oauth/device?user_code=…    │ (signed in)
    │                                     │ ──► client name + requested scopes   │
    │                                     │ ◄── POST /oauth/device/approve       │
    │ POST /oauth/token (device_code) ──► │                                      │
    │ ◄── 200 access_token, refresh_token, scope                                 │
```

## Endpoints

All under `/api/v1/auth`. The device-facing endpoints accept `application/x-www-form-urlencoded` (as RFC 8628 requires) and JSON. They are exempt from the CSRF check because they carry no cookies. The approval endpoints are used by a signed-in browser or app, so they require CSRF and a session holding `auth:manage`.

### 1. Device authorization request (device)

```bash
curl -X POST https://api.subtrackr.app/api/v1/auth/oauth/device_authorization \
  -d client_id=subtrackr-cli \
  -d 'scope=subscriptions:read sessions:read'
```

```json
{
  "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS",
  "user_code": "BDWX-KTPQ",
  "verification_uri": "https://app.subtrackr.app/device",
  "verification_uri_complete": "https://app.subtrackr.app/device?user_code=BDWX-KTPQ",
  "expires_in": 600,
  "interval": 5
}
```

`scope` is space-delimited. If you omit it, the client's default scopes are used. Each scope must be registered for the client (`400 invalid_scope` otherwise). An unknown `client_id` gets `401 invalid_client`.

### 2. User approval (signed-in user)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/oauth/device?user_code=BDWX-KTPQ` | — | Client name, requested scopes and expiry, for the consent screen. Does not consume the code |
| `POST` | `/oauth/device/approve` | `{ user_code, scope? }` | Approve. `scope` optionally narrows the request (it can never widen it) |
| `POST` | `/oauth/device/deny` | `{ user_code }` | Deny |

User codes are case-insensitive, and the dash and spaces are optional. Each code is single-use: the first approve or deny consumes it. The approver can only grant scopes their own session holds.

### 3. Token polling (device)

```bash
curl -X POST https://api.subtrackr.app/api/v1/auth/oauth/token \
  -d grant_type=urn:ietf:params:oauth:grant-type:device_code \
  -d device_code=GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS \
  -d client_id=subtrackr-cli
```

| Response | Meaning | What the device should do |
|----------|---------|---------------------------|
| `400 {"error":"authorization_pending"}` | User has not decided yet | Wait `interval` seconds, poll again |
| `400 {"error":"slow_down"}` | Polled faster than `interval` | Add 5 s to the interval (the server already did), keep polling |
| `400 {"error":"access_denied"}` | User denied | Stop |
| `400 {"error":"expired_token"}` | Codes expired (10 min) | Start over at step 1 |
| `400 {"error":"invalid_grant"}` | Unknown device code, another client's code, or already redeemed | Stop |
| `200` | Approved | Store the tokens |

```json
{
  "access_token": "9f2c…",
  "token_type": "Bearer",
  "expires_in": 1800,
  "refresh_token": "rt_…",
  "scope": "sessions:read"
}
```

Use the access token as `Authorization: Bearer …`. Refresh it with `grant_type=refresh_token` on the same endpoint. The refresh token rotates on every use and the scopes stay the same ([details](./sessions-and-tokens.md#refresh-token-rotation-and-reuse-detection)).

## Scopes Are Enforced

- The token can only do what was approved. A device token with `sessions:read` can list sessions but gets `403 AUTH_INSUFFICIENT_SCOPE` on `DELETE /sessions/:id` (`sessions:write`).
- `*` and `auth:manage` can never be granted through the device flow, even if a client is misconfigured to allow them. A device therefore cannot manage passkeys, change the password, or approve *other* device sign-ins.
- The user sees the session in `GET /sessions` (`authMethod: "device_code"`, `clientId`, `scopes`) and can revoke it at any time.

## Security

- `device_code` (256 bits) and `user_code` are stored only as HMAC-SHA256 digests under a per-process key.
- User codes are 8 characters from `BCDFGHJKLMNPQRSTVWXZ` (no vowels, no look-alikes; about 2.5 × 10¹⁰ combinations) and expire after 10 minutes.
- 10 wrong user codes within 15 minutes from one approver return `429 AUTH_USER_CODE_ATTEMPTS_EXCEEDED`.
- Device codes are single-use. Polling faster than `interval` widens the interval by 5 s (RFC 8628 §3.5).
- Token responses carry `Cache-Control: no-store`.

## Configuration

| Env var | Default | Meaning |
|---------|---------|---------|
| `DEVICE_FLOW_VERIFICATION_URI` | `http://localhost:8081/device` | Page where users enter the code |
| `DEVICE_FLOW_CLIENTS` | `subtrackr-cli` (see below) | JSON map of `client_id` → `{ name, allowedScopes, defaultScopes? }` |

Default client:

```json
{
  "subtrackr-cli": {
    "name": "SubTrackr CLI",
    "allowedScopes": ["profile:read", "subscriptions:read", "subscriptions:write", "sessions:read"],
    "defaultScopes": ["profile:read", "subscriptions:read"]
  }
}
```

Code TTL (10 min), polling interval (5 s) and code length (8) are `DeviceFlowConfig` options on `DeviceAuthorizationService`.

## Testing

```bash
npx jest --config jest.backend.config.js backend/services/auth/__tests__/DeviceAuthorizationService.test.ts \
  backend/services/auth/__tests__/sessionRouter.test.ts
```

The HTTP suite runs the flow end to end against a real Express server: authorization request, `authorization_pending`, `slow_down`, review, narrowed approval, token issuance, single-use device code, scope enforcement (`403` on routes outside the grant, no passkey management, no chained approvals), refresh keeping the scope, and remote revocation. It also covers deny → `access_denied`, expiry → `expired_token`, and invalid client / scope.
