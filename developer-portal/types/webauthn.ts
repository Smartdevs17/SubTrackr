/**
 * developer-portal/types/webauthn.ts
 *
 * Type definitions for WebAuthn step-up authentication.
 * Used to protect admin routes with hardware-backed credential verification.
 */

// Base64URL encoding (RFC 4648 §5) without padding
export type Base64URLString = string;

/**
 * WebAuthn Relying Party identifier.
 * Must match the effective domain of the origin.
 */
export interface WebAuthnRelyingParty {
  id: string;
  name: string;
}

/**
 * User entity for WebAuthn registration/authentication.
 */
export interface WebAuthnUser {
  id: Base64URLString;
  name: string;
  displayName: string;
}

/**
 * Public key credential parameters for registration.
 */
export type PublicKeyCredentialType = 'public-key';

export interface PublicKeyCredentialParameters {
  type: PublicKeyCredentialType;
  alg: number; // COSE algorithm identifier (e.g., -7 for ES256, -257 for RS256)
}

/**
 * Authenticator selection criteria for registration.
 */
export interface AuthenticatorSelectionCriteria {
  /**
   * 'platform' for platform authenticators (Touch ID, Windows Hello)
   * 'cross-platform' for roaming authenticators (security keys)
   * undefined for no preference
   */
  authenticatorAttachment?: 'platform' | 'cross-platform';

  /**
   * 'required' - user verification must be performed
   * 'preferred' - user verification preferred but not required
   * 'discouraged' - user verification not needed
   */
  userVerification?: 'required' | 'preferred' | 'discouraged';

  /**
   * 'true' - only allow resident (discoverable) credentials
   * 'false' - non-resident credentials allowed
   */
  requireResidentKey?: boolean;

  /**
   * 'true' - require resident key
   * 'preferred' - prefer resident key
   * 'discouraged' - discourage resident key
   */
  residentKey?: 'required' | 'preferred' | 'discouraged';
}

/**
 * Options for WebAuthn credential creation (registration).
 */
