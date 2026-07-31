/**
 * CDN edge-cache header middleware.
 *
 * Sets Cache-Control and Surrogate-Key headers on cacheable GET responses:
 *   GET /plans, GET /pricing, GET /features, GET /public/*
 *
 * Default TTL: 5 minutes (300 s), overridable per-request via x-cache-ttl.
 * Includes stale-while-revalidate=60 for background revalidation at the edge.
 */

import type { Request, Response, NextFunction } from 'express';
import { formatSurrogateKeyHeader } from '../cache/surrogateKeys';

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_CACHE_TTL_SECONDS = 300;
export const STALE_WHILE_REVALIDATE_SECONDS = 60;
export const X_CACHE_TTL_HEADER = 'x-cache-ttl';
export const CACHE_CONTROL_HEADER = 'Cache-Control';
export const SURROGATE_KEY_HEADER = 'Surrogate-Key';
/** Cloudflare cache tags (mirrors surrogate keys for purge-by-tag). */
export const CACHE_TAG_HEADER = 'Cache-Tag';

/** Route patterns eligible for CDN edge caching (method + path). */
export const CACHEABLE_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/plans\/?$/ },
  { method: 'GET', pattern: /^\/pricing\/?$/ },
  { method: 'GET', pattern: /^\/features\/?$/ },
  { method: 'GET', pattern: /^\/public(?:\/.*)?$/ },
];

// ── Header builders ───────────────────────────────────────────────────────────

export interface CacheHeaderOptions {
  ttlSeconds?: number;
  surrogateKeys?: string[];
  staleWhileRevalidateSeconds?: number;
}

export interface CacheHeaderTarget {
  setHeader(name: string, value: string): void;
}

/** Build a Cache-Control value with s-maxage and stale-while-revalidate. */
export function buildCacheControlHeader(
  ttlSeconds: number = DEFAULT_CACHE_TTL_SECONDS,
  staleWhileRevalidateSeconds: number = STALE_WHILE_REVALIDATE_SECONDS,
): string {
  const ttl = clampTtl(ttlSeconds);
  return `public, s-maxage=${ttl}, max-age=${ttl}, stale-while-revalidate=${staleWhileRevalidateSeconds}`;
}

/** Clamp TTL to a sane range (1 s – 1 h). */
export function clampTtl(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return DEFAULT_CACHE_TTL_SECONDS;
  }
  return Math.min(Math.max(Math.floor(ttlSeconds), 1), 3600);
}

/** Resolve TTL from the x-cache-ttl request header or fall back to default. */
export function resolveTtlFromRequest(
  req: Pick<Request, 'headers'>,
  defaultTtl: number = DEFAULT_CACHE_TTL_SECONDS,
): number {
  const raw = req.headers[X_CACHE_TTL_HEADER] ?? req.headers[X_CACHE_TTL_HEADER.toLowerCase()];
  const headerValue = Array.isArray(raw) ? raw[0] : raw;
  if (headerValue === undefined || headerValue === '') {
    return defaultTtl;
  }
  const parsed = Number.parseInt(String(headerValue), 10);
  return clampTtl(Number.isNaN(parsed) ? defaultTtl : parsed);
}

/** Apply Cache-Control and Surrogate-Key headers to a response object. */
export function applyCacheHeaders(target: CacheHeaderTarget, options: CacheHeaderOptions = {}): void {
  const ttl = clampTtl(options.ttlSeconds ?? DEFAULT_CACHE_TTL_SECONDS);
  const swr = options.staleWhileRevalidateSeconds ?? STALE_WHILE_REVALIDATE_SECONDS;

  target.setHeader(CACHE_CONTROL_HEADER, buildCacheControlHeader(ttl, swr));

  if (options.surrogateKeys && options.surrogateKeys.length > 0) {
    const formatted = formatSurrogateKeyHeader(options.surrogateKeys);
    target.setHeader(SURROGATE_KEY_HEADER, formatted);
    target.setHeader(CACHE_TAG_HEADER, formatted);
  }
}

/** Check whether a request targets a cacheable route. */
export function isCacheableRoute(method: string, path: string): boolean {
  const normalizedPath = path.split('?')[0] || '/';
  return CACHEABLE_ROUTES.some(
    (route) => route.method === method.toUpperCase() && route.pattern.test(normalizedPath),
  );
}

// ── Express middleware ────────────────────────────────────────────────────────

export interface CacheHeadersMiddlewareOptions {
  defaultTtlSeconds?: number;
  /** When true, only cacheable routes receive headers (default: true). */
  routeFilter?: boolean;
}

/**
 * Express middleware that attaches edge-cache headers to eligible GET responses.
 *
 * Controllers may also call `applyCacheHeaders` directly with resource-specific
 * surrogate keys; this middleware provides a baseline for matched routes.
 */
export function cacheHeadersMiddleware(
  options: CacheHeadersMiddlewareOptions = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const defaultTtl = options.defaultTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
  const routeFilter = options.routeFilter ?? true;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method.toUpperCase() !== 'GET') {
      next();
      return;
    }

    if (routeFilter && !isCacheableRoute(req.method, req.path)) {
      next();
      return;
    }

    const ttl = resolveTtlFromRequest(req, defaultTtl);

    // Defer header application until the handler sends the response so that
    // route handlers can attach surrogate keys via res.locals first.
    const originalEnd = res.end.bind(res);
    res.end = ((...args: Parameters<Response['end']>) => {
      if (!res.headersSent) {
        const surrogateKeys = (res.locals?.surrogateKeys as string[] | undefined) ?? [];
        applyCacheHeaders(res, { ttlSeconds: ttl, surrogateKeys });
      }
      return originalEnd(...args);
    }) as Response['end'];

    next();
  };
}
