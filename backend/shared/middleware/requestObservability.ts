/**
 * Request observability middleware: request ids, structured access logs and a
 * server span per request, all sharing the same identifiers so a log line can
 * be found from a trace and the other way round.
 *
 *   - `X-Request-Id` is taken from the caller when well formed, otherwise
 *     generated, and echoed on the response.
 *   - The handler runs inside the logger's correlation context, so every log
 *     written while serving the request carries `correlationId = requestId`.
 *   - A `server` span continues the caller's W3C `traceparent` (or starts a new
 *     trace) and is exported through the tracer when the response finishes.
 *   - One `http.request` log line is written per request with the request id,
 *     trace id and span id.
 *
 * No PII: query strings, headers, bodies and client IPs are never logged or
 * recorded on spans, and path segments that look like emails or long numbers
 * are masked.
 *
 * Works as Express middleware and with a raw `http.Server` handler:
 *   http.createServer((req, res) => observe(req, res, () => handle(req, res)));
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { runWithLogContext, type Logger } from '../../services/shared/logging';
import { extractContext, type Tracer } from '../../services/shared/tracing';

export const REQUEST_ID_HEADER = 'X-Request-Id';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const EMAIL_SEGMENT = /^[^/@\s]+@[^/@\s]+$/;
const LONG_NUMBER_SEGMENT = /^\+?\d{7,}$/;

/** Accept a caller-supplied id only if it is short and safe to log. */
export function resolveRequestId(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && REQUEST_ID_PATTERN.test(value) ? value : randomUUID();
}

/** Path without the query string, with PII-looking segments masked. */
export function sanitizePath(url: string | undefined): string {
  const path = (url ?? '/').split('?')[0] || '/';
  return path
    .split('/')
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // keep the raw segment
      }
      return EMAIL_SEGMENT.test(decoded) || LONG_NUMBER_SEGMENT.test(decoded)
        ? ':redacted'
        : segment;
    })
    .join('/');
}

export interface RequestObservabilityOptions {
  tracer: Tracer;
  logger: Logger;
}

type Next = () => unknown;

export function createRequestObservability({ tracer, logger }: RequestObservabilityOptions) {
  return function requestObservability(
    req: IncomingMessage,
    res: ServerResponse,
    next: Next,
  ): void {
    const requestId = resolveRequestId(req.headers['x-request-id']);
    const method = (req.method ?? 'GET').toUpperCase();
    const path = sanitizePath(req.url);
    const startedAt = Date.now();

    const span = tracer.startSpan(`${method} ${path}`, {
      kind: 'server',
      parent: extractContext(req.headers),
      endpoint: path,
      attributes: {
        'http.method': method,
        'http.target': path,
        'request.id': requestId,
      },
    });

    res.setHeader(REQUEST_ID_HEADER, requestId);

    let finished = false;
    const finish = (aborted: boolean): void => {
      if (finished) return;
      finished = true;

      const status = res.statusCode;
      span.setAttribute('http.status_code', status);
      if (aborted) {
        span.setStatus('error', 'client closed request');
      } else if (span.data.status.code !== 'error') {
        span.setStatus(status >= 500 ? 'error' : 'ok');
      }
      span.end();

      const entry = {
        requestId,
        traceId: span.context.traceId,
        spanId: span.context.spanId,
        method,
        path,
        status,
        durationMs: Date.now() - startedAt,
        ...(aborted ? { aborted: true } : {}),
      };
      runWithLogContext(requestId, () => {
        if (status >= 500) logger.error('http.request', entry);
        else if (status >= 400 || aborted) logger.warn('http.request', entry);
        else logger.info('http.request', entry);
      });
    };

    res.once('finish', () => finish(false));
    res.once('close', () => finish(!res.writableFinished));

    runWithLogContext(requestId, () => {
      try {
        const result = next();
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          // Record and rethrow so the rejection still surfaces as before.
          (result as Promise<unknown>).catch((error: unknown) => {
            span.recordException(error);
            throw error;
          });
        }
      } catch (error) {
        span.recordException(error);
        throw error;
      }
    });
  };
}
