import { DomainError } from '../shared/errors';
import { ErrorCode } from '../shared/apiResponse';

export const AuthErrorCode = {
  API_KEY_NOT_FOUND: 'AUTH_API_KEY_NOT_FOUND' as ErrorCode,
  API_KEY_EXPIRED: 'AUTH_API_KEY_EXPIRED' as ErrorCode,
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
}
