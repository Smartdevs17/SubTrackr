import {
  DomainError,
  UnprocessableEntityError,
  BadGatewayError,
  isDomainError,
  fromUnknownError,
} from '../errors';

describe('Structured Error Types', () => {
  it('creates DomainError with structured fields', () => {
    const err = new DomainError('Test error', 'TEST_CODE', 400, {
      userMessage: 'Friendly user message',
      recovery: 'Try again later',
      details: { foo: 'bar' },
      requestId: 'req_123',
    });

    expect(err.message).toBe('Test error');
    expect(err.code).toBe('TEST_CODE');
    expect(err.statusCode).toBe(400);
    expect(err.userMessage).toBe('Friendly user message');
    expect(err.recovery).toBe('Try again later');
    expect(err.details).toEqual({ foo: 'bar' });
    expect(err.requestId).toBe('req_123');

    const apiRes = err.toApiResponse();
    expect(apiRes.error.code).toBe('TEST_CODE');
    expect(apiRes.error.userMessage).toBe('Friendly user message');
  });

  it('creates UnprocessableEntityError with HTTP 422', () => {
    const err = new UnprocessableEntityError('Invalid payload', { field: 'email' });
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('UNPROCESSABLE_ENTITY');
    expect(err.details).toEqual({ field: 'email' });
  });

  it('creates BadGatewayError with HTTP 502', () => {
    const err = new BadGatewayError('Upstream service failed');
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('BAD_GATEWAY');
  });

  it('identifies DomainError using isDomainError type guard', () => {
    const domainErr = new DomainError('Domain error');
    const standardErr = new Error('Standard error');

    expect(isDomainError(domainErr)).toBe(true);
    expect(isDomainError(standardErr)).toBe(false);
    expect(isDomainError(null)).toBe(false);
  });

  it('converts unknown error using fromUnknownError helper', () => {
    const nativeErr = new Error('Something broke');
    const wrapped = fromUnknownError(nativeErr, 'WRAPPED_CODE', 500, 'req_999');

    expect(wrapped).toBeInstanceOf(DomainError);
    expect(wrapped.message).toBe('Something broke');
    expect(wrapped.code).toBe('WRAPPED_CODE');
    expect(wrapped.requestId).toBe('req_999');
  });
});
