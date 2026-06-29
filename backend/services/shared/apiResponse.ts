/**
 * Issue #401 – Standardized API Response Envelope
 *
 * Every backend endpoint must return a value that conforms to ApiResponse<T>.
 * Shape:
 *   {
 *     success : boolean
 *     data?   : T                  – present on success
 *     error?  : ApiError           – present on failure
 *     meta    : ResponseMeta       – always present
 *   }
 *
 * Error codes follow the pattern  DOMAIN_SNAKE_CASE  and map 1-to-1 to an
 * HTTP status via ERROR_HTTP_STATUS_MAP.
 *
 * Backward-compatibility header:
 *   X-API-Version: 1
 * Clients that still expect the raw domain object can detect this header and
 * unwrap `data` themselves.
 */

import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Core types
// ─────────────────────────────────────────────────────────────────────────────

/** Pagination cursor metadata included when a list endpoint supports paging. */
export interface PaginationMeta {
  /** Opaque cursor pointing to the next page; absent when there is no next page. */
  cursor?: string;
  /** Whether more records exist beyond this page. */
  hasMore: boolean;
  /** Total number of records matching the query (may be omitted for cursor-only paging). */
  total?: number;
}

/** Metadata attached to every response. */
export interface ResponseMeta {
  /** ISO-8601 timestamp of when the response was generated. */
  timestamp: string;
  /** Unique identifier for this request, echoed from X-Request-ID or generated. */
  requestId: string;
  /** API version – increment when the envelope shape changes. */
  apiVersion: number;
  /** Pagination info; only present on list/search responses. */
  pagination?: PaginationMeta;
}

/** Structured error object. */
export interface ApiError {
  /** Machine-readable error code (see ERROR_HTTP_STATUS_MAP). */
  code: ErrorCode;
  /** Human-readable description of the error. */
  message: string;
  /** Optional field-level validation details. */
  details?: Record<string, string>;
  /** For OCC conflicts, the current version of the resource on the server. */
  version?: number;
}

/** Successful response envelope. */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
  error?: never;
}

/** Failure response envelope. */
export interface ApiErrorResponse {
  success: false;
  data?: never;
  error: ApiError;
  meta: ResponseMeta;
}

/** Union type – use this as the return type of every endpoint handler. */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ─────────────────────────────────────────────────────────────────────────────
// Error codes & HTTP status mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical error codes.
 *
 * Naming convention: <DOMAIN>_<REASON>
 * Add new codes at the bottom of each domain block; never reorder existing ones.
 */
