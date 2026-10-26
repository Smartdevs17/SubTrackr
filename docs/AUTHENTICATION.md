# SubTrackr Pluggable Authentication Architecture

## Overview
SubTrackr implements a modular, strategy-based authentication architecture. Instead of coupling authentication to a single provider or token format, authentication is handled via the `CompositeAuthStrategyManager`.

## Auth Strategy Interface (`IAuthStrategy`)
Every authentication strategy must implement `IAuthStrategy`:
```typescript
export interface IAuthStrategy {
  readonly name: string;
  readonly rateLimitTier: 'basic' | 'standard' | 'premium';
  validate(req: Request): Promise<AuthUser | null>;
}
```

## Supported Strategies

1. **JWT Strategy (`JwtAuthStrategy`)**
   - Header: `Authorization: Bearer <token>`
   - Tier: Standard rate limiting
   - Ideal for web sessions and mobile app user sessions.

2. **API Key Strategy (`ApiKeyAuthStrategy`)**
   - Header: `X-API-Key: <key>` or query string `?api_key=<key>`
   - Tier: Premium rate limiting
   - Ideal for third-party integrations and developer API access.

3. **Wallet Signature Strategy (`WalletAuthStrategy`)**
   - Headers: `X-Wallet-Address`, `X-Wallet-Signature`
   - Tier: Basic rate limiting
   - Supports cryptographic signature validation for Web3 and Stellar accounts.

## Fallback & Multi-Strategy Chaining
The `CompositeAuthStrategyManager` evaluates incoming requests sequentially against registered strategies.
If a strategy validates the request, authentication succeeds immediately. If a strategy returns `null`, the manager attempts the next strategy in line. If all strategies fail, an `UnauthorizedError` (HTTP 401) is thrown.

## Passwordless Login with Passkeys
Users can register WebAuthn passkeys while signed in and later sign in without a password. A successful passkey assertion issues a regular server session (`X-Session-Token`). See [passkeys.md](./passkeys.md) for the flow, configuration and API.

## Sessions, Refresh-Token Rotation and Password Fallback
Every sign-in (passkey, password, device flow) issues a session through `SessionTokenService`: a short-lived access token plus a refresh token that rotates on every use. Replaying a rotated refresh token revokes the whole session. Users can list their sessions and revoke any of them remotely, with immediate effect. Passwords are a fallback sign-in method next to passkeys. See [sessions-and-tokens.md](./sessions-and-tokens.md).

## OAuth Device Authorization Flow
CLIs and other input-constrained devices sign in with the RFC 8628 device code flow; the issued token is limited to the scopes the user approved. See [oauth-device-flow.md](./oauth-device-flow.md).

## API Key Revocation & Leak Detection
API keys can be revoked instantly, and exposed keys are detected by scanning content, matching breach-feed hashes and watching for usage anomalies — with automatic revocation or flagging per merchant policy. See [api-key-revocation.md](./api-key-revocation.md).