export interface PublicKeyCredentialCreationOptions {
  rp: WebAuthnRelyingParty;
  user: WebAuthnUser;
  challenge: Base64URLString;
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: PublicKeyCredentialDescriptor[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: 'none' | 'indirect' | 'direct' | 'enterprise';
  extensions?: Record<string, unknown>;
}

/**
 * Options for WebAuthn assertion (authentication).
 */
export interface PublicKeyCredentialRequestOptions {
  challenge: Base64URLString;
  timeout?: number;
  rpId?: string;
  allowCredentials?: PublicKeyCredentialDescriptor[];
  userVerification?: 'required' | 'preferred' | 'discouraged';
  extensions?: Record<string, unknown>;
}

/**
 * Credential descriptor for allow/exclude lists.
 */
export interface PublicKeyCredentialDescriptor {
  type: PublicKeyCredentialType;
  id: Base64URLString;
  transports?: ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid')[];
}

/**
 * Authenticator attestation response (registration).
 */
export interface AuthenticatorAttestationResponse {
  clientDataJSON: Base64URLString;
  attestationObject: Base64URLString;
  transports?: ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid')[];
}

/**
 * Authenticator assertion response (authentication).
 */
export interface AuthenticatorAssertionResponse {
  clientDataJSON: Base64URLString;
  authenticatorData: Base64URLString;
  signature: Base64URLString;
  userHandle?: Base64URLString | null;
}

/**
 * Public key credential from the WebAuthn API.
 */
export interface PublicKeyCredential {
  id: string;
  rawId: ArrayBuffer;
  type: PublicKeyCredentialType;
  response: AuthenticatorAttestationResponse | AuthenticatorAssertionResponse;
  authenticatorAttachment?: string;
}

/**
 * Parsed client data from WebAuthn responses.
 */
export interface CollectedClientData {
  type: 'webauthn.create' | 'webauthn.get';
  challenge: Base64URLString;
  origin: string;
  crossOrigin?: boolean;
}

/**
 * Parsed authenticator data.
 */
export interface AuthenticatorData {
  rpIdHash: Base64URLString;
  flags: number;
  signCount: number;
  attestedCredentialData?: {
    aaguid: Base64URLString;
    credentialId: Base64URLString;
    credentialPublicKey: Base64URLString;
  };
  extensions?: Record<string, unknown>;
}

/**
 * Step-up authentication challenge.
 * Used to gate admin actions with WebAuthn verification.
 */
export interface StepUpChallenge {
  challenge: Base64URLString;
  action: string; // e.g., 'delete_user', 'rotate_keys', 'export_data'
  expiresAt: string; // ISO 8601
  userId: string;
}

/**
 * Step-up verification result.
 */
export interface StepUpVerificationResult {
  verified: boolean;
  credentialId?: string;
  error?: string;
}

/**
 * WebAuthn credential stored in the backend.
 */
export interface StoredCredential {
  id: Base64URLString;
  userId: string;
  publicKey: Base64URLString;
  signCount: number;
  transports?: ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid')[];
  aaguid: Base64URLString;
  createdAt: string;
  lastUsedAt: string;
  name?: string; // User-friendly name (e.g., "YubiKey 5")
}

/**
 * Admin action requiring step-up authentication.
 */
export type AdminAction =
  | 'delete_user'
  | 'suspend_user'
  | 'rotate_api_keys'
  | 'export_user_data'
  | 'modify_billing'
  | 'manage_webhooks'
  | 'configure_sso'
  | 'delete_environment'
  | 'reset_credentials'
  | 'view_audit_logs';

/**
 * Configuration for step-up protected actions.
 */
export interface StepUpActionConfig {
  action: AdminAction;
  required: boolean;
  timeoutSeconds?: number;
  description: string;
}

/**
 * Admin route configuration with step-up requirements.
 */
export interface AdminRouteConfig {
  path: string;
  action?: AdminAction;
  requireStepUp: boolean;
  roles?: string[];
}

// Default step-up protected actions
export const DEFAULT_STEP_UP_ACTIONS: Record<AdminAction, StepUpActionConfig> = {
  delete_user: {
    action: 'delete_user',
    required: true,
    timeoutSeconds: 300,
    description: 'Permanently delete a user account and all associated data',
  },
  suspend_user: {
    action: 'suspend_user',
    required: true,
    timeoutSeconds: 300,
    description: 'Suspend or reactivate a user account',
  },
  rotate_api_keys: {
    action: 'rotate_api_keys',
    required: true,
    timeoutSeconds: 600,
    description: 'Rotate or revoke API keys for a user or environment',
  },
  export_user_data: {
    action: 'export_user_data',
    required: true,
    timeoutSeconds: 600,
    description: 'Export user data for GDPR/portability requests',
  },
  modify_billing: {
    action: 'modify_billing',
    required: true,
    timeoutSeconds: 300,
    description: 'Modify billing configuration, plans, or payment methods',
  },
  manage_webhooks: {
    action: 'manage_webhooks',
    required: true,
    timeoutSeconds: 300,
    description: 'Create, update, or delete webhook endpoints',
  },
  configure_sso: {
    action: 'configure_sso',
    required: true,
    timeoutSeconds: 600,
    description: 'Configure SSO/SAML/OIDC providers',
  },
  delete_environment: {
    action: 'delete_environment',
    required: true,
    timeoutSeconds: 300,
    description: 'Delete a sandbox environment and all its resources',
  },
  reset_credentials: {
    action: 'reset_credentials',
    required: true,
    timeoutSeconds: 300,
    description: 'Reset user passwords, MFA, or recovery codes',
  },
  view_audit_logs: {
    action: 'view_audit_logs',
    required: false,
    timeoutSeconds: 300,
    description: 'View security audit logs and access trails',
  },
};

/**
 * Admin route configuration with step-up requirements.
 */
export interface AdminRouteConfig {
  path: string;
  action?: AdminAction;
  requireStepUp: boolean;
  roles?: string[];
}

// Default admin routes requiring step-up
export const ADMIN_ROUTES: AdminRouteConfig[] = [
  { path: '/admin/users/delete', action: 'delete_user', requireStepUp: true },
  { path: '/admin/users/suspend', action: 'suspend_user', requireStepUp: true },
  { path: '/admin/api-keys/rotate', action: 'rotate_api_keys', requireStepUp: true },
  { path: '/admin/export', action: 'export_user_data', requireStepUp: true },
  { path: '/admin/billing', action: 'modify_billing', requireStepUp: true },
  { path: '/admin/webhooks', action: 'manage_webhooks', requireStepUp: true },
  { path: '/admin/sso', action: 'configure_sso', requireStepUp: true },
  { path: '/admin/environments/delete', action: 'delete_environment', requireStepUp: true },
  { path: '/admin/credentials/reset', action: 'reset_credentials', requireStepUp: true },
  { path: '/admin/audit-logs', action: 'view_audit_logs', requireStepUp: false },
];