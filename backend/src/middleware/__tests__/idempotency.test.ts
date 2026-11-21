import type { Request, Response, NextFunction } from 'express';
import { createIdempotencyMiddleware, purgeExpiredReceipts } from '../idempotency';
import { IDEMPOTENCY_KEY_HEADER } from '../../../services/idempotencyService';

// ── Mock pg Pool ──────────────────────────────────────────────────────────────

function makePool(receipt: Record<string, unknown> | null = null) {
  const queryFn = jest.fn();

  // getReceipt SELECT → first call per test
  queryFn.mockResolvedValueOnce({ rows: receipt ? [receipt] : [] });
  // insertPending INSERT → second call
  queryFn.mockResolvedValue({ rows: [], rowCount: 0 });

  return { query: queryFn } as any;
}

// ── Express doubles ───────────────────────────────────────────────────────────

function makeReq(key: string | undefined, body: unknown = { amount: 100 }): Request {
  const headers: Record<string, string> = {};
  if (key !== undefined) headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()] = key;
  return { headers, body } as unknown as Request;
}

function makeRes() {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  const json = jest.fn().mockImplementation(() => res);
  const status = jest.fn().mockImplementation((code: number) => { statusCode = code; return res; });
  const setHeader = jest.fn().mockImplementation((k: string, v: string) => { headers[k] = v; });
  const res = { json, status, setHeader, get statusCode() { return statusCode; } } as unknown as Response;
  return { res, json, status, setHeader, headers };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createIdempotencyMiddleware', () => {
  it('passes through when no Idempotency-Key header is present', async () => {
    const pool = makePool();
    const next = jest.fn() as NextFunction;
    const { res } = makeRes();
    const req = makeReq(undefined);
    await createIdempotencyMiddleware(pool)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty Idempotency-Key', async () => {
    const pool = makePool();
    const next = jest.fn() as NextFunction;
    const { res, status } = makeRes();
    const req = makeReq('');
    await createIdempotencyMiddleware(pool)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });

  it('calls next() and inserts a pending record for a fresh key', async () => {
    const pool = makePool(null); // no existing receipt
    const next = jest.fn() as NextFunction;
    const { res } = makeRes();
    const req = makeReq('key-fresh-001');
    await createIdempotencyMiddleware(pool)(req, res, next);
    expect(next).toHaveBeenCalled();
    // First call: SELECT, second call: INSERT
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[1][0]).toMatch(/INSERT INTO idempotency_receipts/);
  });

  it('replays completed receipt with X-Idempotent-Replayed header', async () => {
    const storedResponse = { subscriptionId: 'sub_1' };
    const pool = makePool({
      key: 'key-dup',
      request_hash: require('../../../services/idempotencyService').hashRequest({ amount: 100 }),
      status: 'completed',
      response: storedResponse,
      created_at: new Date(),
      completed_at: new Date(),
    });
    const next = jest.fn() as NextFunction;
    const { res, json, setHeader } = makeRes();
    const req = makeReq('key-dup');
    await createIdempotencyMiddleware(pool)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith('X-Idempotent-Replayed', 'true');
    expect(json).toHaveBeenCalledWith(storedResponse);
  });

  it('returns 409 when the key is still pending', async () => {
    const pool = makePool({
      key: 'key-inflight',
      request_hash: require('../../../services/idempotencyService').hashRequest({ amount: 100 }),
      status: 'pending',
      response: null,
      created_at: new Date(),
      completed_at: null,
    });
    const next = jest.fn() as NextFunction;
    const { res, status } = makeRes();
    const req = makeReq('key-inflight');
    await createIdempotencyMiddleware(pool)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(409);
  });

  it('returns 422 when key was used with a different payload', async () => {
    const pool = makePool({
      key: 'key-collision',
      request_hash: 'different-hash-not-matching',
      status: 'completed',
      response: {},
      created_at: new Date(),
      completed_at: new Date(),
    });
    const next = jest.fn() as NextFunction;
    const { res, status } = makeRes();
    const req = makeReq('key-collision');
    await createIdempotencyMiddleware(pool)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(422);
  });

  it('allows retry when previous attempt failed', async () => {
    const pool = makePool({
      key: 'key-failed',
      request_hash: require('../../../services/idempotencyService').hashRequest({ amount: 100 }),
      status: 'failed',
      response: null,
      created_at: new Date(),
      completed_at: null,
    });
    const next = jest.fn() as NextFunction;
    const { res } = makeRes();
    const req = makeReq('key-failed');
    await createIdempotencyMiddleware(pool)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('degrades gracefully when DB query throws', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('DB error')) } as any;
    const next = jest.fn() as NextFunction;
    const { res } = makeRes();
    const req = makeReq('key-dberror');
    await createIdempotencyMiddleware(pool)(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('purgeExpiredReceipts', () => {
  it('calls DELETE with the window interval and returns rowCount', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rowCount: 42 }) } as any;
    const deleted = await purgeExpiredReceipts(pool);
    expect(deleted).toBe(42);
    expect(pool.query.mock.calls[0][0]).toMatch(/DELETE FROM idempotency_receipts/);
  });
});
