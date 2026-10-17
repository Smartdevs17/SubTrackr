# Session Device Binding

Issue #1766 — a stolen session token is bound to the device it was issued on
and cannot be replayed from anywhere else.

## Enforcement

[`backend/services/auth/serverSessionService.ts`](../backend/services/auth/serverSessionService.ts)
fingerprints the device at session creation (SHA-256 over
`user-agent` + `accept-language`) and re-checks it on every validation:

| `deviceBinding` mode | Behaviour |
| --- | --- |
| `enforce` (default) | A fingerprint mismatch fails validation with `reason: "device_binding_mismatch"` (HTTP 401 on `/sessions/validate`) |
| `warn` | The request proceeds but the session is flagged suspicious (`device_mismatch`) and audited |
| `off` | Check disabled (legacy / migration window) |

```bash
# Change mode at runtime
curl -X PATCH /sessions/config -H 'content-type: application/json' \
  -d '{"deviceBinding":"enforce"}'
```

Reasons take their usual precedence: `session_not_found` → `session_revoked` →
`session_expired` → `device_binding_mismatch`.

## Rebind flow

A legitimate device change (OS upgrade changing the UA string, restored
backup, new phone) is recovered with an explicit rebind that requires
step-up authentication:

1. The client re-authenticates with a passkey (existing
   `POST /api/v1/auth/passkeys/login/verify` issues a fresh session whose
   `metadata.authMethod === 'passkey'`).
2. The client calls `POST /sessions/rebind` with:
   - `X-Session-Token` — the session to rebind, and
   - `X-Reauth-Token` — the fresh passkey session from step 1 (same user,
     issued within the last 5 minutes).
3. The server re-binds the session to the fingerprint of the rebind request,
   clears any pending `device_mismatch` flag, records the transition in the
   audit log (`action: "rebound"`), and the session validates normally from
   the new device afterwards.

Refusals: missing reauth header → `403 step_up_required`; stale/foreign/non-
passkey reauth token → `403 step_up_invalid`; revoked/expired session →
`409`; already-bound device → `200 { rebound: false, reason: "same_device" }`.
`ServerSessionService.rebindSession()` itself also refuses any rebind without
`reauthenticated: true`, so a stolen token alone can never move a session.

## Tests

`backend/services/auth/__tests__/deviceBinding.test.ts` covers same-device
validation, cross-device rejection (UA and Accept-Language changes), warn/off
fallbacks, audit entries, step-up-required refusal, successful rebind with
device hand-over, flag clearing, and the missing/revoked/expired/same-device
rebind outcomes.

```bash
npx jest --config jest.backend.config.js --testMatch '**/backend/services/auth/__tests__/deviceBinding.test.ts'
```
