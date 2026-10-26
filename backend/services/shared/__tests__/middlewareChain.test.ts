/**
 * Tests for composable middleware chain — middlewareChain.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  chain,
  MiddlewareChain,
  toExpressMiddleware,
  skipPaths,
  sanitizationHandler,
  securityHeadersHandler,
  type MiddlewareFn,
  type ExpressContext,
  type ChainExecutionResult,
} from '../middlewareChain';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<ExpressContext> = {}): ExpressContext {
  const headers: Record<string, string> = {};
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    setHeader: jest.fn((k: string, v: string) => { headers[k] = v; }),
    headersSent: false,
    _headers: headers,
  };
  return {
    req: { headers: {}, method: 'GET', path: '/test', body: {}, query: {} } as any,
    res: res as any,
    ...overrides,
  };
}

// ── chain() factory ───────────────────────────────────────────────────────────

describe('chain()', () => {
  it('returns a MiddlewareChain instance', () => {
    expect(chain()).toBeInstanceOf(MiddlewareChain);
  });

  it('inspect() returns registered middleware names', () => {
    const mw = chain<ExpressContext>()
      .use(async (_, next) => next(), { name: 'alpha' })
      .use(async (_, next) => next(), { name: 'beta' });
    expect(mw.inspect()).toEqual(['alpha', 'beta']);
  });
});

// ── Sequential execution ──────────────────────────────────────────────────────

describe('MiddlewareChain execution', () => {
  it('executes middleware in order', async () => {
    const order: number[] = [];
    const composed = chain<ExpressContext>()
      .use(async (_, next) => { order.push(1); await next(); order.push(4); }, { name: 'a' })
      .use(async (_, next) => { order.push(2); await next(); order.push(3); }, { name: 'b' })
      .build();

    await composed(makeCtx(), async () => {});
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('calls final next when all middleware pass through', async () => {
    let finalCalled = false;
    const composed = chain<ExpressContext>()
      .use(async (_, next) => next(), { name: 'pass' })
      .build();

    await composed(makeCtx(), async () => { finalCalled = true; });
    expect(finalCalled).toBe(true);
  });

  it('short-circuits when a middleware does not call next()', async () => {
    let secondCalled = false;
    const composed = chain<ExpressContext>()
      .use(async () => { /* intentionally does not call next */ }, { name: 'block' })
      .use(async (_, next) => { secondCalled = true; await next(); }, { name: 'second' })
      .build();

    await composed(makeCtx(), async () => {});
    expect(secondCalled).toBe(false);
  });

  it('propagates errors when no error handler is set', async () => {
    const composed = chain<ExpressContext>()
      .use(async () => { throw new Error('boom'); }, { name: 'thrower' })
      .build();

    await expect(composed(makeCtx(), async () => {})).rejects.toThrow('boom');
  });

  it('error handler catches and can suppress throw', async () => {
    let caught: unknown;
    const composed = chain<ExpressContext>()
      .use(async () => { throw new Error('handled'); }, { name: 'thrower' })
      .catch(async (err, _ctx, _next) => { caught = err; })
      .build();

    await expect(composed(makeCtx(), async () => {})).resolves.toBeUndefined();
    expect((caught as Error).message).toBe('handled');
  });
});

// ── skipCondition ─────────────────────────────────────────────────────────────

describe('skipCondition', () => {
  it('skips middleware when condition returns true', async () => {
    let ran = false;
    const composed = chain<ExpressContext>()
      .use(
        async (_, next) => { ran = true; await next(); },
        { name: 'skippable', skipCondition: () => true },
      )
      .build();

    await composed(makeCtx(), async () => {});
    expect(ran).toBe(false);
  });

  it('skipPaths helper skips for matching path prefix', async () => {
    let ran = false;
    const ctx = makeCtx();
    (ctx.req as any).path = '/health/live';

    const composed = chain<ExpressContext>()
      .use(
        async (_, next) => { ran = true; await next(); },
        { name: 'skippable', skipCondition: skipPaths(['/health']) },
      )
      .build();

    await composed(ctx, async () => {});
    expect(ran).toBe(false);
  });

  it('does not skip for non-matching path', async () => {
    let ran = false;
    const ctx = makeCtx();
    (ctx.req as any).path = '/api/plans';

    const composed = chain<ExpressContext>()
      .use(
        async (_, next) => { ran = true; await next(); },
        { name: 'runs', skipCondition: skipPaths(['/health']) },
      )
      .build();

    await composed(ctx, async () => {});
    expect(ran).toBe(true);
  });
});

// ── merge() ───────────────────────────────────────────────────────────────────

