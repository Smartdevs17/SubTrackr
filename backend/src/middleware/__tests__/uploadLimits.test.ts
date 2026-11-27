/** Unit tests for uploadLimitsMiddleware (Issue #2278). */

import { EventEmitter } from 'events';
import {
  uploadLimitsMiddleware,
  type UploadLimitsOptions,
} from '../uploadLimits';

class FakeRequest extends EventEmitter {
  headers: Record<string, unknown>;
  url: string;

  constructor(url: string, headers: Record<string, unknown> = {}) {
    super();
    this.url = url;
    this.headers = headers;
  }
}

class FakeResponse {
  statusCode = 200;
  body: unknown = null;
  headers: Record<string, string> = {};

  status(code: number): FakeResponse {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): void {
    this.body = body;
  }

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
}

function nextFn(): jest.Mock {
  return jest.fn();
}

function makeHeaders(length?: number | string): Record<string, unknown> {
  const h: Record<string, unknown> = {};
  if (length !== undefined) h['content-length'] = length;
  return h;
}

function run(options: UploadLimitsOptions = {}, reqHeaders?: Record<string, unknown>, url = '/uploads') {
  const req = new FakeRequest(url, reqHeaders ?? makeHeaders());
  const res = new FakeResponse();
  const next = nextFn();
  const mw = uploadLimitsMiddleware(options);
  mw(req as never, res as never, next);
  return { req, res, next };
}

describe('uploadLimitsMiddleware', () => {
  it('calls next when body is within the ceiling', () => {
    const { res, next } = run({ maxBytes: 1000 }, makeHeaders(100));
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeNull();
  });

  it('calls next when no content-length is present', () => {
    const { res, next } = run({ maxBytes: 1000 }, {});
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('rejects with 413 when content-length exceeds the ceiling', () => {
    const { res, next } = run({ maxBytes: 100 }, makeHeaders(500));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(413);
    expect((res.body as any).success).toBe(false);
    expect((res.body as any).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.headers['x-upload-limit-bytes']).toBe('100');
  });

  it('rejects when content-length is exactly at the boundary is allowed, one byte above is not', () => {
    const ok = run({ maxBytes: 100 }, makeHeaders(100));
    expect(ok.next).toHaveBeenCalledTimes(1);

    const over = run({ maxBytes: 100 }, makeHeaders(101));
    expect(over.next).not.toHaveBeenCalled();
    expect(over.res.statusCode).toBe(413);
  });

  it('handles content-length passed as an array', () => {
    const { res, next } = run({ maxBytes: 10 }, { 'content-length': ['50', '60'] } as any, '/uploads');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(413);
  });

  it('applies only to routes matched by applyTo', () => {
    const { res: matched, next: matchedNext } = run(
      { maxBytes: 10, applyTo: [/^\/uploads/] },
      makeHeaders(100),
      '/uploads/avatar',
    );
    expect(matchedNext).not.toHaveBeenCalled();
    expect(matched.statusCode).toBe(413);

    const { res: unmatched, next: unmatchedNext } = run(
      { maxBytes: 10, applyTo: [/^\/uploads/] },
      makeHeaders(100),
      '/api/users',
    );
    expect(unmatchedNext).toHaveBeenCalledTimes(1);
    expect(unmatched.statusCode).toBe(200);
  });

  it('applies only to exact path matches when applyTo is a string', () => {
    const { res: exact, next: exactNext } = run(
      { maxBytes: 10, applyTo: ['/uploads'] },
      makeHeaders(100),
      '/uploads',
    );
    expect(exactNext).not.toHaveBeenCalled();
    expect(exact.statusCode).toBe(413);

    const { res: nested, next: nestedNext } = run(
      { maxBytes: 10, applyTo: ['/uploads'] },
      makeHeaders(100),
      '/uploads/avatar',
    );
    expect(nestedNext).toHaveBeenCalledTimes(1);
    expect(nested.statusCode).toBe(200);
  });

  it('increments the rejected metric on rejection', () => {
    const before = require('../uploadLimits').uploadLimitsMetrics.rejectedTotal;
    run({ maxBytes: 10 }, makeHeaders(100));
    const after = require('../uploadLimits').uploadLimitsMetrics.rejectedTotal;
    expect(after).toBe(before + 1);
  });
});
