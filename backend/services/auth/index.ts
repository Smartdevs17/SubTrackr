export {
  ApiKeyRotationService,
  apiKeyRotationService,
  hashApiKey,
  hasScope,
} from './domain/ApiKeyRotationService';
export {
  ApiKeyRevocationService,
  apiKeyRevocationService,
  redactApiKey,
  DEFAULT_LEAK_DETECTION_POLICY,
} from './domain/ApiKeyRevocationService';
export type { RevocableKeyStore } from './domain/ApiKeyRevocationService';
export { PasskeyService, passkeyService, DEFAULT_PASSKEY_CONFIG } from './domain/PasskeyService';
export {
  RotationConfigController,
  rotationConfigController,
} from './controller/rotationConfigController';
export { CmkConfigController, cmkConfigController } from './controller/cmkConfigController';
export type { CmkConfig } from './controller/cmkConfigController';
export {
  ApiKeyRevocationController,
  apiKeyRevocationController,
} from './controller/apiKeyRevocationController';
export { PasskeyController, passkeyController } from './controller/passkeyController';
export type { PasskeySummary } from './controller/passkeyController';
export { KeyRotationCron, keyRotationCron } from './jobs/keyRotationCron';
export type {
  ApiKeyRecord,
  ApiKeyRotationPolicy,
  IApiKeyRotationService,
  ApiKeyRevocationAuditEntry,
  ApiKeyUsageEvent,
  LeakDetectionMethod,
  LeakDetectionPolicy,
  LeakIncident,
  LeakIncidentStatus,
  LeakScanResult,
  PasskeyAuthenticationOptions,
  PasskeyAuthenticationResponse,
  PasskeyAuthenticationResult,
  PasskeyConfig,
  PasskeyCredential,
  PasskeyRegistrationOptions,
  PasskeyRegistrationResponse,
} from './interfaces';
export {
  LoginAnomalyService,
  loginAnomalyService,
  DEFAULT_ANOMALY_CONFIG,
  calculateHaversineDistanceKm,
} from './domain/LoginAnomalyService';
export type {
  LoginAnomalyAlert,
  LoginAnomalyConfig,
  LoginAttempt,
  AnomalySeverity,
} from './domain/LoginAnomalyService';
export {
  AccountRecoveryService,
  accountRecoveryService,
  DEFAULT_RECOVERY_CONFIG,
} from './domain/AccountRecoveryService';
export type {
  AccountRecoveryConfig,
  RecoveryAction,
  RecoveryAuditEntry,
  RecoverySession,
} from './domain/AccountRecoveryService';
export {
  SessionTokenService,
  sessionTokenService,
  DEFAULT_REFRESH_TOKEN_CONFIG,
  hashRefreshToken,
} from './domain/SessionTokenService';
export type {
  AuthMethod,
  IssuedSession,
  RefreshTokenConfig,
  SessionSummary,
  TokenFamily,
} from './domain/SessionTokenService';
export {
  PasswordCredentialService,
  passwordCredentialService,
  DEFAULT_PASSWORD_POLICY,
} from './domain/PasswordCredentialService';
export {
  DeviceAuthorizationService,
  deviceAuthorizationService,
  DEFAULT_DEVICE_FLOW_CONFIG,
  DEVICE_CODE_GRANT_TYPE,
  OAuthError,
} from './domain/DeviceAuthorizationService';
export type { DeviceClient, DeviceFlowConfig } from './domain/DeviceAuthorizationService';
export { createRequireAuth, extractAccessToken } from './middleware/sessionAuth';
export { createSessionRouter } from './router/sessionRouter';
export { AuthError, AuthErrorCode } from './errors';

