import { DomainError } from '../shared/errors';
import { ErrorCode } from '../shared/apiResponse';

export const AuthErrorCode = {
  API_KEY_NOT_FOUND: 'AUTH_API_KEY_NOT_FOUND' as ErrorCode,
  API_KEY_EXPIRED: 'AUTH_API_KEY_EXPIRED' as ErrorCode,
  API_KEY_ROTATION_FAILED: 'AUTH_API_KEY_ROTATION_FAILED' as ErrorCode,
  API_KEY_REVOKED: 'AUTH_API_KEY_REVOKED' as ErrorCode,
} as const;

export class AuthError extends DomainError {
  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(code, message, details);
  }

  static apiKeyNotFound(keyId: string): AuthError {
    return new AuthError(AuthErrorCode.API_KEY_NOT_FOUND, `API key not found: ${keyId}`, { keyId });
  }

  static apiKeyExpired(keyId: string): AuthError {
    return new AuthError(AuthErrorCode.API_KEY_EXPIRED, `API key expired: ${keyId}`, { keyId });
  }

  static rotationFailed(keyId: string, reason: string): AuthError {
    return new AuthError(AuthErrorCode.API_KEY_ROTATION_FAILED, `Key rotation failed for ${keyId}: ${reason}`, { keyId, reason });
  }

  static apiKeyRevoked(keyId: string): AuthError {
    return new AuthError(AuthErrorCode.API_KEY_REVOKED, `API key revoked: ${keyId}`, { keyId });
  }
}
