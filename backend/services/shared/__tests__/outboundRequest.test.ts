import {
  outboundRequest,
  isIdempotentMethod,
  isIdempotentRequest,
  OutboundTimeoutError,
} from '../outboundRequest';

describe('outboundRequest', () => {
  const fakeSleep = jest.fn(async () => {});

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('idempotency checks', () => {
    it('identifies standard HTTP idempotent methods', () => {
      expect(isIdempotentMethod('GET')).toBe(true);
      expect(isIdempotentMethod('get')).toBe(true);
      expect(isIdempotentMethod('PUT')).toBe(true);
      expect(isIdempotentMethod('DELETE')).toBe(true);
      expect(isIdempotentMethod('HEAD')).toBe(true);
      expect(isIdempotentMethod('OPTIONS')).toBe(true);
      expect(isIdempotentMethod('POST')).toBe(false);
      expect(isIdempotentMethod('PATCH')).toBe(false);
    });

    it('considers requests with Idempotency-Key headers safe to retry', () => {
      expect(isIdempotentRequest({ method: 'POST' })).toBe(false);
      expect(
        isIdempotentRequest({
          method: 'POST',
          headers: { 'idempotency-key': 'key-123' },
        }),
      ).toBe(true);
      expect(
        isIdempotentRequest({
          method: 'PATCH',
          headers: { 'X-Idempotency-Key': 'key-456' },
        }),
      ).toBe(true);
    });
  });

  describe('timeouts', () => {
    it('aborts and throws OutboundTimeoutError when request hangs beyond timeout', async () => {
      const slowFetch = jest.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      await expect(
        outboundRequest('https://api.external.com/hang', {
          timeoutMs: 50,
          maxRetries: 1,
          fetchImpl: slowFetch as unknown as typeof fetch,
        }),
      ).rejects.toThrow(OutboundTimeoutError);
    });
  });

  describe('bounded retries', () => {
    it('retries idempotent GET requests on transient 5xx errors up to maxRetries', async () => {
      let callCount = 0;
      const mockFetch = jest.fn(async () => {
        callCount++;
        if (callCount < 3) {
          return new Response('Internal Server Error', { status: 503 });
        }
        return new Response('{"ok":true}', { status: 200 });
      });

      const response = await outboundRequest('https://api.example.com/data', {
        method: 'GET',
        maxRetries: 3,
        sleep: fakeSleep,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect(response.status).toBe(200);
      expect(callCount).toBe(3);
      expect(fakeSleep).toHaveBeenCalledTimes(2);
    });

    it('retries POST requests when an Idempotency-Key is provided', async () => {
      let callCount = 0;
      const mockFetch = jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response('Gateway Timeout', { status: 504 });
        }
        return new Response('{"charged":true}', { status: 201 });
      });

      const response = await outboundRequest('https://api.example.com/charge', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'charge-abc-123' },
        maxRetries: 3,
        sleep: fakeSleep,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect(response.status).toBe(201);
      expect(callCount).toBe(2);
    });

    it('does NOT retry non-idempotent POST requests without idempotency keys', async () => {
      let callCount = 0;
      const mockFetch = jest.fn(async () => {
        callCount++;
        return new Response('Service Unavailable', { status: 503 });
      });

      const response = await outboundRequest('https://api.example.com/charge', {
        method: 'POST',
        maxRetries: 3,
        sleep: fakeSleep,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect(response.status).toBe(503);
      expect(callCount).toBe(1); // Exactly 1 attempt, no retry!
      expect(fakeSleep).not.toHaveBeenCalled();
    });

    it('does NOT retry client errors (400, 401, 404)', async () => {
      let callCount = 0;
      const mockFetch = jest.fn(async () => {
        callCount++;
        return new Response('Bad Request', { status: 400 });
      });

      const response = await outboundRequest('https://api.example.com/data', {
        method: 'GET',
        maxRetries: 3,
        sleep: fakeSleep,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });

      expect(response.status).toBe(400);
      expect(callCount).toBe(1);
      expect(fakeSleep).not.toHaveBeenCalled();
    });
  });
});
