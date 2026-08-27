export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly recovery?: string;
  readonly cause?: unknown;
  readonly context?: Record<string, any>;
  readonly timestamp: string;
  readonly requestId?: string;

  constructor(
    code: string,
    userMessage: string,
    recovery?: string,
    cause?: unknown,
    context?: Record<string, any>,
    requestId?: string
  ) {
    const fullMessage =
      cause instanceof Error ? `${userMessage} (Caused by: ${cause.message})` : userMessage;
    super(fullMessage);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.recovery = recovery;
    this.cause = cause;
    this.context = context;
    this.timestamp = new Date().toISOString();
    this.requestId = requestId;

    // Ensure the prototype is set correctly for custom ES5/ES6 inheritance in older JS runtimes
    Object.setPrototypeOf(this, new.target.prototype);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      recovery: this.recovery,
      context: this.context,
      timestamp: this.timestamp,
      requestId: this.requestId,
    };
  }
}

export enum WalletErrorCode {
  NOT_CONNECTED = 'WALLET_NOT_CONNECTED',
  USER_REJECTED = 'USER_REJECTED',
  NETWORK_MISMATCH = 'NETWORK_MISMATCH',
  BALANCE_FETCH_FAILED = 'BALANCE_FETCH_FAILED',
  GAS_ESTIMATION_FAILED = 'GAS_ESTIMATION_FAILED',
  STREAM_CREATION_FAILED = 'STREAM_CREATION_FAILED',
  APPROVAL_FAILED = 'APPROVAL_FAILED',
  INVALID_PARAMS = 'INVALID_PARAMS',
  UNKNOWN = 'UNKNOWN',
}

export class WalletError extends AppError {
  constructor(
    code: WalletErrorCode | string,
    userMessage: string,
    recovery?: string,
    cause?: unknown,
    context?: Record<string, any>,
    requestId?: string
  ) {
    super(code, userMessage, recovery, cause, context, requestId);
    this.name = 'WalletError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export enum ContractErrorCode {
  EXECUTION_FAILED = 'CONTRACT_EXECUTION_FAILED',
  DECODING_FAILED = 'CONTRACT_DECODING_FAILED',
  CALL_EXCEPTION = 'CONTRACT_CALL_EXCEPTION',
  INSUFFICIENT_ALLOWANCE = 'CONTRACT_INSUFFICIENT_ALLOWANCE',
  UPGRADE_DETECTION_FAILED = 'CONTRACT_UPGRADE_DETECTION_FAILED',
  UNKNOWN = 'CONTRACT_UNKNOWN',
}

export class ContractError extends AppError {
  constructor(
    code: ContractErrorCode | string,
    userMessage: string,
    recovery?: string,
    cause?: unknown,
    context?: Record<string, any>,
    requestId?: string
  ) {
    super(code, userMessage, recovery, cause, context, requestId);
    this.name = 'ContractError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export enum NetworkErrorCode {
  CONNECTION_FAILED = 'NETWORK_CONNECTION_FAILED',
  TIMEOUT = 'NETWORK_TIMEOUT',
  RPC_ERROR = 'NETWORK_RPC_ERROR',
  UNSUPPORTED_CHAIN = 'NETWORK_UNSUPPORTED_CHAIN',
  UNKNOWN = 'NETWORK_UNKNOWN',
}

export class NetworkError extends AppError {
  constructor(
    code: NetworkErrorCode | string,
    userMessage: string,
    recovery?: string,
    cause?: unknown,
    context?: Record<string, any>,
    requestId?: string
  ) {
    super(code, userMessage, recovery, cause, context, requestId);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export enum ValidationErrorCode {
  INVALID_INPUT = 'VALIDATION_INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'VALIDATION_MISSING_REQUIRED_FIELD',
  OUT_OF_RANGE = 'VALIDATION_OUT_OF_RANGE',
  FORMAT_ERROR = 'VALIDATION_FORMAT_ERROR',
}

export class ValidationError extends AppError {
  constructor(
    code: ValidationErrorCode | string,
    userMessage: string,
    recovery?: string,
    cause?: unknown,
    context?: Record<string, any>,
    requestId?: string
  ) {
    super(code, userMessage, recovery, cause, context, requestId);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export enum AuthErrorCode {
  UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  EXPIRED_TOKEN = 'AUTH_EXPIRED_TOKEN',
  INVALID_TOKEN = 'AUTH_INVALID_TOKEN',
  INVALID_API_KEY = 'AUTH_INVALID_API_KEY',
  INVALID_SIGNATURE = 'AUTH_INVALID_SIGNATURE',
  FORBIDDEN = 'AUTH_FORBIDDEN',
}

export class AuthError extends AppError {
  constructor(
    code: AuthErrorCode | string,
    userMessage: string,
    recovery?: string,
    cause?: unknown,
    context?: Record<string, any>,
    requestId?: string
  ) {
    super(code, userMessage, recovery, cause, context, requestId);
    this.name = 'AuthError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export enum NotFoundErrorCode {
  RESOURCE_NOT_FOUND = 'NOT_FOUND_RESOURCE',
  USER_NOT_FOUND = 'NOT_FOUND_USER',
  SUBSCRIPTION_NOT_FOUND = 'NOT_FOUND_SUBSCRIPTION',
}

export class NotFoundError extends AppError {
  constructor(
    code: NotFoundErrorCode | string,
    userMessage: string,
    recovery?: string,
    cause?: unknown,
    context?: Record<string, any>,
    requestId?: string
  ) {
    super(code, userMessage, recovery, cause, context, requestId);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export enum RateLimitErrorCode {
  LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
}

export class RateLimitError extends AppError {
  constructor(
    code: RateLimitErrorCode | string,
    userMessage: string,
    recovery?: string,
    cause?: unknown,
    context?: Record<string, any>,
    requestId?: string
  ) {
    super(code, userMessage, recovery, cause, context, requestId);
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export enum DatabaseErrorCode {
  QUERY_FAILED = 'DATABASE_QUERY_FAILED',
  CONNECTION_LOST = 'DATABASE_CONNECTION_LOST',
  DUPLICATE_KEY = 'DATABASE_DUPLICATE_KEY',
}

export class DatabaseError extends AppError {
  constructor(
    code: DatabaseErrorCode | string,
    userMessage: string,
    recovery?: string,
    cause?: unknown,
    context?: Record<string, any>,
    requestId?: string
  ) {
    super(code, userMessage, recovery, cause, context, requestId);
    this.name = 'DatabaseError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export enum WebSocketErrorCode {
  CONNECTION_CLOSED = 'WS_CONNECTION_CLOSED',
  MESSAGE_REJECTED = 'WS_MESSAGE_REJECTED',
  AUTH_FAILED = 'WS_AUTH_FAILED',
  SUBSCRIBE_FAILED = 'WS_SUBSCRIBE_FAILED',
}

export class WebSocketError extends AppError {
  constructor(
    code: WebSocketErrorCode | string,
    userMessage: string,
    recovery?: string,
    cause?: unknown,
    context?: Record<string, any>,
    requestId?: string
  ) {
    super(code, userMessage, recovery, cause, context, requestId);
    this.name = 'WebSocketError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
