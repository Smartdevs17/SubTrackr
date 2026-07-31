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
- `ServiceUnavailableError` (533 Service Unavailable)

## Standard API Error Response Payload
All API error responses follow the standard JSON format:
```json
{
  "success": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "The provided subscription ID format is invalid.",
    "details": {
      "field": "subscriptionId"
    },
    "timestamp": "2026-07-27T11:00:00.000Z",
    "requestId": "req_abc123"
  }
}
```

## Best Practices
1. **Never throw primitive strings or raw Error objects**. Always instantiate domain-specific error classes.
2. **Include Context and Request IDs** to allow trace correlation across client and server logs.
3. **Provide User Recovery Actions** in client error instances where actionable remediation is possible.
