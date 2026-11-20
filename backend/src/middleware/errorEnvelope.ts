/**
 * Canonical error envelope shared by REST responses, background workers and
 * the SDKs. The shape matches `ApiErrorEnvelope` in sdks/javascript.
 *
 *   {
 *     "success": false,
 *     "error": { "code": "NOT_FOUND", "message": "...", "details": { ... } },
 *     "meta":  { "timestamp": "...", "requestId": "...", "apiVersion": 1 }
 *   }
 */

import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const API_VERSION = 1;
export const REQUEST_ID_HEADER = 'x-request-id';

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
  meta: {
    timestamp: string;
    requestId: string;
    apiVersion: number;
  };
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMIT_EXCEEDED',
  500: 'INTERNAL_SERVER_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

export function defaultCodeForStatus(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');
}

/** Whether a client may safely retry the same request. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Throw (or pass to `next`) from any handler to control the response. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = defaultCodeForStatus(status),
    public readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function buildErrorEnvelope(
  status: number,
  message: string,
  options: { code?: string; details?: Record<string, string>; requestId?: string } = {},
): ErrorEnvelope {
  return {
    success: false,
    error: {
      code: options.code ?? defaultCodeForStatus(status),
      message,
      ...(options.details ? { details: options.details } : {}),
    },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: options.requestId ?? randomUUID(),
      apiVersion: API_VERSION,
    },
  };
}

/** Normalises any thrown value into `{ status, message, code, details }`. */
export function normalizeError(err: unknown): {
  status: number;
  message: string;
  code: string;
  details?: Record<string, string>;
} {
  if (err instanceof AppError) {
    return { status: err.status, message: err.message, code: err.code, details: err.details };
  }
  // 5xx messages are never leaked: they may contain SQL, paths or secrets.
  return { status: 500, message: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' };
}

function requestIdFor(req: Request): string {
  const header = req.headers?.[REQUEST_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value && value.length <= 128 ? value : randomUUID();
}

/** Send an envelope from a handler or middleware without throwing. */
export function sendError(
  req: Request,
  res: Response,
  status: number,
  message: string,
  options: { code?: string; details?: Record<string, string> } = {},
): void {
  const requestId = requestIdFor(req);
  res.setHeader('X-Request-Id', requestId);
  res.status(status).json(buildErrorEnvelope(status, message, { ...options, requestId }));
}

/** Express terminal error handler. Register after all routes. */
export function errorEnvelopeHandler(
  log: (message: string, meta?: Record<string, unknown>) => void = console.error,
) {
  return (err: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const { status, message, code, details } = normalizeError(err);
    if (status >= 500) {
      log('[error-envelope] unhandled error', {
        path: req.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    sendError(req, res, status, message, { code, details });
  };
}

/** 404 fallthrough, register before `errorEnvelopeHandler`. */
export function notFoundEnvelopeHandler(req: Request, res: Response): void {
  sendError(req, res, 404, `Route ${req.method} ${req.path} not found`);
}

// ── Worker boundary ───────────────────────────────────────────────────────────

/** Error payload for job results / dead-letter records. Same `error` body as REST. */
export interface WorkerErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, string>;
}

export class WorkerJobError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'JOB_FAILED',
    public readonly retryable: boolean = true,
    public readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'WorkerJobError';
  }
}

export function serializeWorkerError(err: unknown): WorkerErrorPayload {
  if (err instanceof WorkerJobError) {
    return {
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      ...(err.details ? { details: err.details } : {}),
    };
  }
  if (err instanceof AppError) {
    return {
      code: err.code,
      message: err.message,
      retryable: isRetryableStatus(err.status),
      ...(err.details ? { details: err.details } : {}),
    };
  }
  return { code: 'JOB_FAILED', message: err instanceof Error ? err.message : String(err), retryable: true };
}

/** Wrap a worker error payload in the REST envelope (e.g. for job-status endpoints). */
export function workerErrorToEnvelope(payload: WorkerErrorPayload, requestId?: string): ErrorEnvelope {
  return buildErrorEnvelope(payload.retryable ? 503 : 422, payload.message, {
    code: payload.code,
    details: payload.details,
    requestId,
  });
}