describe('merge()', () => {
  it('combines middleware from two chains in order', async () => {
    const order: string[] = [];
    const a = chain<ExpressContext>().use(async (_, next) => { order.push('a'); await next(); }, { name: 'a' });
    const b = chain<ExpressContext>().use(async (_, next) => { order.push('b'); await next(); }, { name: 'b' });
    a.merge(b);

    const composed = a.build();
    await composed(makeCtx(), async () => {});
    expect(order).toEqual(['a', 'b']);
  });
});

// ── buildInstrumented() ───────────────────────────────────────────────────────

describe('buildInstrumented()', () => {
  it('returns correct execution telemetry', async () => {
    const instrumented = chain<ExpressContext>()
      .use(async (_, next) => next(), { name: 'one' })
      .use(async (_, next) => next(), { name: 'two', skipCondition: () => true })
      .buildInstrumented();

    const result: ChainExecutionResult = await instrumented(makeCtx(), async () => {});
    expect(result.success).toBe(true);
    expect(result.executedMiddleware).toContain('one');
    expect(result.skippedMiddleware).toContain('two');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures errorIn when middleware throws', async () => {
    const instrumented = chain<ExpressContext>()
      .use(async () => { throw new Error('fail'); }, { name: 'failer' })
      .catch(async () => { /* suppress */ })
      .buildInstrumented();

    const result = await instrumented(makeCtx(), async () => {});
    expect(result.errorIn).toBe('failer');
    expect(result.success).toBe(false);
  });
});

// ── toExpressMiddleware() ─────────────────────────────────────────────────────

describe('toExpressMiddleware()', () => {
  it('calls next when middleware passes through', () => {
    const composed: MiddlewareFn<ExpressContext> = async (_, next) => next();
    const mw = toExpressMiddleware(composed);

    const req = { headers: {}, method: 'GET', path: '/', body: {} } as any;
    const res = { headersSent: false, setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    const next = jest.fn();

    mw(req, res, next);
    return new Promise<void>((resolve) => {
      Promise.resolve().then(() => Promise.resolve()).then(() => {
        expect(next).toHaveBeenCalled();
        resolve();
      });
    });
  });

  it('calls next(err) when middleware throws', () => {
    const composed: MiddlewareFn<ExpressContext> = async () => { throw new Error('oops'); };
    const mw = toExpressMiddleware(composed);

    const req = { headers: {}, method: 'GET', path: '/', body: {} } as any;
    const res = { headersSent: false, setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    const next = jest.fn();

    mw(req, res, next);
    return new Promise<void>((resolve) => {
      Promise.resolve().then(() => Promise.resolve()).then(() => {
        expect(next).toHaveBeenCalledWith(expect.any(Error));
        resolve();
      });
    });
  });
});

// ── Built-in handlers ─────────────────────────────────────────────────────────

describe('sanitizationHandler()', () => {
  it('strips XSS from req.body string fields', async () => {
    const ctx = makeCtx();
    (ctx.req as any).body = { name: '<script>alert(1)</script>hello' };

    const composed = chain<ExpressContext>()
      .use(sanitizationHandler(), { name: 'sanitize' })
      .build();

    await composed(ctx, async () => {});
    expect((ctx.req as any).body.name).toBe('hello');
  });

  it('throws on SQL injection pattern', async () => {
    const ctx = makeCtx();
    (ctx.req as any).body = { q: "1' OR 1=1 --" };

    const composed = chain<ExpressContext>()
      .use(sanitizationHandler(), { name: 'sanitize' })
      .build();

    await expect(composed(ctx, async () => {})).rejects.toThrow(/SQL injection/i);
  });

  it('recurses into nested objects', async () => {
    const ctx = makeCtx();
    (ctx.req as any).body = { nested: { value: '<b>bold</b>' } };

    const composed = chain<ExpressContext>()
      .use(sanitizationHandler(), { name: 'sanitize' })
      .build();

    await composed(ctx, async () => {});
    expect((ctx.req as any).body.nested.value).toBe('bold');
  });
});

describe('securityHeadersHandler()', () => {
  it('sets standard security headers', async () => {
    const ctx = makeCtx();
    const composed = chain<ExpressContext>()
      .use(securityHeadersHandler(), { name: 'sec-headers' })
      .build();

    await composed(ctx, async () => {});
    expect((ctx.res as any).setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect((ctx.res as any).setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect((ctx.res as any).setHeader).toHaveBeenCalledWith('Strict-Transport-Security', expect.stringContaining('max-age='));
  });

  it('skips HSTS when disabled', async () => {
    const ctx = makeCtx();
    const composed = chain<ExpressContext>()
      .use(securityHeadersHandler({ hsts: false }), { name: 'sec-headers' })
      .build();

    await composed(ctx, async () => {});
    const calls = (ctx.res as any).setHeader.mock.calls.map((c: string[]) => c[0]);
    expect(calls).not.toContain('Strict-Transport-Security');
  });
});
