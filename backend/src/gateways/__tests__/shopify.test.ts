import crypto from 'crypto';
import {
  verifyShopifyWebhook,
  shopifyWebhookMiddleware,
  SHOPIFY_HMAC_HEADER,
  SHOPIFY_TRIGGERED_AT_HEADER,
  SHOPIFY_WEBHOOK_ID_HEADER,
  SHOPIFY_TOPIC_HEADER,
  TIMESTAMP_TOLERANCE_SECONDS,
} from '../shopify';
import type { Request, Response, NextFunction } from 'express';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SECRET = 'test-shopify-webhook-secret';
const NOW_MS = 1_700_000_000_000; // 2023-11-14T22:13:20Z
const NOW_ISO = new Date(NOW_MS).toISOString();

function makeHmac(body: string | Buffer, secret = SECRET): string {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return crypto.createHmac('sha256', secret).update(payload).digest('base64');
}

function makeHeaders(
  body: string | Buffer,
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    [SHOPIFY_HMAC_HEADER]: makeHmac(body),
    [SHOPIFY_TRIGGERED_AT_HEADER]: NOW_ISO,
    [SHOPIFY_WEBHOOK_ID_HEADER]: 'wh-id-123',
    [SHOPIFY_TOPIC_HEADER]: 'orders/paid',
    ...overrides,
  };
}

// ── verifyShopifyWebhook ──────────────────────────────────────────────────────

describe('verifyShopifyWebhook', () => {
  const body = JSON.stringify({ id: 1, status: 'paid' });

  it('returns valid:true for a correct signature', () => {
    const result = verifyShopifyWebhook(body, makeHeaders(body), SECRET, { nowMs: NOW_MS });
    expect(result.valid).toBe(true);
    expect(result.webhookId).toBe('wh-id-123');
    expect(result.topic).toBe('orders/paid');
    expect(result.triggeredAt).toEqual(new Date(NOW_ISO));
  });

  it('accepts a Buffer body', () => {
    const buf = Buffer.from(body, 'utf8');
    const result = verifyShopifyWebhook(buf, makeHeaders(buf), SECRET, { nowMs: NOW_MS });
    expect(result.valid).toBe(true);
  });

  it('rejects when HMAC header is missing', () => {
    const result = verifyShopifyWebhook(
      body,
      makeHeaders(body, { [SHOPIFY_HMAC_HEADER]: undefined }),
      SECRET,
      { nowMs: NOW_MS },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('rejects when triggered-at header is missing', () => {
    const result = verifyShopifyWebhook(
      body,
      makeHeaders(body, { [SHOPIFY_TRIGGERED_AT_HEADER]: undefined }),
      SECRET,
      { nowMs: NOW_MS },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/missing/i);
  });

  it('rejects an unparseable triggered-at value', () => {
    const result = verifyShopifyWebhook(
      body,
      makeHeaders(body, { [SHOPIFY_TRIGGERED_AT_HEADER]: 'not-a-date' }),
      SECRET,
      { nowMs: NOW_MS },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/unparseable/i);
  });

  it('rejects a webhook older than the tolerance window', () => {
    const staleMs = NOW_MS + (TIMESTAMP_TOLERANCE_SECONDS + 10) * 1000;
    const result = verifyShopifyWebhook(body, makeHeaders(body), SECRET, { nowMs: staleMs });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too old/i);
  });

  it('rejects a webhook more than 60 s in the future', () => {
    const futureMs = NOW_MS - 120_000;
    const result = verifyShopifyWebhook(body, makeHeaders(body), SECRET, { nowMs: futureMs });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/future/i);
  });

  it('rejects a tampered body', () => {
    const tampered = JSON.stringify({ id: 2, status: 'paid' });
    const result = verifyShopifyWebhook(tampered, makeHeaders(body), SECRET, { nowMs: NOW_MS });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/hmac/i);
  });

  it('rejects a signature from the wrong secret', () => {
    const result = verifyShopifyWebhook(
      body,
      makeHeaders(body, { [SHOPIFY_HMAC_HEADER]: makeHmac(body, 'wrong-secret') }),
      SECRET,
      { nowMs: NOW_MS },
    );
    expect(result.valid).toBe(false);
  });

  it('honours a custom toleranceSeconds override', () => {
    // 10 s old, but tolerance set to 5 s → reject
    const justOverMs = NOW_MS + 10_000;
    const result = verifyShopifyWebhook(body, makeHeaders(body), SECRET, {
      nowMs: justOverMs,
      toleranceSeconds: 5,
    });
    expect(result.valid).toBe(false);
  });
});

// ── shopifyWebhookMiddleware ──────────────────────────────────────────────────

function makeReq(body: Buffer | undefined, headers: Record<string, string | undefined> = {}): Request {
  return { body, headers } as unknown as Request;
}

function makeRes(): { res: Response; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

describe('shopifyWebhookMiddleware', () => {
  const body = Buffer.from(JSON.stringify({ event: 'test' }), 'utf8');

  it('calls next() for a valid request and attaches metadata', () => {
    const next = jest.fn() as NextFunction;
    const { res } = makeRes();
    const req = makeReq(body, makeHeaders(body) as Record<string, string>);
    shopifyWebhookMiddleware(SECRET, { nowMs: NOW_MS })(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect((req as any).shopifyWebhook.topic).toBe('orders/paid');
  });

  it('returns 401 for invalid HMAC', () => {
    const next = jest.fn() as NextFunction;
    const { res, status } = makeRes();
    const req = makeReq(
      body,
      makeHeaders(body, { [SHOPIFY_HMAC_HEADER]: 'badsig==' }) as Record<string, string>,
    );
    shopifyWebhookMiddleware(SECRET, { nowMs: NOW_MS })(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
  });

  it('returns 400 when body is not a Buffer', () => {
    const next = jest.fn() as NextFunction;
    const { res, status } = makeRes();
    const req = makeReq(undefined, makeHeaders(body) as Record<string, string>);
    shopifyWebhookMiddleware(SECRET, { nowMs: NOW_MS })(req, res, next);
    expect(status).toHaveBeenCalledWith(400);
  });

  it('returns 500 when secret is empty', () => {
    const next = jest.fn() as NextFunction;
    const { res, status } = makeRes();
    const req = makeReq(body, makeHeaders(body) as Record<string, string>);
    shopifyWebhookMiddleware('', { nowMs: NOW_MS })(req, res, next);
    expect(status).toHaveBeenCalledWith(500);
  });
});
