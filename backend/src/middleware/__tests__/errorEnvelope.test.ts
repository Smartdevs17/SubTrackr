import {
  AppError,
  WorkerJobError,
  buildErrorEnvelope,
  defaultCodeForStatus,
  errorEnvelopeHandler,
  isRetryableStatus,
  normalizeError,
  notFoundEnvelopeHandler,
  sendError,
  serializeWorkerError,
  workerErrorToEnvelope,
} from '../errorEnvelope';

function makeRes(headersSent = false) {
  const res: any = { headersSent, headers: {} as Record<string, string> };
  res.status = jest.fn((c: number) => {
    res.code = c;
    return res;
  });
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn((k: string, v: string) => {
    res.headers[k] = v;
  });
  return res;
}
const req = (headers: Record<string, string> = {}) =>
  ({ headers, path: '/x', method: 'GET' }) as any;

describe('buildErrorEnvelope', () => {
  it('has the canonical shape', () => {
    const e = buildErrorEnvelope(404, 'nope', { requestId: 'r1' });
    expect(e).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'nope' },
      meta: { timestamp: expect.any(String), requestId: 'r1', apiVersion: 1 },
    });
  });

  it('includes details and custom codes', () => {
    const e = buildErrorEnvelope(422, 'bad', { code: 'X', details: { amount: 'must be > 0' } });
    expect(e.error).toEqual({ code: 'X', message: 'bad', details: { amount: 'must be > 0' } });
  });

  it('generates a request id when none is supplied', () => {
    expect(buildErrorEnvelope(400, 'm').meta.requestId).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('status helpers', () => {
  it('maps known and unknown statuses', () => {
    expect(defaultCodeForStatus(429)).toBe('RATE_LIMIT_EXCEEDED');
    expect(defaultCodeForStatus(418)).toBe('BAD_REQUEST');
    expect(defaultCodeForStatus(599)).toBe('INTERNAL_SERVER_ERROR');
  });
  it('classifies retryable statuses', () => {
    expect([408, 429, 500, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 404, 409, 422].some(isRetryableStatus)).toBe(false);
  });
});

describe('normalizeError', () => {
  it('keeps AppError fields', () => {
    expect(normalizeError(new AppError(409, 'dup', 'DUP'))).toMatchObject({ status: 409, code: 'DUP' });
  });
  it('hides internals of unknown errors', () => {
    const n = normalizeError(new Error('select * from users where password=...'));
    expect(n).toEqual({ status: 500, message: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' });
  });
});

describe('sendError', () => {
  it('echoes a supplied request id in header and body', () => {
    const res = makeRes();
    sendError(req({ 'x-request-id': 'abc' }), res, 400, 'bad');
    expect(res.headers['X-Request-Id']).toBe('abc');
    expect(res.json.mock.calls[0][0].meta.requestId).toBe('abc');
  });
  it('ignores oversized request ids', () => {
    const res = makeRes();
    sendError(req({ 'x-request-id': 'a'.repeat(200) }), res, 400, 'bad');
    expect(res.headers['X-Request-Id']).not.toHaveLength(200);
  });
});

describe('errorEnvelopeHandler', () => {
  it('renders AppError without logging', () => {
    const log = jest.fn();
    const res = makeRes();
    errorEnvelopeHandler(log)(new AppError(404, 'missing'), req(), res, jest.fn());
    expect(res.code).toBe(404);
    expect(res.json.mock.calls[0][0].error.code).toBe('NOT_FOUND');
    expect(log).not.toHaveBeenCalled();
  });
  it('logs and masks unexpected errors', () => {
    const log = jest.fn();
    const res = makeRes();
    errorEnvelopeHandler(log)(new Error('secret'), req(), res, jest.fn());
    expect(res.code).toBe(500);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('secret');
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ error: 'secret' }));
  });
  it('delegates when headers were already sent', () => {
    const next = jest.fn();
    const err = new Error('late');
    errorEnvelopeHandler()(err, req(), makeRes(true), next);
    expect(next).toHaveBeenCalledWith(err);
  });
  it('notFound handler returns a 404 envelope', () => {
    const res = makeRes();
    notFoundEnvelopeHandler(req(), res);
    expect(res.code).toBe(404);
    expect(res.json.mock.calls[0][0].error.message).toContain('GET /x');
  });
});

describe('worker boundary', () => {
  it('serialises WorkerJobError', () => {
    expect(serializeWorkerError(new WorkerJobError('bad card', 'CARD_DECLINED', false))).toEqual({
      code: 'CARD_DECLINED',
      message: 'bad card',
      retryable: false,
    });
  });
  it('derives retryability for AppError', () => {
    expect(serializeWorkerError(new AppError(503, 'down')).retryable).toBe(true);
    expect(serializeWorkerError(new AppError(422, 'no')).retryable).toBe(false);
  });
  it('treats unknown throwables as retryable JOB_FAILED', () => {
    expect(serializeWorkerError('boom')).toEqual({ code: 'JOB_FAILED', message: 'boom', retryable: true });
  });
  it('converts a worker payload to the REST envelope', () => {
    const e = workerErrorToEnvelope({ code: 'C', message: 'm', retryable: false, details: { a: 'b' } }, 'r');
    expect(e.error).toEqual({ code: 'C', message: 'm', details: { a: 'b' } });
    expect(e.meta.requestId).toBe('r');
  });
});
