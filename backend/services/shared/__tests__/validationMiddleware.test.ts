import { z } from 'zod';
import {
  createValidationMiddleware,
  validateRequest,
  commonSchemas,
} from '../validationMiddleware';

describe('validationMiddleware (#1786 Request Validation Middleware)', () => {
  const sampleBodySchema = z.object({
    name: z.string().min(2),
    price: z.number().positive(),
    currency: z.string().length(3),
  });

  const sampleQuerySchema = z.object({
    limit: z.coerce.number().min(1).max(100).default(20),
    search: z.string().optional(),
  });

  const sampleParamsSchema = z.object({
    id: z.string().min(1),
  });

  describe('validateRequest function', () => {
    it('succeeds with valid body, query, and params', () => {
      const data = {
        body: { name: 'Pro Plan', price: 29.99, currency: 'USD' },
        query: { limit: '10', search: 'pro' },
        params: { id: 'plan_123' },
      };

      const result = validateRequest(data, {
        body: sampleBodySchema,
        query: sampleQuerySchema,
        params: sampleParamsSchema,
      });

      expect(result.success).toBe(true);
      expect(result.data?.body).toEqual({ name: 'Pro Plan', price: 29.99, currency: 'USD' });
      expect(result.data?.query).toEqual({ limit: 10, search: 'pro' });
      expect(result.data?.params).toEqual({ id: 'plan_123' });
    });

    it('returns field-level errors when body fails validation', () => {
      const data = {
        body: { name: 'A', price: -5, currency: 'TOOLONG' },
      };

      const result = validateRequest(data, {
        body: sampleBodySchema,
      });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThanOrEqual(3);
      const fields = result.errors?.map((e) => e.field);
      expect(fields).toContain('body.name');
      expect(fields).toContain('body.price');
      expect(fields).toContain('body.currency');
    });

    it('detects SQL injection and rejects', () => {
      const data = {
        body: { name: "admin'; DROP TABLE plans; --", price: 10, currency: 'USD' },
      };

      const result = validateRequest(
        data,
        { body: sampleBodySchema },
        { detectSqlInjection: true }
      );

      expect(result.success).toBe(false);
      expect(result.errors?.[0]?.code).toBe('SQL_INJECTION_DETECTED');
    });

    it('sanitizes XSS strings by default', () => {
      const data = {
        body: { name: '<b>Plan</b>', price: 10, currency: 'USD' },
      };

      const result = validateRequest(
        data,
        { body: sampleBodySchema },
        { sanitizeXss: true }
      );

      expect(result.success).toBe(true);
      expect((result.data?.body as any).name).toBe('Plan');
    });
  });

  describe('createValidationMiddleware Express-style middleware', () => {
    it('passes valid request through to next()', () => {
      const middleware = createValidationMiddleware({
        body: sampleBodySchema,
      });

      const req: any = {
        method: 'POST',
        headers: { 'x-request-id': 'req-test-1' },
        body: { name: 'Enterprise', price: 99.99, currency: 'USD' },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 422 with standard error envelope when validation fails (Express style)', () => {
      const middleware = createValidationMiddleware({
        body: sampleBodySchema,
      });

      const req: any = {
        method: 'POST',
        headers: { 'x-request-id': 'req-err-1' },
        body: { name: 'X', price: -10, currency: 'US' },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: expect.any(Object),
          }),
          meta: expect.objectContaining({
            requestId: 'req-err-1',
            apiVersion: 1,
          }),
        })
      );
    });

    it('returns 422 using writeHead/end for raw Node http.ServerResponse', () => {
      const middleware = createValidationMiddleware({
        body: sampleBodySchema,
      });

      const req: any = {
        method: 'POST',
        body: { name: 'X', price: -10, currency: 'US' },
      };
      let writtenStatus = 0;
      let writtenBody = '';
      const res: any = {
        writeHead: jest.fn((code: number) => {
          writtenStatus = code;
        }),
        end: jest.fn((bodyStr: string) => {
          writtenBody = bodyStr;
        }),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(writtenStatus).toBe(422);
      const parsed = JSON.parse(writtenBody);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 413 when body exceeds maxBodySize limit', () => {
      const middleware = createValidationMiddleware(
        { body: sampleBodySchema },
        { maxBodySize: 50 }
      );

      const req: any = {
        method: 'POST',
        body: { name: 'A very large plan name that is definitely way too long to fit', price: 10, currency: 'USD' },
      };
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'BAD_REQUEST',
          }),
        })
      );
    });
  });
});
