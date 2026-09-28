export {
  ApiKeyRotationService,
  apiKeyRotationService,
  hashApiKey,
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
export { AuthError, AuthErrorCode } from './errors';
