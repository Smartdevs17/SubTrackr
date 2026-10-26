/**
 * Composable Middleware Chain — SubTrackr
 *
 * Provides a fluent builder for assembling security middleware into ordered,
 * composable chains. Each handler is a lightweight function:
 *
 *   type MiddlewareFn<C> = (ctx: C, next: () => Promise<void>) => Promise<void>
 *
 * Usage:
 *   const secured = chain<ExpressContext>()
 *     .use(corsHandler(corsPolicy))
 *     .use(authHandler(manager))
 *     .use(rateLimitHandler(rateLimitService))
 *     .use(validationHandler(schema))
 *     .build();
 *
 *   // Express adapter:
 *   app.use('/api', toExpressMiddleware(secured));
 */

import {
  createRateLimitMiddleware as _createRateLimitMiddleware,
  type RateLimitRequest as _RateLimitRequest,
  type RateLimitResponse as _RateLimitResponse,
} from './rateLimitMiddleware';
import type { CompositeAuthStrategyManager } from './authStrategies';
import type { CorsPolicy } from './corsMiddleware';
import { RateLimitingService } from './rateLimitingService';
import { sanitizeXss, detectSqlInjection } from './validationMiddleware';

// ─── Minimal structural HTTP types ────────────────────────────────────────────
// Matches Express Request/Response/NextFunction shapes without requiring the
// express package in non-backend bundles.

export interface HttpRequest {
  method: string;
  path: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: unknown;
  ip?: string;
  socket?: { remoteAddress?: string };
}

export interface HttpResponse {
  headersSent: boolean;
  status(code: number): this;
  json(body: unknown): this;
  end(body?: string): this;
  setHeader(name: string, value: string | number): void;
}

export type NextFunction = (err?: unknown) => void;

// ─── Core types ───────────────────────────────────────────────────────────────

export type MiddlewareFn<C> = (ctx: C, next: () => Promise<void>) => Promise<void>;

export type MiddlewareErrorHandler<C> = (
  err: unknown,
  ctx: C,
  next: () => Promise<void>,
) => Promise<void>;

export interface MiddlewareMetadata {
  name: string;
  skipCondition?: (ctx: unknown) => boolean;
}

interface MiddlewareEntry<C> {
  fn: MiddlewareFn<C>;
  meta: MiddlewareMetadata;
}

// ─── Execution result ─────────────────────────────────────────────────────────

export interface ChainExecutionResult {
  success: boolean;
  executedMiddleware: string[];
  skippedMiddleware: string[];
  errorIn?: string;
  durationMs: number;
}

// ─── Chain builder ────────────────────────────────────────────────────────────

export class MiddlewareChain<C> {
  private readonly entries: MiddlewareEntry<C>[] = [];
  private errorHandler?: MiddlewareErrorHandler<C>;

  /** Append a middleware to the chain with optional metadata. */
  use(
    fn: MiddlewareFn<C>,
    meta: MiddlewareMetadata = { name: fn.name || 'anonymous' },
  ): this {
    this.entries.push({ fn, meta });
    return this;
  }

  /** Register a global error handler for the chain. */
  catch(handler: MiddlewareErrorHandler<C>): this {
    this.errorHandler = handler;
    return this;
  }

  /**
   * Build a single composed middleware function.
   * Execution is sequential; any middleware can short-circuit by not calling `next`.
   */
  build(): MiddlewareFn<C> {
    const entries = [...this.entries];
    const errorHandler = this.errorHandler;

    return async (ctx: C, finalNext: () => Promise<void>): Promise<void> => {
      let index = 0;

      const dispatch = async (): Promise<void> => {
        if (index >= entries.length) {
          return finalNext();
        }

        const entry = entries[index++]!;

        if (entry.meta.skipCondition && entry.meta.skipCondition(ctx)) {
          return dispatch();
        }

        try {
          await entry.fn(ctx, dispatch);
        } catch (err) {
          if (errorHandler) {
            await errorHandler(err, ctx, dispatch);
          } else {
            throw err;
          }
        }
      };

      return dispatch();
    };
  }

  /**
   * Build and instrument the chain to collect execution telemetry.
   */
  buildInstrumented(): (ctx: C, next: () => Promise<void>) => Promise<ChainExecutionResult> {
    const entries = [...this.entries];
    const errorHandler = this.errorHandler;

    return async (ctx: C, finalNext: () => Promise<void>): Promise<ChainExecutionResult> => {
      const start = Date.now();
      const executedMiddleware: string[] = [];
      const skippedMiddleware: string[] = [];
      let errorIn: string | undefined;
      let index = 0;

      const dispatch = async (): Promise<void> => {
        if (index >= entries.length) {
          return finalNext();
        }

        const entry = entries[index++]!;
        const name = entry.meta.name;

        if (entry.meta.skipCondition && entry.meta.skipCondition(ctx)) {
          skippedMiddleware.push(name);
          return dispatch();
        }

        executedMiddleware.push(name);

        try {
          await entry.fn(ctx, dispatch);
        } catch (err) {
          errorIn = name;
          if (errorHandler) {
            await errorHandler(err, ctx, dispatch);
          } else {
            throw err;
          }
        }
      };

      try {
        await dispatch();
      } catch {
        // error captured in errorIn
      }

      return {
        success: !errorIn,
        executedMiddleware,
        skippedMiddleware,
        errorIn,
        durationMs: Date.now() - start,
      };
    };
  }

