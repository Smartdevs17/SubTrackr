import { ErrorCode } from './apiResponse';

export interface StructuredErrorDetails {
  code: string;
  message: string;
  userMessage: string;
  recovery?: string | null;
  details?: Record<string, any> | null;
  timestamp: string;
  requestId?: string | null;
}

export class DomainError extends Error {
  readonly timestamp: string;

  constructor(
    public readonly code: ErrorCode | string,
    message: string,
    public readonly details?: Record<string, any>,
    public readonly statusCode: number = 400,
    public readonly requestId?: string,
    public readonly userMessage?: string,
    public readonly recovery?: string,
    public readonly cause?: unknown
  ) {
    const fullMessage =
      cause instanceof Error ? `${message} (Caused by: ${cause.message})` : message;
    super(fullMessage);
    this.name = this.constructor.name;
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
    message: string,
    details?: Record<string, any>,
    requestId?: string,
    userMessage?: string,
    recovery?: string
  ) {
    super(ErrorCode.INVALID_INPUT, message, details, 400, requestId, userMessage, recovery);
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
    super(ErrorCode.UNAUTHORIZED, message, details, 401, requestId, userMessage, recovery);
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
    super(ErrorCode.FORBIDDEN, message, details, 403, requestId, userMessage, recovery);
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
    super(ErrorCode.NOT_FOUND, message, details, 404, requestId, userMessage, recovery);
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
    super(ErrorCode.CONFLICT, message, details, 409, requestId, userMessage, recovery);
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
    super('UNPROCESSABLE_ENTITY', message, details, 422, requestId, userMessage, recovery);
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
    super(ErrorCode.RATE_LIMIT_EXCEEDED, message, details, 429, requestId, userMessage, recovery);
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
    super(ErrorCode.INTERNAL_SERVER_ERROR, message, details, 500, requestId, userMessage, recovery);
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
    super('BAD_GATEWAY', message, details, 502, requestId, userMessage, recovery);
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
    super(ErrorCode.SERVICE_UNAVAILABLE, message, details, 533, requestId, userMessage, recovery);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function fromUnknownError(err: unknown, requestId?: string): DomainError {
  if (isDomainError(err)) {
    return err;
  }
  if (err instanceof Error) {
    return new InternalServerError(err.message, undefined, requestId, undefined, undefined);
  }
  return new InternalServerError(String(err), undefined, requestId, undefined, undefined);
}
