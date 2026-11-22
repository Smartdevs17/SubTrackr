import { ApiError, apiErrorFromBody, parseErrorBody } from '../errors';

describe('parseErrorBody', () => {
  it('reads the canonical envelope', () => {
    expect(
      parseErrorBody(
        {
          success: false,
          error: { code: 'VALIDATION', message: 'bad', details: { amount: 'positive' } },
          meta: { requestId: 'r1', timestamp: 't', apiVersion: 1 },
        },
        'fallback'
      )
    ).toEqual({ message: 'bad', code: 'VALIDATION', details: { amount: 'positive' }, requestId: 'r1' });
  });

  it('reads the legacy { message, code } shape', () => {
    expect(parseErrorBody({ message: 'm', code: 'c' }, 'f')).toEqual({
      message: 'm',
      code: 'c',
      requestId: undefined,
    });
  });

  it('reads the legacy { error: string } shape', () => {
    expect(parseErrorBody({ error: 'oops' }, 'f').message).toBe('oops');
  });

  it('falls back for empty, null and non-object bodies', () => {
    expect(parseErrorBody({}, 'Not Found').message).toBe('Not Found');
    expect(parseErrorBody(null, 'x').message).toBe('x');
    expect(parseErrorBody('html', 'y').message).toBe('y');
    expect(parseErrorBody({ error: { message: '' } }, 'z').message).toBe('z');
  });
});

describe('apiErrorFromBody', () => {
  it('carries status, code, requestId and details', () => {
    const e = apiErrorFromBody(
      { error: { code: 'X', message: 'm', details: { a: 'b' } }, meta: { requestId: 'rid' } },
      422,
      'f'
    );
    expect(e).toBeInstanceOf(ApiError);
    expect(e.statusCode).toBe(422);
    expect(e.requestId).toBe('rid');
    expect(e.details).toEqual({ a: 'b' });
  });

  it('flags retryable statuses', () => {
    expect(new ApiError('x', 429).retryable).toBe(true);
    expect(new ApiError('x', 503).retryable).toBe(true);
    expect(new ApiError('x', 404).retryable).toBe(false);
  });
});