  /** Merge another chain's middleware into this one (in order). */
  merge(other: MiddlewareChain<C>): this {
    for (const entry of other.entries) {
      this.entries.push(entry);
    }
    return this;
  }

  /** Return the names of registered middleware (for diagnostics). */
  inspect(): string[] {
    return this.entries.map((e) => e.meta.name);
  }
}

/** Factory: create a typed middleware chain. */
export function chain<C = ExpressContext>(): MiddlewareChain<C> {
  return new MiddlewareChain<C>();
}

// ─── Express context & adapter ────────────────────────────────────────────────

export interface ExpressContext {
  req: HttpRequest;
  res: HttpResponse;
}

/**
 * Convert a composed `MiddlewareFn<ExpressContext>` into a standard Express
 * middleware `(req, res, next)` handler.
 */
export function toExpressMiddleware(
  fn: MiddlewareFn<ExpressContext>,
): (req: HttpRequest, res: HttpResponse, next: NextFunction) => void {
  return (req: HttpRequest, res: HttpResponse, next: NextFunction): void => {
    const ctx: ExpressContext = { req, res };
    fn(ctx, async () => {})
      .then(() => {
        if (!res.headersSent) next();
      })
      .catch(next);
  };
}

// ─── Built-in security middleware handlers ────────────────────────────────────

/** Skip paths from a middleware (e.g. health checks). */
export function skipPaths(paths: string[]): (ctx: unknown) => boolean {
  return (ctx: unknown) => {
    const expressCtx = ctx as ExpressContext;
    const reqPath: string = expressCtx?.req?.path ?? expressCtx?.req?.url ?? '';
    return paths.some((p) => reqPath.startsWith(p));
  };
}

/**
 * Auth handler: authenticates the request and attaches `req.user`.
 * Short-circuits with 401 if no strategy matches.
 */
export function authHandler(
  manager: CompositeAuthStrategyManager,
  options: { optional?: boolean } = {},
): MiddlewareFn<ExpressContext> {
  return async function authenticate({ req, res }, next) {
    try {
      // Cast to any for compatibility with CompositeAuthStrategyManager's Express-typed signature
      const user = await manager.authenticate(req as unknown as Parameters<typeof manager.authenticate>[0]);
      (req as unknown as Record<string, unknown>).user = user;
      (req as unknown as Record<string, unknown>).authStrategy = (user as { strategy: string }).strategy;
      await next();
    } catch {
      if (options.optional) {
        await next();
      } else {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }
    }
  };
}

/**
 * CORS handler: applies dynamic per-tenant CORS policies.
 * Reads tenant from `req.headers['x-tenant-id']`.
 */
