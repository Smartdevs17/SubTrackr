/**
 * Standard API response envelope shared across backend services.
 *
 * A single discriminated union (`ok: true | false`) so callers can branch on one
 * field and always get either typed data or a structured error — no throwing
 * across service boundaries, and a consistent shape for the export pipeline's
 * partial-success / retry reporting.
 */

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  /** True when the caller may safely retry (transient failure). */
  retryable?: boolean;
}

export interface ApiFailure {
  ok: false;
  error: ApiError;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const ok = <T>(data: T, meta?: Record<string, unknown>): ApiSuccess<T> => ({
  ok: true,
  data,
  ...(meta ? { meta } : {}),
});

export const fail = (
  code: string,
  message: string,
  options: { details?: unknown; retryable?: boolean } = {}
): ApiFailure => ({
  ok: false,
  error: { code, message, details: options.details, retryable: options.retryable ?? false },
});

export const isOk = <T>(response: ApiResponse<T>): response is ApiSuccess<T> => response.ok;
