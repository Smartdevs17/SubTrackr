import {
  generateWebhookSignature,
  timingSafeCompare,
  parseSignatureHeader,
  verifyWebhookSignature,
  WebhookHmacValidator,
  createWebhookHmacMiddleware,
} from '../hmacValidator';

describe('Webhook HMAC Validator Helper', () => {
  const secret = 'whsec_test_secret_key_12345';
  const rotatedSecret = 'whsec_test_secret_key_67890';
  const samplePayload = JSON.stringify({ event: 'invoice.payment_succeeded', amount: 4999 });

  describe('generateWebhookSignature', () => {
    test('generates expected signature and header string format', () => {
      const ts = 1670000000;
      const res = generateWebhookSignature(samplePayload, secret, { timestamp: ts });
      expect(res.timestamp).toBe(ts);
      expect(res.signature).toBeDefined();
      expect(res.headerValue).toBe(`t=${ts},v1=${res.signature}`);
    });

    test('supports custom encoding and version', () => {
      const ts = 1670000000;
      const res = generateWebhookSignature(samplePayload, secret, {
        timestamp: ts,
        version: 'v2',
        encoding: 'base64',
      });
      expect(res.headerValue).toContain('v2=');
      expect(res.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
  });

  describe('timingSafeCompare', () => {
    test('returns true for identical signatures', () => {
      expect(timingSafeCompare('a1b2c3d4', 'a1b2c3d4')).toBe(true);
    });

    test('returns false for mismatched signatures or different lengths', () => {
      expect(timingSafeCompare('a1b2c3d4', 'a1b2c3d5')).toBe(false);
      expect(timingSafeCompare('a1b2c3d4', 'a1b2')).toBe(false);
    });

    test('handles invalid inputs gracefully without throwing', () => {
      expect(timingSafeCompare('', 'a1b2c3')).toBe(false);
    });
  });

  describe('parseSignatureHeader', () => {
    test('parses Stripe-like header correctly', () => {
      const header = 't=1670000000,v1=sig123,v1=sig456';
      const parsed = parseSignatureHeader(header);
      expect(parsed.timestamp).toBe(1670000000);
      expect(parsed.signatures['v1']).toEqual(['sig123', 'sig456']);
    });

    test('handles empty or malformed header gracefully', () => {
      expect(parseSignatureHeader('')).toEqual({ signatures: {} });
      expect(parseSignatureHeader('malformed_without_equals')).toEqual({ signatures: {} });
    });
  });

  describe('verifyWebhookSignature', () => {
    test('verifies valid signature successfully', () => {
      const ts = Math.floor(Date.now() / 1000);
      const generated = generateWebhookSignature(samplePayload, secret, { timestamp: ts });
      const result = verifyWebhookSignature(samplePayload, generated.headerValue, secret);
      expect(result.isValid).toBe(true);
      expect(result.timestamp).toBe(ts);
    });

    test('rejects signature if payload is tampered with', () => {
      const ts = Math.floor(Date.now() / 1000);
      const generated = generateWebhookSignature(samplePayload, secret, { timestamp: ts });
      const tamperedPayload = JSON.stringify({ event: 'invoice.payment_succeeded', amount: 0 });
      const result = verifyWebhookSignature(tamperedPayload, generated.headerValue, secret);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Signature mismatch');
    });

    test('rejects expired timestamp outside tolerance window', () => {
      const oldTs = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const generated = generateWebhookSignature(samplePayload, secret, { timestamp: oldTs });
      const result = verifyWebhookSignature(samplePayload, generated.headerValue, secret, { timestampTolerance: 300 });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('outside allowed tolerance');
    });

    test('verifies signature using rotated key in candidate secret list', () => {
      const ts = Math.floor(Date.now() / 1000);
      const generated = generateWebhookSignature(samplePayload, rotatedSecret, { timestamp: ts });
      const result = verifyWebhookSignature(samplePayload, generated.headerValue, [secret, rotatedSecret]);
      expect(result.isValid).toBe(true);
      expect(result.matchedSecretIndex).toBe(1);
    });

    test('verifies raw signature header without timestamp', () => {
      const crypto = require('crypto');
      const rawSig = crypto.createHmac('sha256', secret).update(samplePayload).digest('hex');
      const result = verifyWebhookSignature(samplePayload, rawSig, secret);
      expect(result.isValid).toBe(true);
    });

    test('rejects missing header or secret', () => {
      expect(verifyWebhookSignature(samplePayload, '', secret).isValid).toBe(false);
      expect(verifyWebhookSignature(samplePayload, 'sig', '').isValid).toBe(false);
    });
  });

  describe('WebhookHmacValidator Class', () => {
    test('instantiates and performs generation and verification', () => {
      const validator = new WebhookHmacValidator(secret);
      const generated = validator.generate(samplePayload);
      const result = validator.verify(samplePayload, generated.headerValue);
      expect(result.isValid).toBe(true);
    });
  });

  describe('createWebhookHmacMiddleware', () => {
    test('passes valid requests to next middleware', async () => {
      const middleware = createWebhookHmacMiddleware(secret);
      const ts = Math.floor(Date.now() / 1000);
      const generated = generateWebhookSignature(samplePayload, secret, { timestamp: ts });

      const req: any = {
        headers: { 'x-webhook-signature': generated.headerValue },
        rawBody: samplePayload,
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.webhookVerified).toBe(true);
    });

    test('returns 401 when signature header is missing', async () => {
      const middleware = createWebhookHmacMiddleware(secret);
      const req: any = { headers: {}, rawBody: samplePayload };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('returns 401 when signature is invalid', async () => {
      const middleware = createWebhookHmacMiddleware(secret);
      const req: any = {
        headers: { 'x-webhook-signature': 'invalid_sig' },
        rawBody: samplePayload,
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('supports dynamic async secret provider function', async () => {
      const secretProvider = jest.fn().mockResolvedValue(secret);
      const middleware = createWebhookHmacMiddleware(secretProvider);
      const ts = Math.floor(Date.now() / 1000);
      const generated = generateWebhookSignature(samplePayload, secret, { timestamp: ts });

      const req: any = {
        headers: { 'x-webhook-signature': generated.headerValue },
        body: samplePayload,
      };
      const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(secretProvider).toHaveBeenCalledWith(req);
      expect(next).toHaveBeenCalled();
    });
  });
});
