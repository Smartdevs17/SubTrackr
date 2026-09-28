# Passwordless Login with Passkeys

SubTrackr supports passwordless sign-in with **passkeys** (WebAuthn / FIDO2 credentials). A passkey is a public/private key pair created by the user's device (Touch ID, Face ID, Windows Hello, Android, a security key or a synced password manager). The private key never leaves the authenticator; the backend only stores the public key and verifies signatures.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Configuration](#configuration)
3. [Registration Flow](#registration-flow)
4. [Login Flow](#login-flow)
5. [Security Checks](#security-checks)
6. [API Reference](#api-reference)
7. [Error Codes](#error-codes)
8. [Client Example](#client-example)
9. [Testing](#testing)

---

## Architecture

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `webauthn.ts` | `backend/services/auth/domain/` | base64url, CBOR decoding, authenticator data parsing, COSE key conversion, signature verification (no external dependencies) |
| `PasskeyService` | `backend/services/auth/domain/PasskeyService.ts` | Challenge lifecycle, registration + authentication ceremonies, credential storage, counter checks, audit log |
| `PasskeyController` | `backend/services/auth/controller/passkeyController.ts` | Wraps service calls in the standard `ApiResponse` envelope |
| `createPasskeyRouter` | `backend/services/auth/router/authRouter.ts` | Express routes mounted at `/api/v1/auth`; issues a server session on successful login |

A successful passkey login creates a regular server session through `serverSessionService` (the same mechanism as `POST /sessions`), so device tracking, concurrent-session limits and revocation work unchanged. The session metadata records `authMethod: "passkey"` and the credential ID.

Supported algorithms: **ES256** (`-7`), **EdDSA / Ed25519** (`-8`) and **RS256** (`-257`).
Supported attestation formats: **`none`** (requested by default) and **`packed`** (self attestation or `x5c` signature check).

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PASSKEY_RP_ID` | `localhost` | Relying party ID — the registrable domain passkeys are bound to (e.g. `subtrackr.app`) |
| `PASSKEY_RP_NAME` | `SubTrackr` | Name shown by the platform passkey UI |
| `PASSKEY_ORIGINS` | `http://localhost:8081` | Comma-separated list of exact origins allowed to run ceremonies |

Other options (`challengeTtlMs` — 5 minutes, `userVerification` — `preferred`, `maxCredentialsPerUser` — 10) can be passed to the `PasskeyService` constructor. Set `userVerification: 'required'` to reject assertions without biometric/PIN verification.

---

## Registration Flow

Adding a passkey requires an existing authenticated session (`X-Session-Token`), so a passkey can only be attached to the account that is currently signed in.

```
Client                                   Backend
  │ POST /passkeys/register/options  ──►  issue single-use challenge (5 min)
  │ ◄── PublicKeyCredentialCreationOptions
  │ navigator.credentials.create()
  │ POST /passkeys/register/verify   ──►  verify clientData, attestation, authData
  │ ◄── 201 stored passkey summary        store credential (public key, counter)
```

## Login Flow

Login supports both username-first (`userId` → `allowCredentials` is filled) and usernameless sign-in (empty `allowCredentials`, the authenticator returns the user handle of a discoverable credential).

```
Client                                   Backend
  │ POST /passkeys/login/options     ──►  issue single-use challenge
  │ ◄── PublicKeyCredentialRequestOptions
  │ navigator.credentials.get()
  │ POST /passkeys/login/verify      ──►  verify signature + counter
  │ ◄── 200 + X-Session-Token header      create server session
```

---

## Security Checks

Every ceremony enforces:

- **Single-use challenges** — 32 random bytes, bound to the ceremony type (and user for registration), expiring after `challengeTtlMs`. A challenge is consumed on the first verification attempt, so captured responses cannot be replayed.
- **Client data** — `type` must be `webauthn.create` / `webauthn.get`, `origin` must be in `PASSKEY_ORIGINS`, and cross-origin ceremonies are rejected.
- **Authenticator data** — the RP ID hash must equal `SHA-256(PASSKEY_RP_ID)`, the user-present flag must be set, and the user-verified flag is required when configured.
- **Credential binding** — the credential ID in the attestation must match `rawId`; duplicate registrations are rejected; an assertion must come from a credential owned by the requested user and, when present, the returned user handle must match.
- **Signature counter** — authenticators that implement a counter must report a strictly increasing value. A regression suggests a cloned authenticator: the login is rejected and the credential is **suspended** (it no longer appears in `allowCredentials` and cannot be used until the user removes it and registers a new one).
- **Privacy** — the WebAuthn user handle is an opaque random value; it never contains the user ID or email.

All outcomes (`registration_started`, `registered`, `registration_failed`, `authentication_started`, `authenticated`, `authentication_failed`, `counter_regression`, `removed`) are recorded in the passkey audit log (`passkeyService.getAuditLog()`).

---

## API Reference

All routes are mounted at `/api/v1/auth` and return the standard `ApiResponse` envelope.

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| `POST` | `/passkeys/register/options` | `X-Session-Token` | `{ userName, displayName? }` | Creation options for `navigator.credentials.create()` |
| `POST` | `/passkeys/register/verify` | `X-Session-Token` | `{ response, deviceName? }` | Verify and store the new passkey |
| `POST` | `/passkeys/login/options` | — | `{ userId? }` | Request options for `navigator.credentials.get()` |
| `POST` | `/passkeys/login/verify` | — | `{ response }` | Verify the assertion; returns `X-Session-Token` header |
| `GET` | `/passkeys` | `X-Session-Token` | — | List the caller's passkeys (public keys are never returned) |
| `DELETE` | `/passkeys/:credentialId` | `X-Session-Token` | — | Remove one of the caller's passkeys |

`response` is the JSON serialisation of the `PublicKeyCredential` with every binary field (`rawId`, `clientDataJSON`, `attestationObject`, `authenticatorData`, `signature`, `userHandle`) encoded as base64url.

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `AUTH_PASSKEY_CHALLENGE_INVALID` | 400 | Challenge unknown, already used, expired, or issued for another ceremony/user |
| `AUTH_PASSKEY_VERIFICATION_FAILED` | 401 | Origin, RP ID, flags, attestation or signature check failed |
| `AUTH_PASSKEY_CREDENTIAL_NOT_FOUND` | 404 | No passkey with that credential ID (or not owned by the caller) |
| `AUTH_PASSKEY_CREDENTIAL_EXISTS` | 409 | Credential already registered |
| `AUTH_PASSKEY_COUNTER_REGRESSION` | 401 | Signature counter did not increase — credential suspended |
| `UNAUTHORIZED` | 401 | Missing or invalid `X-Session-Token` on a management route |

---

## Client Example

```ts
const b64u = {
  encode: (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
};

// Login
const { data: options } = await api.post('/api/v1/auth/passkeys/login/options', {});
const credential = (await navigator.credentials.get({
  publicKey: {
    ...options,
    challenge: b64u.decode(options.challenge),
    allowCredentials: options.allowCredentials.map((c) => ({ ...c, id: b64u.decode(c.id) })),
  },
})) as PublicKeyCredential;
const assertion = credential.response as AuthenticatorAssertionResponse;

const res = await api.post('/api/v1/auth/passkeys/login/verify', {
  response: {
    id: credential.id,
    rawId: b64u.encode(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: b64u.encode(assertion.clientDataJSON),
      authenticatorData: b64u.encode(assertion.authenticatorData),
      signature: b64u.encode(assertion.signature),
      userHandle: assertion.userHandle ? b64u.encode(assertion.userHandle) : null,
    },
  },
});
const sessionToken = res.headers['x-session-token'];
```

---

## Testing

```bash
npx jest --config jest.backend.config.js backend/services/auth
```

The suites use a software authenticator (`backend/services/auth/__tests__/helpers/softwareAuthenticator.ts`) that produces real CBOR attestation objects and ES256 / EdDSA / RS256 signatures, so every verification path — including tampered signatures, wrong origins, replayed challenges and counter regressions — is exercised end to end.