export function corsHandler(
  getPolicyForTenant: (tenantId: string) => CorsPolicy | null,
  defaultPolicy?: Partial<CorsPolicy>,
): MiddlewareFn<ExpressContext> {
  return async function applyCors({ req, res }, next) {
    const tenantId = req.headers['x-tenant-id'];
    const tenantIdStr = Array.isArray(tenantId) ? tenantId[0] : tenantId;
    const originHeader = req.headers['origin'];
    const origin = (Array.isArray(originHeader) ? originHeader[0] : originHeader) ?? '';
    const policy = tenantIdStr ? getPolicyForTenant(tenantIdStr) : null;

    const allowedOrigins =
      policy?.allowedOrigins.map((o) => o.origin) ??
      defaultPolicy?.allowedOrigins?.map((o) => o.origin) ??
      ['*'];

    const isAllowed =
      allowedOrigins.includes('*') ||
      allowedOrigins.some((o) => {
        if (o.includes('*')) {
          const pattern = new RegExp(
            '^' + o.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
          );
          return pattern.test(origin);
        }
        return o === origin;
      });

    if (origin && isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    const methods = (
      policy?.allowMethods ??
      defaultPolicy?.allowMethods ??
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    ).join(', ');
    const allowHeaders = (
      policy?.allowHeaders ??
      defaultPolicy?.allowHeaders ??
      ['Content-Type', 'Authorization', 'X-API-Key']
    ).join(', ');

    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', allowHeaders);

    if (policy?.allowCredentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (req.method === 'OPTIONS') {
      const maxAge = policy?.maxAge ?? 86400;
      res.setHeader('Access-Control-Max-Age', maxAge);
      res.status(204).end();
      return;
    }

    await next();
  };
}

/**
 * Rate-limit handler: delegates to the existing rateLimitMiddleware.
 * Sets X-RateLimit-* headers; returns 429 when exceeded.
 */
export function rateLimitHandler(
  service: RateLimitingService,
  options: {
    keyFn?: (req: _RateLimitRequest) => string | undefined;
    softMode?: boolean;
    bypassPaths?: string[];
  } = {},
): MiddlewareFn<ExpressContext> {
  const mw = _createRateLimitMiddleware({
    service,
    keyFn: options.keyFn,
    softMode: options.softMode,
    bypassPaths: options.bypassPaths,
  });

  return async function rateLimit({ req, res }, next) {
    let calledNext = false;
    mw(
      req as unknown as _RateLimitRequest,
      res as unknown as _RateLimitResponse,
      () => { calledNext = true; },
    );
    if (calledNext) await next();
  };
}

/**
 * XSS + SQL injection sanitization handler.
 * Mutates string values in req.body and req.query in-place.
 */
export function sanitizationHandler(): MiddlewareFn<ExpressContext> {
  function sanitizeObject(obj: Record<string, unknown>): void {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string') {
        if (detectSqlInjection(val)) {
          throw Object.assign(
            new Error('Potential SQL injection detected'),
            { statusCode: 400 },
          );
        }
        obj[key] = sanitizeXss(val);
      } else if (val && typeof val === 'object') {
        sanitizeObject(val as Record<string, unknown>);
      }
    }
  }

  return async function sanitize({ req }, next) {
    if (req.body && typeof req.body === 'object') {
      sanitizeObject(req.body as Record<string, unknown>);
    }
    if (req.query && typeof req.query === 'object') {
      sanitizeObject(req.query as Record<string, unknown>);
    }
    await next();
  };
}

/**
 * Zod body-validation handler.
 * Returns 422 with field-level errors on schema mismatch.
 */
export function validationHandler<T>(
  schema: { safeParse(data: unknown): { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } },
): MiddlewareFn<ExpressContext> {
  return async function validate({ req, res }, next) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details: Record<string, string> = {};
      const failResult = result as { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };
      for (const issue of failResult.error.issues) {
        details[issue.path.join('.')] = issue.message;
      }
      res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details },
      });
      return;
    }
    (req as unknown as Record<string, unknown>).validatedBody = result.data;
    await next();
  };
}

/**
 * Security headers handler: sets CSP, HSTS, X-Frame-Options, etc.
 */
export function securityHeadersHandler(
  options: { hsts?: boolean; reportUri?: string } = {},
): MiddlewareFn<ExpressContext> {
  return async function setSecurityHeaders({ res }, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'",
    );
    if (options.hsts !== false) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=63072000; includeSubDomains; preload',
      );
    }
    if (options.reportUri) {
      res.setHeader(
        'Report-To',
        JSON.stringify({
          group: 'default',
          max_age: 86400,
          endpoints: [{ url: options.reportUri }],
        }),
      );
    }
    await next();
  };
}

// ─── Preset chains ────────────────────────────────────────────────────────────

/**
 * Standard public API security chain:
 *   securityHeaders → cors → rateLimiting → sanitization
 */
export function publicApiChain(options: {
  rateLimitService: RateLimitingService;
  corsPolicy?: (tenantId: string) => CorsPolicy | null;
  bypassPaths?: string[];
}): MiddlewareChain<ExpressContext> {
  return chain<ExpressContext>()
    .use(securityHeadersHandler(), { name: 'security-headers' })
    .use(corsHandler(options.corsPolicy ?? (() => null)), { name: 'cors' })
    .use(
      rateLimitHandler(options.rateLimitService, { bypassPaths: options.bypassPaths }),
      { name: 'rate-limit' },
    )
    .use(sanitizationHandler(), { name: 'sanitization' });
}

/**
 * Authenticated API security chain:
 *   securityHeaders → cors → auth → rateLimiting → sanitization
 */
export function authenticatedApiChain(options: {
  authManager: CompositeAuthStrategyManager;
  rateLimitService: RateLimitingService;
  corsPolicy?: (tenantId: string) => CorsPolicy | null;
  bypassPaths?: string[];
}): MiddlewareChain<ExpressContext> {
  return chain<ExpressContext>()
    .use(securityHeadersHandler(), { name: 'security-headers' })
    .use(corsHandler(options.corsPolicy ?? (() => null)), { name: 'cors' })
    .use(authHandler(options.authManager), { name: 'auth' })
    .use(
      rateLimitHandler(options.rateLimitService, { bypassPaths: options.bypassPaths }),
      { name: 'rate-limit' },
    )
    .use(sanitizationHandler(), { name: 'sanitization' });
}
