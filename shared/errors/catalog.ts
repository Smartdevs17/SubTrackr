/**
 * Canonical error registry shared by the app, the backend and the Soroban
 * contracts. `contractCodes` mirrors the stable u32 discriminants in
 * contracts/subscription/src/errors.rs — never reorder those values.
 */
export interface ErrorDescriptor {
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly contractCodes: readonly number[];
}

export const ERROR_CATALOG = {
  INTERNAL_ERROR: { httpStatus: 500, retryable: false, contractCodes: [] },
  VALIDATION_ERROR: { httpStatus: 422, retryable: false, contractCodes: [] },
  NETWORK_ERROR: { httpStatus: 503, retryable: true, contractCodes: [] },
  UNAUTHORIZED: { httpStatus: 401, retryable: false, contractCodes: [1] },
  PLAN_NOT_FOUND: { httpStatus: 404, retryable: false, contractCodes: [2] },
  PLAN_INACTIVE: { httpStatus: 409, retryable: false, contractCodes: [3] },
  SUBSCRIPTION_NOT_FOUND: { httpStatus: 404, retryable: false, contractCodes: [4] },
  ALREADY_SUBSCRIBED: { httpStatus: 409, retryable: false, contractCodes: [5] },
  SUBSCRIPTION_NOT_ACTIVE: { httpStatus: 409, retryable: false, contractCodes: [6] },
  SUBSCRIPTION_ALREADY_CANCELLED: { httpStatus: 409, retryable: false, contractCodes: [7] },
  SUBSCRIPTION_ALREADY_PAUSED: { httpStatus: 409, retryable: false, contractCodes: [8] },
  SUBSCRIPTION_NOT_PAUSED: { httpStatus: 409, retryable: false, contractCodes: [9] },
  PAYMENT_NOT_YET_DUE: { httpStatus: 409, retryable: false, contractCodes: [10] },
  INSUFFICIENT_ALLOWANCE: { httpStatus: 402, retryable: true, contractCodes: [11] },
  INVALID_AMOUNT: { httpStatus: 422, retryable: false, contractCodes: [12] },
  INVALID_INTERVAL: { httpStatus: 422, retryable: false, contractCodes: [13] },
  INVALID_PRICE_BOUNDS: { httpStatus: 422, retryable: false, contractCodes: [14] },
  MAX_PAUSE_DURATION_EXCEEDED: { httpStatus: 422, retryable: false, contractCodes: [15] },
  RATE_LIMITED: { httpStatus: 429, retryable: true, contractCodes: [16] },
  ORACLE_UNAVAILABLE: { httpStatus: 503, retryable: true, contractCodes: [17] },
  STORAGE_VERSION_MISMATCH: { httpStatus: 409, retryable: false, contractCodes: [18] },
  INVALID_MIGRATION_PATH: { httpStatus: 400, retryable: false, contractCodes: [19] },
  REFUND_EXCEEDS_TOTAL_PAID: { httpStatus: 422, retryable: false, contractCodes: [20] },
  PLAN_OWNER_MISMATCH: { httpStatus: 403, retryable: false, contractCodes: [21] },
  EVENT_NOT_FOUND: { httpStatus: 404, retryable: false, contractCodes: [22] },
  EVENT_STORE_FULL: { httpStatus: 409, retryable: false, contractCodes: [23] },
  INVALID_EVENT_SEQUENCE: { httpStatus: 409, retryable: false, contractCodes: [24] },
  EXPORT_WINDOW_EXCEEDED: { httpStatus: 422, retryable: false, contractCodes: [25] },
} as const satisfies Record<string, ErrorDescriptor>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

export function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CATALOG, value);
}