export type ErrorCode =
  // ── Generic ──────────────────────────────────────────────────────────────
  | 'INTERNAL_SERVER_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  /** Optimistic Concurrency Control failure. */
  | 'CONFLICT_VERSION_MISMATCH'
  | 'BAD_REQUEST'
  | 'SERVICE_UNAVAILABLE'
  // ── Rate limiting ─────────────────────────────────────────────────────────
  | 'RATE_LIMIT_EXCEEDED'
  | 'RATE_LIMIT_HOURLY_EXCEEDED'
  | 'RATE_LIMIT_DAILY_EXCEEDED'
  | 'RATE_LIMIT_MONTHLY_EXCEEDED'
  // ── Subscription ─────────────────────────────────────────────────────────
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'SUBSCRIPTION_ALREADY_ACTIVE'
  | 'SUBSCRIPTION_CANCELLED'
  | 'SUBSCRIPTION_PAUSED'
  | 'SUBSCRIPTION_CHARGE_FAILED'
  // ── Plan ─────────────────────────────────────────────────────────────────
  | 'PLAN_NOT_FOUND'
  | 'PLAN_INACTIVE'
  | 'PLAN_PRICE_INVALID'
  // ── Dunning ──────────────────────────────────────────────────────────────
  | 'DUNNING_ENTRY_NOT_FOUND'
  | 'DUNNING_ALREADY_PAUSED'
  // ── Webhook ──────────────────────────────────────────────────────────────
  | 'WEBHOOK_NOT_FOUND'
  | 'WEBHOOK_DELIVERY_FAILED'
  | 'WEBHOOK_PAYLOAD_TOO_LARGE'
  // ── Campaign / Coupon ─────────────────────────────────────────────────────
  | 'CAMPAIGN_NOT_FOUND'
  | 'COUPON_INVALID'
  | 'COUPON_EXPIRED'
  | 'COUPON_MAX_USES_REACHED'
  // ── Pricing ──────────────────────────────────────────────────────────────
  | 'PRICING_CALCULATION_FAILED'
  // ── Audit ────────────────────────────────────────────────────────────────
  | 'AUDIT_CAPTURE_FAILED'
  // ── Tax ──────────────────────────────────────────────────────────────────
  | 'TAX_CALCULATION_FAILED'
  | 'TAX_JURISDICTION_NOT_FOUND'
  // ── Idempotency ──────────────────────────────────────────────────────────
  | 'IDEMPOTENCY_KEY_COLLISION'
  | 'IDEMPOTENCY_REQUEST_IN_FLIGHT'
  // ── Locking (Issue #610) ─────────────────────────────────────────────────
  | 'LOCK_ACQUISITION_TIMEOUT'
  | 'LOCK_DEADLOCK_DETECTED'
  | 'LOCK_RELEASE_FAILED'
  // ── Encryption (Issue #604) ──────────────────────────────────────────────
  | 'ENCRYPTION_KEY_NOT_FOUND'
  | 'ENCRYPTION_KMS_UNAVAILABLE'
  | 'ENCRYPTION_KEK_NOT_FOUND'
  | 'ENCRYPTION_DECRYPT_FAILED'
  | 'ENCRYPTION_KEY_ROTATION_FAILED'
  // ── Auth / API Keys (Issue #603) ─────────────────────────────────────────
  | 'AUTH_API_KEY_NOT_FOUND'
  | 'AUTH_API_KEY_EXPIRED'
  | 'AUTH_API_KEY_ROTATION_FAILED'
  | 'AUTH_API_KEY_REVOKED'
  // ── Payment Gateway (Issue #581) ─────────────────────────────────────────
  | 'PAYMENT_GATEWAY_NOT_FOUND'
  | 'PAYMENT_GATEWAY_ERROR'
  | 'PAYMENT_GATEWAY_FALLBACK_FAILED'
  | 'PAYMENT_GATEWAY_CONFIG_INVALID'
  | 'PAYMENT_REFUND_PARTIAL_FAILED';

/**
 * Maps each error code to the HTTP status code that should be sent to the
 * client.  Controllers/middleware can look up the status from the code without
 * hard-coding numbers everywhere.
 */
