/**
 * Tests for Issue #401 – Standardised API Response Envelope
 */

import {
  ok,
  fail,
  fromError,
  buildMeta,
  ERROR_HTTP_STATUS_MAP,
  API_VERSION_HEADER,
  API_VERSION_VALUE,
  REQUEST_ID_HEADER,
} from '../apiResponse';
import type { ApiResponse, ApiSuccessResponse, ApiErrorResponse } from '../apiResponse';

// ─────────────────────────────────────────────────────────────────────────────
// ok()
// ─────────────────────────────────────────────────────────────────────────────

describe('ok()', () => {
  it('sets success to true', () => {
    const res = ok({ id: '1' });
    expect(res.success).toBe(true);
  });

  it('includes the data payload', () => {
    const data = { id: '42', name: 'Pro' };
    const res = ok(data);
    expect(res.data).toEqual(data);
  });

  it('generates a requestId when none is provided', () => {
    const res = ok({});
    expect(typeof res.meta.requestId).toBe('string');
    expect(res.meta.requestId.length).toBeGreaterThan(0);
  });

  it('echoes the provided requestId', () => {
    const res = ok({}, 'req-abc-123');
    expect(res.meta.requestId).toBe('req-abc-123');
  });

  it('sets apiVersion to 1', () => {
    expect(ok({}).meta.apiVersion).toBe(1);
  });

  it('includes a valid ISO timestamp', () => {
    const res = ok({});
    expect(() => new Date(res.meta.timestamp)).not.toThrow();
    expect(new Date(res.meta.timestamp).toISOString()).toBe(res.meta.timestamp);
  });

  it('attaches pagination metadata when provided', () => {
    const pagination = { cursor: 'tok_next', hasMore: true, total: 100 };
    const res = ok([], undefined, pagination);
    expect(res.meta.pagination).toEqual(pagination);
  });

  it('omits pagination key when not provided', () => {
    const res = ok({});
    expect(res.meta.pagination).toBeUndefined();
  });

  it('does not include an error field', () => {
    const res = ok({ x: 1 }) as ApiResponse<{ x: number }>;
    expect((res as ApiErrorResponse).error).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fail()
// ─────────────────────────────────────────────────────────────────────────────

describe('fail()', () => {
  it('sets success to false', () => {
    const res = fail('NOT_FOUND', 'Resource not found');
    expect(res.success).toBe(false);
  });

  it('includes the error code', () => {
    const res = fail('SUBSCRIPTION_NOT_FOUND', 'Sub 99 not found');
    expect(res.error.code).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('includes the error message', () => {
    const res = fail('VALIDATION_ERROR', 'Price must be positive');
    expect(res.error.message).toBe('Price must be positive');
  });

  it('echoes the provided requestId', () => {
    const res = fail('FORBIDDEN', 'Access denied', 'req-xyz');
    expect(res.meta.requestId).toBe('req-xyz');
  });

  it('attaches field-level details when provided', () => {
    const details = { price: 'must be > 0', name: 'required' };
    const res = fail('VALIDATION_ERROR', 'Invalid input', undefined, details);
    expect(res.error.details).toEqual(details);
  });

  it('omits details when not provided', () => {
    const res = fail('NOT_FOUND', 'Not found');
    expect(res.error.details).toBeUndefined();
  });

  it('does not include a data field', () => {
    const res = fail('NOT_FOUND', 'Not found') as ApiResponse<unknown>;
    expect((res as ApiSuccessResponse<unknown>).data).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fromError()
// ─────────────────────────────────────────────────────────────────────────────

describe('fromError()', () => {
  it('converts an Error instance to INTERNAL_SERVER_ERROR', () => {
    const res = fromError(new Error('DB connection lost'));
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(res.error.message).toBe('DB connection lost');
  });

  it('handles non-Error thrown values', () => {
    const res = fromError('something went wrong');
    expect(res.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(res.error.message).toBe('An unexpected error occurred');
  });

  it('echoes the requestId', () => {
    const res = fromError(new Error('oops'), 'req-err-1');
    expect(res.meta.requestId).toBe('req-err-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildMeta()
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMeta()', () => {
  it('generates a unique requestId each call when none is provided', () => {
    const a = buildMeta();
    const b = buildMeta();
    expect(a.requestId).not.toBe(b.requestId);
  });

  it('uses the provided requestId', () => {
    const meta = buildMeta('my-req-id');
    expect(meta.requestId).toBe('my-req-id');
  });

  it('sets apiVersion to 1', () => {
    expect(buildMeta().apiVersion).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ERROR_HTTP_STATUS_MAP
// ─────────────────────────────────────────────────────────────────────────────

describe('ERROR_HTTP_STATUS_MAP', () => {
  it('maps NOT_FOUND to 404', () => {
    expect(ERROR_HTTP_STATUS_MAP.NOT_FOUND).toBe(404);
  });

  it('maps UNAUTHORIZED to 401', () => {
    expect(ERROR_HTTP_STATUS_MAP.UNAUTHORIZED).toBe(401);
  });

  it('maps RATE_LIMIT_EXCEEDED to 429', () => {
    expect(ERROR_HTTP_STATUS_MAP.RATE_LIMIT_EXCEEDED).toBe(429);
  });

  it('maps SUBSCRIPTION_CHARGE_FAILED to 402', () => {
    expect(ERROR_HTTP_STATUS_MAP.SUBSCRIPTION_CHARGE_FAILED).toBe(402);
  });

  it('maps INTERNAL_SERVER_ERROR to 500', () => {
    expect(ERROR_HTTP_STATUS_MAP.INTERNAL_SERVER_ERROR).toBe(500);
  });

  it('maps VALIDATION_ERROR to 422', () => {
    expect(ERROR_HTTP_STATUS_MAP.VALIDATION_ERROR).toBe(422);
  });

  it('maps WEBHOOK_PAYLOAD_TOO_LARGE to 413', () => {
    expect(ERROR_HTTP_STATUS_MAP.WEBHOOK_PAYLOAD_TOO_LARGE).toBe(413);
  });

  it('maps COUPON_EXPIRED to 410', () => {
    expect(ERROR_HTTP_STATUS_MAP.COUPON_EXPIRED).toBe(410);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Header constants
// ─────────────────────────────────────────────────────────────────────────────

describe('Header constants', () => {
  it('exports API_VERSION_HEADER', () => {
    expect(API_VERSION_HEADER).toBe('X-API-Version');
  });

  it('exports API_VERSION_VALUE as "1"', () => {
    expect(API_VERSION_VALUE).toBe('1');
  });

  it('exports REQUEST_ID_HEADER', () => {
    expect(REQUEST_ID_HEADER).toBe('X-Request-ID');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Type-level: ApiResponse discriminated union
// ─────────────────────────────────────────────────────────────────────────────

describe('ApiResponse discriminated union', () => {
  it('narrows to ApiSuccessResponse when success is true', () => {
    const res: ApiResponse<number> = ok(42);
    if (res.success) {
      // TypeScript should allow res.data here
      expect(res.data).toBe(42);
    }
  });

  it('narrows to ApiErrorResponse when success is false', () => {
    const res: ApiResponse<number> = fail('NOT_FOUND', 'not found');
    if (!res.success) {
      expect(res.error.code).toBe('NOT_FOUND');
    }
  });
});
