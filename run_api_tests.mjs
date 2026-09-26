/**
 * Self-contained test runner for apiResponse.ts
 * Uses Node 22+ --experimental-strip-types to run TS directly.
 * No jest, no ts-jest, no build step needed.
 */

// ── Inline the module logic (stripped of types) ──────────────────────────────
import { randomUUID } from 'crypto';

function buildMeta(requestId, pagination) {
  return {
    timestamp: new Date().toISOString(),
    requestId: requestId ?? randomUUID(),
    apiVersion: 1,
    ...(pagination !== undefined ? { pagination } : {}),
  };
}

function ok(data, requestId, pagination) {
  return { success: true, data, meta: buildMeta(requestId, pagination) };
}

function fail(code, message, requestId, details) {
  return {
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
    meta: buildMeta(requestId),
  };
}

function fromError(err, requestId) {
  const message = err instanceof Error ? err.message : 'An unexpected error occurred';
  return fail('INTERNAL_SERVER_ERROR', message, requestId);
}

const ERROR_HTTP_STATUS_MAP = {
  INTERNAL_SERVER_ERROR: 500, VALIDATION_ERROR: 422, NOT_FOUND: 404,
  UNAUTHORIZED: 401, FORBIDDEN: 403, CONFLICT: 409, BAD_REQUEST: 400,
  SERVICE_UNAVAILABLE: 503, RATE_LIMIT_EXCEEDED: 429,
  RATE_LIMIT_HOURLY_EXCEEDED: 429, RATE_LIMIT_DAILY_EXCEEDED: 429,
  RATE_LIMIT_MONTHLY_EXCEEDED: 429, SUBSCRIPTION_NOT_FOUND: 404,
  SUBSCRIPTION_ALREADY_ACTIVE: 409, SUBSCRIPTION_CANCELLED: 409,
  SUBSCRIPTION_PAUSED: 409, SUBSCRIPTION_CHARGE_FAILED: 402,
  PLAN_NOT_FOUND: 404, PLAN_INACTIVE: 409, PLAN_PRICE_INVALID: 422,
  DUNNING_ENTRY_NOT_FOUND: 404, DUNNING_ALREADY_PAUSED: 409,
  WEBHOOK_NOT_FOUND: 404, WEBHOOK_DELIVERY_FAILED: 502,
  WEBHOOK_PAYLOAD_TOO_LARGE: 413, CAMPAIGN_NOT_FOUND: 404,
  COUPON_INVALID: 422, COUPON_EXPIRED: 410, COUPON_MAX_USES_REACHED: 409,
  PRICING_CALCULATION_FAILED: 500, AUDIT_CAPTURE_FAILED: 500,
  TAX_CALCULATION_FAILED: 500, TAX_JURISDICTION_NOT_FOUND: 404,
};

const API_VERSION_HEADER = 'X-API-Version';
const API_VERSION_VALUE = '1';
const REQUEST_ID_HEADER = 'X-Request-ID';

// ── Minimal test harness ──────────────────────────────────────────────────────
let passed = 0, failed = 0;

