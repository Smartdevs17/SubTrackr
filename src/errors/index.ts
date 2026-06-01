export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly recovery?: string;
  readonly cause?: unknown;
  readonly context?: Record<string, any>;

  constructor(
    code: string,
    userMessage: string,
    recovery?: string,
    cause?: unknown,
    context?: Record<string, any>
  ) {
    const fullMessage = cause instanceof Error ? `${userMessage} (Caused by: ${cause.message})` : userMessage;
    super(fullMessage);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.recovery = recovery;
    this.cause = cause;
    this.context = context;

    // Ensure the prototype is set correctly for custom ES5/ES6 inheritance in older JS runtimes
    Object.setPrototypeOf(this, new.target.prototype);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
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
    context?: Record<string, any>
  ) {
    super(code, userMessage, recovery, cause, context);
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
    context?: Record<string, any>
  ) {
    super(code, userMessage, recovery, cause, context);
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
    context?: Record<string, any>
  ) {
    super(code, userMessage, recovery, cause, context);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
