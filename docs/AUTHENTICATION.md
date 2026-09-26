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