export const ERROR_HTTP_STATUS_MAP: Record<ErrorCode, number> = {
  // Generic
  INTERNAL_SERVER_ERROR: 500,
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  CONFLICT_VERSION_MISMATCH: 409,
  BAD_REQUEST: 400,
  SERVICE_UNAVAILABLE: 503,
  // Rate limiting
  RATE_LIMIT_EXCEEDED: 429,
  RATE_LIMIT_HOURLY_EXCEEDED: 429,
  RATE_LIMIT_DAILY_EXCEEDED: 429,
  RATE_LIMIT_MONTHLY_EXCEEDED: 429,
  // Subscription
  SUBSCRIPTION_NOT_FOUND: 404,
  SUBSCRIPTION_ALREADY_ACTIVE: 409,
  SUBSCRIPTION_CANCELLED: 409,
  SUBSCRIPTION_PAUSED: 409,
  SUBSCRIPTION_CHARGE_FAILED: 402,
  // Plan
  PLAN_NOT_FOUND: 404,
  PLAN_INACTIVE: 409,
  PLAN_PRICE_INVALID: 422,
  // Dunning
  DUNNING_ENTRY_NOT_FOUND: 404,
  DUNNING_ALREADY_PAUSED: 409,
  // Webhook
  WEBHOOK_NOT_FOUND: 404,
  WEBHOOK_DELIVERY_FAILED: 502,
  WEBHOOK_PAYLOAD_TOO_LARGE: 413,
  // Campaign / Coupon
  CAMPAIGN_NOT_FOUND: 404,
  COUPON_INVALID: 422,
  COUPON_EXPIRED: 410,
  COUPON_MAX_USES_REACHED: 409,
  // Pricing
  PRICING_CALCULATION_FAILED: 500,
  // Audit
  AUDIT_CAPTURE_FAILED: 500,
  // Tax
  TAX_CALCULATION_FAILED: 500,
  TAX_JURISDICTION_NOT_FOUND: 404,
  // Idempotency
  IDEMPOTENCY_KEY_COLLISION: 422,
  IDEMPOTENCY_REQUEST_IN_FLIGHT: 409,
  // Locking (Issue #610)
  LOCK_ACQUISITION_TIMEOUT: 409,
  LOCK_DEADLOCK_DETECTED: 409,
  LOCK_RELEASE_FAILED: 500,
  // Encryption (Issue #604)
  ENCRYPTION_KEY_NOT_FOUND: 404,
  ENCRYPTION_KMS_UNAVAILABLE: 503,
  ENCRYPTION_KEK_NOT_FOUND: 404,
  ENCRYPTION_DECRYPT_FAILED: 500,
  ENCRYPTION_KEY_ROTATION_FAILED: 500,
  // Auth / API Keys (Issue #603)
  AUTH_API_KEY_NOT_FOUND: 404,
  AUTH_API_KEY_EXPIRED: 401,
  AUTH_API_KEY_ROTATION_FAILED: 500,
  AUTH_API_KEY_REVOKED: 401,
  // Payment Gateway (Issue #581)
  PAYMENT_GATEWAY_NOT_FOUND: 404,
  PAYMENT_GATEWAY_ERROR: 502,
  PAYMENT_GATEWAY_FALLBACK_FAILED: 502,
  PAYMENT_GATEWAY_CONFIG_INVALID: 422,
  PAYMENT_REFUND_PARTIAL_FAILED: 422,
};

// ─────────────────────────────────────────────────────────────────────────────
// Builder helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the standard ResponseMeta object.
 *
 * @param requestId  – pass the value of the incoming X-Request-ID header when
 *                     available; a new UUID is generated otherwise.
 * @param pagination – optional pagination metadata for list responses.
 */
export function buildMeta(requestId?: string, pagination?: PaginationMeta): ResponseMeta {
  return {
    timestamp: new Date().toISOString(),
    requestId: requestId ?? randomUUID(),
    apiVersion: 1,
    ...(pagination !== undefined ? { pagination } : {}),
  };
}

/**
 * Wrap a successful result in the standard envelope.
 *
 * @example
 * return ok(subscription, requestId);
 * // { success: true, data: subscription, meta: { ... } }
 */
export function ok<T>(
  data: T,
  requestId?: string,
  pagination?: PaginationMeta,
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    meta: buildMeta(requestId, pagination),
  };
}

/**
 * Wrap an error in the standard envelope.
 *
 * @example
 * return fail('SUBSCRIPTION_NOT_FOUND', 'Subscription 42 does not exist', requestId);
 */
export function fail(
  code: ErrorCode,
  message: string,
  requestId?: string,
  details?: Record<string, string> | { version?: number },
): ApiErrorResponse {
  const errorPayload: ApiError = { code, message, ...details };
  return {
    success: false,
    error: errorPayload,
    meta: buildMeta(requestId),
  };
}

/**
 * Convert an unknown thrown value into a standardised failure envelope.
 * Use this in catch blocks to avoid leaking raw Error messages.
 *
 * @example
 * try {
 *   return ok(await service.doSomething());
 * } catch (err) {
 *   return fromError(err, requestId);
 * }
 */
export function fromError(err: unknown, requestId?: string): ApiErrorResponse {
  const message =
    err instanceof Error ? err.message : 'An unexpected error occurred';
  return fail('INTERNAL_SERVER_ERROR', message, requestId);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP header constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Backward-compatibility header that legacy clients can inspect to detect the
 * new envelope format and unwrap `data` themselves.
 */
export const API_VERSION_HEADER = 'X-API-Version';
export const API_VERSION_VALUE = '1';

/**
 * Clients should echo this header value back in X-Request-ID on every request
 * so that the requestId in the response meta can be correlated with server logs.
 */
export const REQUEST_ID_HEADER = 'X-Request-ID';
