import { Request, Response } from 'express';
import crypto from 'crypto';
import { createWebhookSignatureMiddleware } from '../webhookSignatureMiddleware';
import { WebhookSecret } from '../../../../src/types/webhook';

describe('createWebhookSignatureMiddleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    req = {
      headers: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  const signPayload = (payload: string, secret: string, includePrefix = false) => {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(Buffer.from(payload, 'utf8'));
    const hex = hmac.digest('hex');
    return includePrefix ? `sha256=${hex}` : hex;
  };

  it('should return 401 if signature header is missing', async () => {
    const middleware = createWebhookSignatureMiddleware({
      secrets: [{ key: 'secret', validFrom: 0, createdAt: 0 }],
    });

    await middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing X-SubTrackr-Signature header' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 500 if raw body is missing', async () => {
    req.headers!['x-subtrackr-signature'] = 'dummy-signature';
    
    const middleware = createWebhookSignatureMiddleware({
      secrets: [{ key: 'secret', validFrom: 0, createdAt: 0 }],
    });

    await middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Raw request body not available for signature verification' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should verify valid signature correctly without prefix', async () => {
    const payload = JSON.stringify({ event: 'test' });
    const secret = 'my-secret-key';
    const signature = signPayload(payload, secret);

    req.headers!['x-subtrackr-signature'] = signature;
    (req as any).rawBody = payload;

    const middleware = createWebhookSignatureMiddleware({
      secrets: [{ key: secret, validFrom: 0, createdAt: 0 }],
    });

    await middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(); // success
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should verify valid signature correctly with sha256= prefix', async () => {
    const payload = JSON.stringify({ event: 'test' });
    const secret = 'my-secret-key';
    const signature = signPayload(payload, secret, true); // sha256=...

    req.headers!['x-subtrackr-signature'] = signature;
    (req as any).rawBody = payload;

    const middleware = createWebhookSignatureMiddleware({
      secrets: [{ key: secret, validFrom: 0, createdAt: 0 }],
    });

    await middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(); // success
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 401 for an invalid signature', async () => {
    const payload = JSON.stringify({ event: 'test' });
    const signature = signPayload(payload, 'wrong-secret');

    req.headers!['x-subtrackr-signature'] = signature;
    (req as any).rawBody = payload;

    const middleware = createWebhookSignatureMiddleware({
      secrets: [{ key: 'my-secret-key', validFrom: 0, createdAt: 0 }],
    });

    await middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid webhook signature' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should support dynamic retrieval of secrets for key rotation', async () => {
    const payload = JSON.stringify({ event: 'test' });
    const secret1 = 'old-secret-key';
    const secret2 = 'new-secret-key';
    const signatureForOld = signPayload(payload, secret1);

    req.headers!['x-subtrackr-signature'] = signatureForOld;
    (req as any).rawBody = payload;

    // Both secrets valid (during rotation overlap)
    const getSecrets = jest.fn().mockResolvedValue([
      { key: secret1, validFrom: 0, createdAt: 0 },
      { key: secret2, validFrom: 0, createdAt: 0 }
    ]);

    const middleware = createWebhookSignatureMiddleware({ secrets: getSecrets });

    await middleware(req as Request, res as Response, next);

    expect(getSecrets).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(); // Should succeed with old secret
  });

  it('should ignore secrets that are expired or not yet valid', async () => {
    const payload = JSON.stringify({ event: 'test' });
    const secretExpired = 'expired-key';
    const signature = signPayload(payload, secretExpired);

    req.headers!['x-subtrackr-signature'] = signature;
    (req as any).rawBody = payload;

    const now = Date.now();
    const secrets: WebhookSecret[] = [
      { key: secretExpired, validFrom: 0, validUntil: now - 10000, createdAt: 0 }, // expired
      { key: 'future-key', validFrom: now + 10000, createdAt: 0 }, // not valid yet
    ];

    const middleware = createWebhookSignatureMiddleware({ secrets });

    await middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No valid webhook secrets configured' });
  });

  it('should allow custom header name and raw body extractor', async () => {
    const payload = Buffer.from(JSON.stringify({ event: 'test' }), 'utf8');
    const secret = 'secret-key';
    const signature = signPayload(payload.toString('utf8'), secret);

    req.headers!['x-custom-signature'] = signature;
    (req as any).customRawBody = payload; // Custom location

    const middleware = createWebhookSignatureMiddleware({
      secrets: [{ key: secret, validFrom: 0, createdAt: 0 }],
      headerName: 'X-Custom-Signature',
      getRawBody: (req) => (req as any).customRawBody,
    });

    await middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith();
  });
});
