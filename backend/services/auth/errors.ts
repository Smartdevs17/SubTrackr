import { DomainError } from '../shared/errors';
import { ErrorCode } from '../shared/apiResponse';

export const AuthErrorCode = {
  API_KEY_NOT_FOUND: 'AUTH_API_KEY_NOT_FOUND' as ErrorCode,
  API_KEY_EXPIRED: 'AUTH_API_KEY_EXPIRED' as ErrorCode,
  API_KEY_INSUFFICIENT_SCOPE: 'AUTH_API_KEY_INSUFFICIENT_SCOPE' as ErrorCode,
  API_KEY_ROTATION_FAILED: 'AUTH_API_KEY_ROTATION_FAILED' as ErrorCode,
  API_KEY_REVOKED: 'AUTH_API_KEY_REVOKED' as ErrorCode,
  API_KEY_ALREADY_REVOKED: 'AUTH_API_KEY_ALREADY_REVOKED' as ErrorCode,
  LEAK_INCIDENT_NOT_FOUND: 'AUTH_LEAK_INCIDENT_NOT_FOUND' as ErrorCode,
  LEAK_INCIDENT_CLOSED: 'AUTH_LEAK_INCIDENT_CLOSED' as ErrorCode,
  PASSKEY_CHALLENGE_INVALID: 'AUTH_PASSKEY_CHALLENGE_INVALID' as ErrorCode,
  PASSKEY_VERIFICATION_FAILED: 'AUTH_PASSKEY_VERIFICATION_FAILED' as ErrorCode,
  PASSKEY_CREDENTIAL_NOT_FOUND: 'AUTH_PASSKEY_CREDENTIAL_NOT_FOUND' as ErrorCode,
  PASSKEY_CREDENTIAL_EXISTS: 'AUTH_PASSKEY_CREDENTIAL_EXISTS' as ErrorCode,
  PASSKEY_COUNTER_REGRESSION: 'AUTH_PASSKEY_COUNTER_REGRESSION' as ErrorCode,
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS' as ErrorCode,
  ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED' as ErrorCode,
  PASSWORD_POLICY_VIOLATION: 'AUTH_PASSWORD_POLICY_VIOLATION' as ErrorCode,
  REFRESH_TOKEN_INVALID: 'AUTH_REFRESH_TOKEN_INVALID' as ErrorCode,
  REFRESH_TOKEN_REUSED: 'AUTH_REFRESH_TOKEN_REUSED' as ErrorCode,
  SESSION_NOT_FOUND: 'AUTH_SESSION_NOT_FOUND' as ErrorCode,
  INSUFFICIENT_SCOPE: 'AUTH_INSUFFICIENT_SCOPE' as ErrorCode,
  USER_CODE_INVALID: 'AUTH_USER_CODE_INVALID' as ErrorCode,
  USER_CODE_ATTEMPTS_EXCEEDED: 'AUTH_USER_CODE_ATTEMPTS_EXCEEDED' as ErrorCode,
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

  static apiKeyInsufficientScope(keyId: string, requiredScope: string): AuthError {
    return new AuthError(
      AuthErrorCode.API_KEY_INSUFFICIENT_SCOPE,
      `API key ${keyId} lacks required scope: ${requiredScope}`,
      { keyId, requiredScope }
    );
  }

  static rotationFailed(keyId: string, reason: string): AuthError {
    return new AuthError(AuthErrorCode.API_KEY_ROTATION_FAILED, `Key rotation failed for ${keyId}: ${reason}`, { keyId, reason });
  }

  static apiKeyRevoked(keyId: string): AuthError {
    return new AuthError(AuthErrorCode.API_KEY_REVOKED, `API key revoked: ${keyId}`, { keyId });
  }

  static apiKeyAlreadyRevoked(keyId: string): AuthError {
    return new AuthError(AuthErrorCode.API_KEY_ALREADY_REVOKED, `API key already revoked: ${keyId}`, { keyId });
  }

  static leakIncidentNotFound(incidentId: string): AuthError {
    return new AuthError(AuthErrorCode.LEAK_INCIDENT_NOT_FOUND, `Leak incident not found: ${incidentId}`, { incidentId });
  }

  static leakIncidentClosed(incidentId: string): AuthError {
    return new AuthError(AuthErrorCode.LEAK_INCIDENT_CLOSED, `Leak incident is already resolved: ${incidentId}`, { incidentId });
  }

  static passkeyChallengeInvalid(reason: string): AuthError {
    return new AuthError(AuthErrorCode.PASSKEY_CHALLENGE_INVALID, `Passkey challenge invalid: ${reason}`, { reason });
  }

  static passkeyVerificationFailed(reason: string): AuthError {
    return new AuthError(AuthErrorCode.PASSKEY_VERIFICATION_FAILED, `Passkey verification failed: ${reason}`, { reason });
  }

  static passkeyCredentialNotFound(credentialId: string): AuthError {
    return new AuthError(AuthErrorCode.PASSKEY_CREDENTIAL_NOT_FOUND, `Passkey credential not found: ${credentialId}`, { credentialId });
  }

  static passkeyCredentialExists(credentialId: string): AuthError {
    return new AuthError(AuthErrorCode.PASSKEY_CREDENTIAL_EXISTS, `Passkey credential already registered: ${credentialId}`, { credentialId });
  }

  static passkeyCounterRegression(credentialId: string): AuthError {
    return new AuthError(
      AuthErrorCode.PASSKEY_COUNTER_REGRESSION,
      `Passkey signature counter did not increase (possible cloned authenticator): ${credentialId}`,
      { credentialId }
    );
  }

  // ── Password login (#1778) ────────────────────────────────────────────────

  /** Deliberately identical for unknown users and wrong passwords. */
  static invalidCredentials(): AuthError {
    return new AuthError(AuthErrorCode.INVALID_CREDENTIALS, 'Invalid credentials');
  }

  static accountLocked(retryAfterMs: number): AuthError {
    return new AuthError(
      AuthErrorCode.ACCOUNT_LOCKED,
      'Too many failed sign-in attempts; try again later',
      { retryAfterSeconds: String(Math.ceil(retryAfterMs / 1000)) }
    );
  }

  static passwordPolicyViolation(reason: string): AuthError {
    return new AuthError(AuthErrorCode.PASSWORD_POLICY_VIOLATION, `Password rejected: ${reason}`, { reason });
  }

  // ── Refresh tokens & sessions (#1776, #1777) ─────────────────────────────

  static refreshTokenInvalid(reason: string): AuthError {
    return new AuthError(AuthErrorCode.REFRESH_TOKEN_INVALID, `Refresh token rejected: ${reason}`, { reason });
  }

  static refreshTokenReused(): AuthError {
    return new AuthError(
      AuthErrorCode.REFRESH_TOKEN_REUSED,
      'Refresh token was already used; the session has been revoked'
    );
  }

  static sessionNotFound(sessionId: string): AuthError {
    return new AuthError(AuthErrorCode.SESSION_NOT_FOUND, `Session not found: ${sessionId}`, { sessionId });
  }

  static insufficientScope(requiredScope: string): AuthError {
    return new AuthError(
      AuthErrorCode.INSUFFICIENT_SCOPE,
      `Access token lacks required scope: ${requiredScope}`,
      { requiredScope }
    );
  }

  // ── Device authorization (#1779) ─────────────────────────────────────────

  static userCodeInvalid(reason: string): AuthError {
    return new AuthError(AuthErrorCode.USER_CODE_INVALID, `User code rejected: ${reason}`, { reason });
  }

  static userCodeAttemptsExceeded(retryAfterMs: number): AuthError {
    return new AuthError(
      AuthErrorCode.USER_CODE_ATTEMPTS_EXCEEDED,
      'Too many invalid user codes; try again later',
      { retryAfterSeconds: String(Math.ceil(retryAfterMs / 1000)) }
    );
  }
}
