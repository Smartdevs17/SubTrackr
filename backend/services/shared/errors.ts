import { ErrorCode, ERROR_HTTP_STATUS_MAP } from './apiResponse';

export interface StructuredErrorDetails {
  code: string;
  message: string;
  userMessage: string;
  recovery?: string | null;
  details?: Record<string, any> | null;
  timestamp: string;
  requestId?: string | null;
}

export interface DomainErrorOptions {
  userMessage?: string;
  recovery?: string | null;
  details?: Record<string, any> | null;
  requestId?: string | null;
  cause?: unknown;
}

export class DomainError extends Error {
  readonly timestamp: string;
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, any> | null;
  public readonly requestId?: string | null;
  public readonly userMessage?: string;
  public readonly recovery?: string | null;

  constructor(
    arg1: string = 'Domain error',
    arg2?: string,
    arg3?: number | Record<string, any>,
    arg4?: DomainErrorOptions | Record<string, any>,
  ) {
    let message = arg1;
    let code = 'INTERNAL_SERVER_ERROR';
    let statusCode = 400;
    let details: Record<string, any> | null | undefined;
    let requestId: string | null | undefined;
    let userMessage: string | undefined;
    let recovery: string | null | undefined;
    let cause: unknown;

    if (typeof arg3 === 'number') {
      // Signature: (message, code, statusCode, options)
      message = arg1;
      code = arg2 ?? 'INTERNAL_SERVER_ERROR';
      statusCode = arg3;
      if (arg4 && typeof arg4 === 'object') {
        const opts = arg4 as DomainErrorOptions;
        details = opts.details;
        requestId = opts.requestId;
        userMessage = opts.userMessage;
        recovery = opts.recovery;
        cause = opts.cause;
      }
    } else if (typeof arg2 === 'string') {
      // Check if arg1 is an uppercase snake_case error code
      const arg1IsCode = /^[A-Z0-9_]+$/.test(arg1);
      if (arg1IsCode) {
        code = arg1;
        message = arg2;
        details = (arg3 as Record<string, any>) ?? undefined;
        statusCode = ERROR_HTTP_STATUS_MAP[code as ErrorCode] ?? 400;
      } else {
        message = arg1;
        code = arg2;
        statusCode = typeof arg3 === 'number' ? arg3 : 400;
        if (arg4 && typeof arg4 === 'object') {
          const opts = arg4 as DomainErrorOptions;
          details = opts.details;
          requestId = opts.requestId;
          userMessage = opts.userMessage;
          recovery = opts.recovery;
        }
      }
    } else {
      // Single argument: (message)
      message = arg1;
      code = 'INTERNAL_SERVER_ERROR';
      statusCode = 400;
    }

    const fullMessage =
      cause instanceof Error ? `${message} (Caused by: ${cause.message})` : message;
    super(fullMessage);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.requestId = requestId;
    this.userMessage = userMessage;
    this.recovery = recovery;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, new.target.prototype);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toApiResponse(): { success: false; error: StructuredErrorDetails } {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        userMessage: this.userMessage || this.message,
        recovery: this.recovery || null,
        details: this.details || null,
        timestamp: this.timestamp,
        requestId: this.requestId || null,
      },
    };
  }
}

export class ValidationError extends DomainError {
  constructor(
    message = 'Validation failed',
    details?: Record<string, any>,
    requestId?: string,
    userMessage?: string,
    recovery?: string
  ) {
    super(message, 'VALIDATION_ERROR', 400, { details, requestId, userMessage, recovery });
  }
}

export class UnauthorizedError extends DomainError {
  constructor(
    message = 'Unauthorized access',
    details?: Record<string, any>,
    requestId?: string,
    userMessage?: string,
    recovery?: string
  ) {
    super(message, 'UNAUTHORIZED', 401, { details, requestId, userMessage, recovery });
  }
}

export class ForbiddenError extends DomainError {
  constructor(
    message = 'Access forbidden',
    details?: Record<string, any>,
    requestId?: string,
    userMessage?: string,
    recovery?: string
  ) {
    super(message, 'FORBIDDEN', 403, { details, requestId, userMessage, recovery });
  }
}

export class NotFoundError extends DomainError {
  constructor(
    message = 'Resource not found',
    details?: Record<string, any>,
    requestId?: string,
    userMessage?: string,
    recovery?: string
  ) {
    super(message, 'NOT_FOUND', 404, { details, requestId, userMessage, recovery });
  }
}

export class ConflictError extends DomainError {
  constructor(
    message = 'Resource conflict',
    details?: Record<string, any>,
    requestId?: string,
    userMessage?: string,
    recovery?: string
  ) {
    super(message, 'CONFLICT', 409, { details, requestId, userMessage, recovery });
  }
}

export class UnprocessableEntityError extends DomainError {
  constructor(
    message = 'Unprocessable entity',
    details?: Record<string, any>,
    requestId?: string,
    userMessage?: string,
    recovery?: string
  ) {
    super(message, 'UNPROCESSABLE_ENTITY', 422, { details, requestId, userMessage, recovery });
  }
}

export class RateLimitExceededError extends DomainError {
  constructor(
    message = 'Too many requests',
    details?: Record<string, any>,
    requestId?: string,
    userMessage?: string,
    recovery?: string
  ) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, { details, requestId, userMessage, recovery });
  }
}

export class InternalServerError extends DomainError {
  constructor(
    message = 'Internal server error',
    details?: Record<string, any>,
    requestId?: string,
    userMessage?: string,
    recovery?: string
  ) {
    super(message, 'INTERNAL_SERVER_ERROR', 500, { details, requestId, userMessage, recovery });
  }
}

export class BadGatewayError extends DomainError {
  constructor(
    message = 'Bad gateway',
    details?: Record<string, any>,
    requestId?: string,
    userMessage?: string,
    recovery?: string
  ) {
    super(message, 'BAD_GATEWAY', 502, { details, requestId, userMessage, recovery });
  }
}

export class ServiceUnavailableError extends DomainError {
  constructor(
    message = 'Service unavailable',
    details?: Record<string, any>,
    requestId?: string,
    userMessage?: string,
    recovery?: string
  ) {
    super(message, 'SERVICE_UNAVAILABLE', 503, { details, requestId, userMessage, recovery });
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function fromUnknownError(
  err: unknown,
  code = 'INTERNAL_SERVER_ERROR',
  statusCode = 500,
  requestId?: string
): DomainError {
  if (isDomainError(err)) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  return new DomainError(message, code, statusCode, { requestId });
}
