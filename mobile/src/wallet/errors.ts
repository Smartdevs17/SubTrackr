/**
 * mobile/src/wallet/errors.ts
 *
 * Typed wallet failures shared by both adapters and the connect flow.
 */

export type WalletErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'USER_REJECTED'
  | 'INVALID_ADDRESS'
  | 'INVALID_SESSION'
  | 'ADAPTER_NOT_FOUND'
  | 'CONNECT_IN_PROGRESS'
  | 'CONNECT_FAILED'
  | 'DISCONNECT_FAILED';

export class WalletConnectionError extends Error {
  constructor(
    public readonly code: WalletErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'WalletConnectionError';
  }
}

const REJECTION_PATTERN = /user rejected|user denied|rejected the request|4001|-32000/i;

export function isUserRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; message?: unknown };
  if (typeof record.message === 'string' && REJECTION_PATTERN.test(record.message)) return true;
  return record.code === 4001 || record.code === -32000 || record.code === 'USER_REJECTED';
}

export function toWalletError(
  error: unknown,
  fallbackCode: WalletErrorCode = 'CONNECT_FAILED'
): WalletConnectionError {
  if (error instanceof WalletConnectionError) return error;
  if (isUserRejection(error)) {
    return new WalletConnectionError(
      'USER_REJECTED',
      'Wallet connection was rejected',
      false,
      error
    );
  }
  const message = error instanceof Error ? error.message : 'Wallet connection failed';
  return new WalletConnectionError(fallbackCode, message, true, error);
}
