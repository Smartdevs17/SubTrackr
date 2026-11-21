/**
 * Typed result envelope for developer-portal server actions.
 *
 * Issue #2061 — Refactor developer portal onto typed server actions.
 *
 * Every action returns a discriminated union so callers can narrow on `ok`
 * without try/catch.  Validation failures carry field-level error details;
 * domain failures carry a machine-readable `code` and human `message`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────────────────────

export interface ActionSuccess<T> {
  ok: true;
  data: T;
}

export interface ActionFieldError {
  /** Zod-style path, e.g. "email" or "permissions.0". */
  path: string;
  message: string;
}

export interface ActionError {
  /** Machine-readable error code for programmatic branching. */
  code: string;
  /** Human-readable summary. */
  message: string;
  /** Present when the failure is caused by invalid input. */
  fieldErrors?: ActionFieldError[];
}

export interface ActionFailure {
  ok: false;
  error: ActionError;
}

export type ActionResult<T> = ActionSuccess<T> | ActionFailure;

// ─────────────────────────────────────────────────────────────────────────────
// Constructors
// ─────────────────────────────────────────────────────────────────────────────

export function ok<T>(data: T): ActionSuccess<T> {
  return { ok: true, data };
}

export function fail(
  code: string,
  message: string,
  fieldErrors?: ActionFieldError[]
): ActionFailure {
  return { ok: false, error: { code, message, fieldErrors } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Common error codes
// ─────────────────────────────────────────────────────────────────────────────

/** Input did not pass the zod schema. */
export const VALIDATION_ERROR = 'validation_error';

/** The referenced entity (developer, key, guide…) was not found. */
export const NOT_FOUND = 'not_found';

/** A business rule was violated (duplicate email, key already revoked, …). */
export const CONFLICT = 'conflict';

/** The caller is not permitted to perform the action. */
export const FORBIDDEN = 'forbidden';

/** An unexpected error occurred inside the action. */
export const INTERNAL_ERROR = 'internal_error';
