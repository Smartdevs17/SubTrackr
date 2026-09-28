export interface ApiKeyRecord {
  id: string;
  merchantId: string;
  keyPrefix: string;
  keyHash: string;
  status: 'active' | 'expired' | 'revoked';
  rotatedAt: string | null;
  revokedAt?: string | null;
  revocationReason?: string | null;
  expiresAt: string | null;
  gracePeriodEndsAt: string | null;
  createdAt: string;
}

export interface ApiKeyRotationPolicy {
  intervalDays: 30 | 60 | 90;
  gracePeriodHours: number;
}

export interface IApiKeyRotationService {
  rotateKey(keyId: string): Promise<ApiKeyRecord>;
  forceRotateKey(keyId: string): Promise<ApiKeyRecord>;
  getRotationHistory(keyId: string): Promise<ApiKeyRecord[]>;
  getPolicy(merchantId: string): Promise<ApiKeyRotationPolicy>;
  updatePolicy(merchantId: string, policy: Partial<ApiKeyRotationPolicy>): Promise<ApiKeyRotationPolicy>;
}

// ── API key revocation & leak detection (Issue #1273) ──────────────────────

export type LeakDetectionMethod = 'pattern_scan' | 'hash_match' | 'usage_anomaly' | 'manual_report';
export type LeakIncidentSeverity = 'medium' | 'high' | 'critical';
export type LeakIncidentStatus = 'open' | 'auto_revoked' | 'revoked' | 'dismissed';

export interface LeakIncident {
  id: string;
  keyId: string;
  merchantId: string;
  method: LeakDetectionMethod;
  severity: LeakIncidentSeverity;
  status: LeakIncidentStatus;
  /** Where the key was found (repo URL, paste site, log stream, ...). */
  source: string;
  /** Redacted fingerprint of the exposed key — never the raw secret. */
  redactedKey: string;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  details: Record<string, unknown>;
}

export interface LeakDetectionPolicy {
  /** Revoke immediately when a live key is found in scanned content or a breach feed. */
  autoRevokeOnExposure: boolean;
  /** Revoke immediately when usage anomalies are detected (otherwise flag for review). */
  autoRevokeOnAnomaly: boolean;
  /** Sliding window used for usage anomaly detection. */
  anomalyWindowMs: number;
  /** Distinct client IPs allowed per key inside the window before flagging. */
  maxDistinctIps: number;
  /** Requests allowed per key inside the window before flagging. */
  maxRequestsPerWindow: number;
}

export interface ApiKeyUsageEvent {
  keyId: string;
  ip: string;
  userAgent?: string;
  timestamp?: number;
}

export interface ApiKeyRevocationAuditEntry {
  id: string;
  keyId: string;
  merchantId: string;
  action: 'revoked' | 'leak_detected' | 'anomaly_flagged' | 'incident_dismissed';
  actorId: string;
  reason: string;
  incidentId: string | null;
  timestamp: string;
}

export interface LeakScanResult {
  scannedCandidates: number;
  incidents: LeakIncident[];
}

// ── Passkeys / WebAuthn (Issue #1272) ─────────────────────────────────────

export type UserVerificationRequirement = 'required' | 'preferred' | 'discouraged';
export type PasskeyCredentialStatus = 'active' | 'suspended';

export interface PasskeyConfig {
  /** Relying party ID — the registrable domain passkeys are scoped to. */
  rpId: string;
  rpName: string;
  /** Exact origins allowed to perform ceremonies (scheme + host + port). */
  origins: string[];
  challengeTtlMs: number;
  userVerification: UserVerificationRequirement;
  maxCredentialsPerUser: number;
}

export interface PasskeyCredential {
  /** base64url credential ID */
  id: string;
  userId: string;
  /** base64url COSE-encoded public key */
  publicKey: string;
  algorithm: number;
  signCount: number;
  transports: string[];
  aaguid: string;
  backupEligible: boolean;
  backedUp: boolean;
  deviceName: string;
  status: PasskeyCredentialStatus;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PublicKeyCredentialDescriptorJSON {
  type: 'public-key';
  id: string;
  transports?: string[];
}

export interface PasskeyRegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout: number;
  attestation: 'none';
  excludeCredentials: PublicKeyCredentialDescriptorJSON[];
  authenticatorSelection: {
    residentKey: 'required' | 'preferred' | 'discouraged';
    userVerification: UserVerificationRequirement;
  };
}

export interface PasskeyAuthenticationOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  allowCredentials: PublicKeyCredentialDescriptorJSON[];
  userVerification: UserVerificationRequirement;
}

/** JSON-serialised `PublicKeyCredential` returned by `navigator.credentials.create()`. */
export interface PasskeyRegistrationResponse {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
}

/** JSON-serialised `PublicKeyCredential` returned by `navigator.credentials.get()`. */
export interface PasskeyAuthenticationResponse {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string | null;
  };
}

export interface PasskeyAuthenticationResult {
  userId: string;
  credentialId: string;
  userVerified: boolean;
  signCount: number;
}

export interface PasskeyAuditEntry {
  userId: string | null;
  credentialId: string | null;
  action:
    | 'registration_started'
    | 'registered'
    | 'registration_failed'
    | 'authentication_started'
    | 'authenticated'
    | 'authentication_failed'
    | 'counter_regression'
    | 'removed';
  timestamp: string;
  detail?: string;
}
