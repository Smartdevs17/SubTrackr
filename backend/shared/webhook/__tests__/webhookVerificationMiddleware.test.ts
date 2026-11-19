/**
 * Tests for webhook signature verification middleware.
 */

import type { Request, Response, NextFunction } from 'express';
import KeyStore from '../keyStore';
import SignatureService from '../SignatureService';
import {
  createWebhookVerificationMiddleware,
  verifyIncomingWebhookSignature,
} from '../webhookVerificationMiddleware';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeKeyStore(key = 'test-secret-key'): KeyStore {
  return new KeyStore(key);
}

function buildSignedHeader(body: string, key: string, opts?: { deltaSeconds?: number; badNonce?: boolean }) {
  const ts = Math.floor(Date.now() / 1000) + (opts?.deltaSeconds ?? 0);
  const nonce = opts?.badNonce ? 'bad' : undefined;
  const svc = new SignatureService(new KeyStore(key));
  const { header } = svc.generate(body, key, ts, nonce);
  return header;
}

function makeMockReq(overrides: Partial<Request> & { rawBody?: Buffer } = {}): Request {
  return {
    headers: {},
    ip: '127.0.0.1',
    ...overrides,
  } as unknown as Request;
}

function makeMockRes(): Response & { _status: number; _body: unknown } {
  const res = {
    _status: 200,
    _body: null as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
  return res as unknown as Response & { _status: number; _body: unknown };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createWebhookVerificationMiddleware', () => {
  const key = 'super-secret-key-32bytes-xxxxxxxxx';
  const body = JSON.stringify({ event: 'subscription.created', id: 'sub_001' });

  it('calls next() when signature is valid', async () => {
    const ks = makeKeyStore(key);
    const mw = createWebhookVerificationMiddleware(ks);
    const header = buildSignedHeader(body, key);

    const req = makeMockReq({
      headers: { 'x-subtrackr-signature': header },
      rawBody: Buffer.from(body),
    });
    const res = makeMockRes();
    const next = jest.fn() as NextFunction;

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as Request & { webhookVerified: boolean }).webhookVerified).toBe(true);
  });

  it('returns 401 when signature header is missing', async () => {
    const ks = makeKeyStore(key);
    const mw = createWebhookVerificationMiddleware(ks);

    const req = makeMockReq({ headers: {}, rawBody: Buffer.from(body) });
    const res = makeMockRes();
    const next = jest.fn() as NextFunction;

    await mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect((res._body as { error: string }).error).toBe('MISSING_SIGNATURE');
  });

  it('calls next() without verifying when optional=true and header is absent', async () => {
    const ks = makeKeyStore(key);
    const mw = createWebhookVerificationMiddleware(ks, { optional: true });

    const req = makeMockReq({ headers: {}, rawBody: Buffer.from(body) });
    const res = makeMockRes();
    const next = jest.fn() as NextFunction;

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as Request & { webhookVerified: boolean }).webhookVerified).toBe(false);
  });

  it('returns 401 with INVALID_SIGNATURE when key is wrong', async () => {
    const ks = makeKeyStore(key);
    const mw = createWebhookVerificationMiddleware(ks);
    const header = buildSignedHeader(body, 'wrong-key');

    const req = makeMockReq({
      headers: { 'x-subtrackr-signature': header },
      rawBody: Buffer.from(body),
    });
    const res = makeMockRes();
    const next = jest.fn() as NextFunction;

    await mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect((res._body as { error: string }).error).toBe('INVALID_SIGNATURE');
  });

  it('returns 401 with TIMESTAMP_OUT_OF_RANGE when timestamp is stale', async () => {
    const ks = makeKeyStore(key);
    const mw = createWebhookVerificationMiddleware(ks, { timestampTolerance: 60, clockSkewTolerance: 0 });
    // Header is from 5 minutes ago (exceeds 60s tolerance)
    const header = buildSignedHeader(body, key, { deltaSeconds: -400 });

    const req = makeMockReq({
      headers: { 'x-subtrackr-signature': header },
      rawBody: Buffer.from(body),
    });
    const res = makeMockRes();
    const next = jest.fn() as NextFunction;

    await mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect((res._body as { error: string }).error).toBe('TIMESTAMP_OUT_OF_RANGE');
  });

  it('calls onSuccess when verification passes', async () => {
    const ks = makeKeyStore(key);
    const onSuccess = jest.fn();
    const mw = createWebhookVerificationMiddleware(ks, { onSuccess });
    const header = buildSignedHeader(body, key);

    const req = makeMockReq({
      headers: { 'x-subtrackr-signature': header },
      rawBody: Buffer.from(body),
    });
    const res = makeMockRes();

    await mw(req, res, jest.fn() as NextFunction);

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('calls onFailure with reason when signature is invalid', async () => {
    const ks = makeKeyStore(key);
    const onFailure = jest.fn();
    const mw = createWebhookVerificationMiddleware(ks, { onFailure });
    const header = buildSignedHeader(body, 'wrong-key');

    const req = makeMockReq({
      headers: { 'x-subtrackr-signature': header },
      rawBody: Buffer.from(body),
    });
    const res = makeMockRes();

    await mw(req, res, jest.fn() as NextFunction);

    expect(onFailure).toHaveBeenCalledWith(expect.anything(), expect.any(String));
  });

  it('accepts a rotated key (previous key still valid during overlap)', async () => {
    const ks = makeKeyStore(key);
    const mw = createWebhookVerificationMiddleware(ks);

    // Sign with the old key, then rotate
    const header = buildSignedHeader(body, key);
    ks.rotate('new-secret-key');

    const req = makeMockReq({
      headers: { 'x-subtrackr-signature': header },
      rawBody: Buffer.from(body),
    });
    const res = makeMockRes();
    const next = jest.fn() as NextFunction;

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('falls back to JSON.stringify(body) when rawBody is absent', async () => {
    const ks = makeKeyStore(key);
    const mw = createWebhookVerificationMiddleware(ks);
    const parsedBody = { event: 'subscription.created', id: 'sub_001' };
    const canonical = JSON.stringify(parsedBody);
    const header = buildSignedHeader(canonical, key);

    const req = makeMockReq({
      headers: { 'x-subtrackr-signature': header },
      rawBody: undefined,
    });
    (req as unknown as Record<string, unknown>)['body'] = parsedBody;

    const res = makeMockRes();
    const next = jest.fn() as NextFunction;

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('verifyIncomingWebhookSignature', () => {
  const key = 'standalone-verify-key';
  const body = '{"test":true}';

  it('returns true for a valid signature', async () => {
    const ks = makeKeyStore(key);
    const svc = new SignatureService(ks);
    const { header } = svc.generate(body, key);
    const result = await verifyIncomingWebhookSignature(body, header, ks);
    expect(result).toBe(true);
  });

  it('throws for an invalid signature', async () => {
    const ks = makeKeyStore(key);
    const svc = new SignatureService(ks);
    const { header } = svc.generate(body, 'wrong-key');
    await expect(verifyIncomingWebhookSignature(body, header, ks)).rejects.toThrow();
  });
});
