import { ErrorCode } from './apiResponse';

export class DomainError extends Error {
  readonly timestamp: string;

  constructor(
    public readonly code: ErrorCode | string,
    message: string,
    public readonly details?: Record<string, any>,
    public readonly statusCode: number = 400,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toApiResponse() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details || null,
        timestamp: this.timestamp,
        requestId: this.requestId || null,
      },
    };
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, any>, requestId?: string) {
    super(ErrorCode.INVALID_INPUT, message, details, 400, requestId);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Unauthorized access', details?: Record<string, any>, requestId?: string) {
    super(ErrorCode.UNAUTHORIZED, message, details, 401, requestId);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Access forbidden', details?: Record<string, any>, requestId?: string) {
    super(ErrorCode.FORBIDDEN, message, details, 403, requestId);
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Resource not found', details?: Record<string, any>, requestId?: string) {
    super(ErrorCode.NOT_FOUND, message, details, 404, requestId);
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'Resource conflict', details?: Record<string, any>, requestId?: string) {
    super(ErrorCode.CONFLICT, message, details, 409, requestId);
  }
}

export class RateLimitExceededError extends DomainError {
  constructor(message = 'Too many requests', details?: Record<string, any>, requestId?: string) {
    super(ErrorCode.RATE_LIMIT_EXCEEDED, message, details, 429, requestId);
  }
}

export class InternalServerError extends DomainError {
  constructor(message = 'Internal server error', details?: Record<string, any>, requestId?: string) {
    super(ErrorCode.INTERNAL_SERVER_ERROR, message, details, 500, requestId);
  }
}

export class ServiceUnavailableError extends DomainError {
  constructor(message = 'Service unavailable', details?: Record<string, any>, requestId?: string) {
    super(ErrorCode.SERVICE_UNAVAILABLE, message, details, 533, requestId);
  }
}
