# SubTrackr Error Handling Guide

## Overview
SubTrackr implements a unified, structured error handling architecture across both client applications (`src/errors/`) and backend services (`backend/services/shared/errors.ts`).

## Error Class Hierarchy

### Client-Side Domain Errors (`src/errors/index.ts`)
All client-side errors inherit from `AppError`:
- `AppError`: Base error class with `code`, `userMessage`, `recovery`, `context`, `timestamp`, and `requestId`.
- `WalletError`: Wallet connection and transaction failures (`WalletErrorCode`).
- `ContractError`: Smart contract interaction and decoding failures (`ContractErrorCode`).
- `NetworkError`: Network transport, timeout, and RPC failures (`NetworkErrorCode`).
- `ValidationError`: Client-side form and field validation errors (`ValidationErrorCode`).
- `AuthError`: Authentication and token validation errors (`AuthErrorCode`).
- `NotFoundError`: Resource resolution failures (`NotFoundErrorCode`).
- `RateLimitError`: Client rate limit exceedance (`RateLimitErrorCode`).
- `DatabaseError`: Local database / storage errors (`DatabaseErrorCode`).
- `WebSocketError`: Real-time streaming connection errors (`WebSocketErrorCode`).

### Backend Domain Errors (`backend/services/shared/errors.ts`)
All backend domain errors inherit from `DomainError`:
- `DomainError`: Base backend error class providing HTTP status codes and structured response payloads (`toApiResponse()`).
- `ValidationError` (400 Bad Request)
- `UnauthorizedError` (401 Unauthorized)
- `ForbiddenError` (403 Forbidden)
- `NotFoundError` (404 Not Found)
- `ConflictError` (409 Conflict)
- `RateLimitExceededError` (429 Too Many Requests)
- `InternalServerError` (500 Internal Server Error)
- `BadGatewayError` (502 Bad Gateway)
- `ServiceUnavailableError` (503 Service Unavailable)

## Standard API Error Response Payload
All API error responses follow the standard JSON envelope defined in `backend/services/shared/apiResponse.ts`:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input provided.",
    "details": {
      "price": "must be > 0"
    }
  },
  "meta": {
    "timestamp": "2026-10-17T15:00:00.000Z",
    "requestId": "req_abc123",
    "apiVersion": 1
  }
}
```

## Canonical Error Codes & HTTP Status Mapping

Error codes follow the `<DOMAIN>_<REASON>` naming convention and map to HTTP status codes via `ERROR_HTTP_STATUS_MAP`:

| Error Code | HTTP Status | Domain | Description |
|---|---|---|---|
| `INTERNAL_SERVER_ERROR` | 500 | Generic | Unhandled unexpected server failure |
| `VALIDATION_ERROR` | 422 | Generic | Request payload, query, or path validation failure |
| `BAD_REQUEST` | 400 | Generic | Malformed syntax or missing headers |
| `NOT_FOUND` | 404 | Generic | Requested resource does not exist |
| `UNAUTHORIZED` | 401 | Generic | Authentication credentials missing or invalid |
| `FORBIDDEN` | 403 | Generic | Insufficient permissions for requested action |
| `CONFLICT` | 409 | Generic | Resource state conflict |
| `CONFLICT_VERSION_MISMATCH` | 409 | Generic | Optimistic concurrency control version conflict |
| `SERVICE_UNAVAILABLE` | 503 | Generic | Upstream dependency or service down |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate Limiting | Burst or general rate limit quota exceeded |
| `RATE_LIMIT_HOURLY_EXCEEDED`| 429 | Rate Limiting | Hourly request limit exceeded |
| `RATE_LIMIT_DAILY_EXCEEDED` | 429 | Rate Limiting | Daily request limit exceeded |
| `RATE_LIMIT_MONTHLY_EXCEEDED`| 429| Rate Limiting | Monthly tier limit exceeded |
| `SUBSCRIPTION_NOT_FOUND` | 404 | Subscription | Subscription ID does not exist |
| `SUBSCRIPTION_ALREADY_ACTIVE`| 409 | Subscription | Subscription already in active state |
| `SUBSCRIPTION_CANCELLED` | 409 | Subscription | Action cannot be performed on cancelled subscription |
| `SUBSCRIPTION_PAUSED` | 409 | Subscription | Subscription currently paused |
| `SUBSCRIPTION_CHARGE_FAILED`| 402 | Subscription | Subscription billing charge failed |
| `PLAN_NOT_FOUND` | 404 | Plan | Plan ID does not exist |
| `PLAN_INACTIVE` | 409 | Plan | Plan is not active |
| `PLAN_PRICE_INVALID` | 422 | Plan | Plan price specification invalid |
| `DUNNING_ENTRY_NOT_FOUND` | 404 | Dunning | Dunning record not found |
| `DUNNING_ALREADY_PAUSED` | 409 | Dunning | Dunning sequence already paused |
| `WEBHOOK_NOT_FOUND` | 404 | Webhook | Webhook endpoint not found |
| `WEBHOOK_DELIVERY_FAILED` | 502 | Webhook | Outbound webhook delivery attempt failed |
| `WEBHOOK_PAYLOAD_TOO_LARGE`| 413 | Webhook | Inbound webhook payload exceeds size limit |
| `CAMPAIGN_NOT_FOUND` | 404 | Promotion | Promotional campaign not found |
| `COUPON_INVALID` | 422 | Promotion | Coupon code invalid or not applicable |
| `COUPON_EXPIRED` | 410 | Promotion | Coupon validity period has expired |
| `COUPON_MAX_USES_REACHED` | 409 | Promotion | Coupon redemption limit reached |
| `TAX_CALCULATION_FAILED` | 500 | Tax | Automated tax computation failed |
| `TAX_JURISDICTION_NOT_FOUND`| 404| Tax | Tax jurisdiction unknown |
| `IDEMPOTENCY_KEY_COLLISION`| 422 | Idempotency | Idempotency key reused with mismatched body |
| `IDEMPOTENCY_REQUEST_IN_FLIGHT`| 409 | Idempotency | Concurrent request with same key in progress |
| `AUTH_API_KEY_NOT_FOUND` | 401 | Auth | API key not recognized |
| `AUTH_API_KEY_EXPIRED` | 401 | Auth | API key has expired |
| `AUTH_API_KEY_REVOKED` | 401 | Auth | API key has been revoked |
| `PAYMENT_GATEWAY_NOT_FOUND`| 404 | Payment | Payment gateway adapter not found |
| `PAYMENT_GATEWAY_ERROR` | 502 | Payment | Upstream payment gateway error |
| `PAYMENT_REFUND_PARTIAL_FAILED`| 422 | Payment | Partial refund execution failed |
| `RPC_TIMEOUT` | 504 | RPC | Blockchain RPC provider call timed out |
| `RPC_CIRCUIT_OPEN` | 503 | RPC | RPC circuit breaker open due to high failure rate |

## Best Practices
1. **Never throw primitive strings or raw Error objects**. Always instantiate domain-specific error classes.
2. **Include Context and Request IDs** to allow trace correlation across client and server logs.
3. **Provide User Recovery Actions** in client error instances where actionable remediation is possible.
4. **Use `fail()` or `fromError()`** when constructing API responses directly in controllers.