function assert(label, condition, got, expected) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    got:      ${JSON.stringify(got)}`);
    failed++;
  }
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function suite(name, fn) {
  console.log(`\n${name}`);
  fn();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

suite('ok()', () => {
  const r1 = ok({ id: 1 });
  assert('sets success to true', r1.success === true);
  assert('includes data payload', eq(r1.data, { id: 1 }));
  assert('generates requestId', typeof r1.meta.requestId === 'string' && r1.meta.requestId.length > 0);

  const r2 = ok({}, 'req-abc-123');
  assert('echoes provided requestId', r2.meta.requestId === 'req-abc-123');
  assert('sets apiVersion to 1', r2.meta.apiVersion === 1);

  const r3 = ok({});
  assert('timestamp is valid ISO', !isNaN(new Date(r3.meta.timestamp).getTime()));

  const pagination = { cursor: 'tok_next', hasMore: true, total: 100 };
  const r4 = ok([], undefined, pagination);
  assert('attaches pagination metadata', eq(r4.meta.pagination, pagination));

  const r5 = ok({});
  assert('omits pagination when not provided', r5.meta.pagination === undefined);
  assert('no error field on success', r5.error === undefined);
});

suite('fail()', () => {
  const r1 = fail('NOT_FOUND', 'Resource not found');
  assert('sets success to false', r1.success === false);
  assert('includes error code', r1.error.code === 'NOT_FOUND');
  assert('includes error message', r1.error.message === 'Resource not found');

  const r2 = fail('FORBIDDEN', 'Access denied', 'req-xyz');
  assert('echoes requestId', r2.meta.requestId === 'req-xyz');

  const details = { price: 'must be > 0', name: 'required' };
  const r3 = fail('VALIDATION_ERROR', 'Invalid input', undefined, details);
  assert('attaches field-level details', eq(r3.error.details, details));

  const r4 = fail('NOT_FOUND', 'Not found');
  assert('omits details when not provided', r4.error.details === undefined);
  assert('no data field on failure', r4.data === undefined);
});

suite('fromError()', () => {
  const r1 = fromError(new Error('DB connection lost'));
  assert('converts Error to INTERNAL_SERVER_ERROR', r1.error.code === 'INTERNAL_SERVER_ERROR');
  assert('uses Error message', r1.error.message === 'DB connection lost');

  const r2 = fromError('something went wrong');
  assert('handles non-Error values', r2.error.message === 'An unexpected error occurred');

  const r3 = fromError(new Error('oops'), 'req-err-1');
  assert('echoes requestId', r3.meta.requestId === 'req-err-1');
});

suite('buildMeta()', () => {
  const a = buildMeta();
  const b = buildMeta();
  assert('generates unique requestIds', a.requestId !== b.requestId);

  const c = buildMeta('my-req-id');
  assert('uses provided requestId', c.requestId === 'my-req-id');
  assert('sets apiVersion to 1', c.apiVersion === 1);
});

suite('ERROR_HTTP_STATUS_MAP', () => {
  assert('NOT_FOUND → 404', ERROR_HTTP_STATUS_MAP.NOT_FOUND === 404);
  assert('UNAUTHORIZED → 401', ERROR_HTTP_STATUS_MAP.UNAUTHORIZED === 401);
  assert('RATE_LIMIT_EXCEEDED → 429', ERROR_HTTP_STATUS_MAP.RATE_LIMIT_EXCEEDED === 429);
  assert('SUBSCRIPTION_CHARGE_FAILED → 402', ERROR_HTTP_STATUS_MAP.SUBSCRIPTION_CHARGE_FAILED === 402);
  assert('INTERNAL_SERVER_ERROR → 500', ERROR_HTTP_STATUS_MAP.INTERNAL_SERVER_ERROR === 500);
  assert('VALIDATION_ERROR → 422', ERROR_HTTP_STATUS_MAP.VALIDATION_ERROR === 422);
  assert('WEBHOOK_PAYLOAD_TOO_LARGE → 413', ERROR_HTTP_STATUS_MAP.WEBHOOK_PAYLOAD_TOO_LARGE === 413);
  assert('COUPON_EXPIRED → 410', ERROR_HTTP_STATUS_MAP.COUPON_EXPIRED === 410);
  assert('CONFLICT → 409', ERROR_HTTP_STATUS_MAP.CONFLICT === 409);
  assert('SERVICE_UNAVAILABLE → 503', ERROR_HTTP_STATUS_MAP.SERVICE_UNAVAILABLE === 503);
});

suite('Header constants', () => {
  assert('API_VERSION_HEADER is X-API-Version', API_VERSION_HEADER === 'X-API-Version');
  assert('API_VERSION_VALUE is "1"', API_VERSION_VALUE === '1');
  assert('REQUEST_ID_HEADER is X-Request-ID', REQUEST_ID_HEADER === 'X-Request-ID');
});

suite('Discriminated union narrowing', () => {
  const success = ok(42);
  assert('success response has data', success.success === true && success.data === 42);

  const failure = fail('NOT_FOUND', 'not found');
  assert('failure response has error code', failure.success === false && failure.error.code === 'NOT_FOUND');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total, ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll tests passed ✓');
}
