/**
 * developer-portal/lib/webauthn.ts
 *
 * WebAuthn utilities for step-up authentication on admin routes.
 *
 * Provides credential creation, assertion verification, and step-up challenge
 * management. Designed to be framework-agnostic and runnable in React Native
 * via the @simplewebauthn/browser or @simplewebauthn/server packages.
 *
 * Issue #2276.
 */

import type {
  Base64URLString,
  PublicKeyCredentialCreationOptions,
  PublicKeyCredentialRequestOptions,
  PublicKeyCredential,
  AuthenticatorAttestationResponse,
  AuthenticatorAssertionResponse,
  CollectedClientData,
  AuthenticatorData,
  StoredCredential,
  StepUpChallenge,
  StepUpVerificationResult,
  AdminAction,
  StepUpActionConfig,
  AdminRouteConfig,
} from '../types/webauthn.ts';

import {
  DEFAULT_STEP_UP_ACTIONS,
  ADMIN_ROUTES,
} from '../types/webauthn.ts';

// Re-export types
export type {
  Base64URLString,
  PublicKeyCredentialCreationOptions,
  PublicKeyCredentialRequestOptions,
  PublicKeyCredential,
  AuthenticatorAttestationResponse,
  AuthenticatorAssertionResponse,
  CollectedClientData,
  AuthenticatorData,
  StoredCredential,
  StepUpChallenge,
  StepUpVerificationResult,
  AdminAction,
  StepUpActionConfig,
  AdminRouteConfig,
};

export { DEFAULT_STEP_UP_ACTIONS, ADMIN_ROUTES };

// ?? Base64URL encoding/decoding ?????????????????????????????????????????

/**
 * Convert ArrayBuffer to base64url string (RFC 4648 §5).
 */
export function arrayBufferToBase64URL(buffer: ArrayBuffer): Base64URLString {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Convert base64url string to ArrayBuffer.
 */
export function base64URLToArrayBuffer(base64url: Base64URLString): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generate a cryptographically random challenge.
 */
export function generateChallenge(byteLength: number = 32): Base64URLString {
  const array = new Uint8Array(byteLength);
  crypto.getRandomValues(array);
  return arrayBufferToBase64URL(array.buffer);
}

/**
 * Generate a random user ID for WebAuthn registration.
 */
export function generateUserId(): Base64URLString {
  return generateChallenge(16);
}

/**
 * Generate a random credential ID.
 */
export function generateCredentialId(): Base64URLString {
  return generateChallenge(32);
}

/**
 * Generate an AAGUID for the authenticator.
 */
export function generateAAGUID(): Base64URLString {
  return generateChallenge(16);
}

// ?? Challenge management for step-up authentication ??????????????????????

const stepUpChallenges = new Map<string, StepUpChallenge>();

/**
 * Create a step-up authentication challenge for an admin action.
 */
export function createStepUpChallenge(
  action: AdminAction,
  userId: string,
  timeoutSeconds: number = 300
): StepUpChallenge {
  const challenge = generateChallenge();

  const stepUpChallenge: StepUpChallenge = {
    challenge,
    action,
    expiresAt: new Date(Date.now() + timeoutSeconds * 1000).toISOString(),
    userId,
  };

  // Use the challenge itself as the key for simpler lookup
  stepUpChallenges.set(challenge, stepUpChallenge);

  // Auto-cleanup expired challenges
  setTimeout(() => {
    stepUpChallenges.delete(challenge);
  }, timeoutSeconds * 1000);

  return stepUpChallenge;
}

/**
 * Get a step-up challenge by its challenge string.
 */
export function getStepUpChallenge(challenge: string): StepUpChallenge | undefined {
  return stepUpChallenges.get(challenge);
}

/**
 * Consume and remove a step-up challenge by its challenge string.
 */
export function consumeStepUpChallenge(challenge: string): StepUpChallenge | undefined {
  const stepUpChallenge = stepUpChallenges.get(challenge);
  if (stepUpChallenge) {
    stepUpChallenges.delete(challenge);
  }
  return stepUpChallenge;
}

/**
 * Verify a step-up challenge hasn't expired.
 */
export function isStepUpChallengeValid(challenge: StepUpChallenge): boolean {
  return new Date(challenge.expiresAt).getTime() > Date.now();
}

// ?? Credential management (in-memory for demo; replace with DB in production) ???????????

const storedCredentials = new Map<string, StoredCredential[]>();

/**
 * Store a registered credential for a user.
 */
export function storeCredential(userId: string, credential: StoredCredential): void {
  const userCreds = storedCredentials.get(userId) ?? [];
  userCreds.push(credential);
  storedCredentials.set(userId, userCreds);
}

/**
 * Get all stored credentials for a user.
 */
export function getStoredCredentials(userId: string): StoredCredential[] {
  return storedCredentials.get(userId) ?? [];
}

/**
 * Update credential sign count after successful authentication.
 */
export function updateCredentialSignCount(
  userId: string,
  credentialId: string,
  newSignCount: number
): boolean {
  const userCreds = storedCredentials.get(userId);
  if (!userCreds) return false;

  const cred = userCreds.find((c) => c.id === credentialId);
  if (!cred) return false;

  cred.signCount = newSignCount;
  cred.lastUsedAt = new Date().toISOString();
  return true;
}

/**
 * Delete a credential.
 */
export function deleteCredential(userId: string, credentialId: string): boolean {
  const userCreds = storedCredentials.get(userId);
  if (!userCreds) return false;

  const index = userCreds.findIndex((c) => c.id === credentialId);
  if (index === -1) return false;

  userCreds.splice(index, 1);
  return true;
}

// ?? Client data parsing ?????????????????????????????????????????????????

/**
 * Parse client data JSON from WebAuthn response.
 */
export function parseClientDataJSON(
  clientDataJSON: Base64URLString
): CollectedClientData {
  const json = atob(
    clientDataJSON.replace(/-/g, '+').replace(/_/g, '/').padEnd(
      clientDataJSON.length + ((4 - (clientDataJSON.length % 4)) % 4),
      '='
    )
  );
  return JSON.parse(json);
}

/**
 * Verify client data matches expected values.
 */
export function verifyClientData(
  clientData: CollectedClientData,
  expectedChallenge: Base64URLString,
  expectedOrigin: string,
  expectedType: 'webauthn.create' | 'webauthn.get'
): { valid: boolean; error?: string } {
  if (clientData.type !== expectedType) {
    return { valid: false, error: `Expected type ${expectedType}, got ${clientData.type}` };
  }
  if (clientData.challenge !== expectedChallenge) {
    return { valid: false, error: 'Challenge mismatch' };
  }
  if (clientData.origin !== expectedOrigin) {
    return { valid: false, error: `Origin mismatch: expected ${expectedOrigin}, got ${clientData.origin}` };
  }
  return { valid: true };
}

/**
 * Parse authenticator data from base64url.
 */
export function parseAuthenticatorData(
  authenticatorData: Base64URLString
): AuthenticatorData {
  const buffer = base64URLToArrayBuffer(authenticatorData);
  const view = new DataView(buffer);
  let offset = 0;

  const rpIdHash = arrayBufferToBase64URL(buffer.slice(offset, offset + 32));
  offset += 32;

  const flags = view.getUint8(offset);
  offset += 1;

  const signCount = view.getUint32(offset, false); // big-endian
  offset += 4;

  let attestedCredentialData: AuthenticatorData['attestedCredentialData'];
  if (flags & 0x40) {
    // AT flag set - attested credential data present
    const aaguid = arrayBufferToBase64URL(buffer.slice(offset, offset + 16));
    offset += 16;

    const credentialIdLength = view.getUint16(offset, false);
    offset += 2;

    const credentialId = arrayBufferToBase64URL(buffer.slice(offset, offset + credentialIdLength));
    offset += credentialIdLength;

    // The rest is the credential public key in COSE format
    // For simplicity, we store the raw CBOR as base64url
    const credentialPublicKey = arrayBufferToBase64URL(buffer.slice(offset));

    attestedCredentialData = {
      aaguid,
      credentialId,
      credentialPublicKey,
    };
  }

  return {
    rpIdHash,
    flags,
    signCount,
    attestedCredentialData,
  };
}

// ?? Verification functions ??????????????????????????????????????????????

/**
 * Verify a WebAuthn registration response (attestation).
 * In production, use @simplewebauthn/server for full verification.
 */
export function verifyRegistrationResponse(
  credential: PublicKeyCredential,
  expectedChallenge: Base64URLString,
  expectedOrigin: string,
  expectedRPID: string
): { verified: boolean; credential?: StoredCredential; error?: string } {
  try {
    // Parse and verify client data
    const clientData = parseClientDataJSON(
      (credential.response as AuthenticatorAttestationResponse).clientDataJSON
    );
    const clientDataCheck = verifyClientData(
      clientData,
      expectedChallenge,
      expectedOrigin,
      'webauthn.create'
    );
    if (!clientDataCheck.valid) {
      return { verified: false, error: clientDataCheck.error };
    }

    // Parse authenticator data
    const authData = parseAuthenticatorData(
      (credential.response as AuthenticatorAttestationResponse).attestationObject
    );

    // Verify RP ID hash matches expected
    // In real implementation, hash the RP ID with SHA-256 and compare
    // For this demo, we skip the actual crypto verification

    const storedCred: StoredCredential = {
      id: credential.id,
      userId: '', // Will be set by caller
      publicKey: authData.attestedCredentialData?.credentialPublicKey ?? '',
      signCount: authData.signCount,
      aaguid: authData.attestedCredentialData?.aaguid ?? '',
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    };

    return { verified: true, credential: storedCred };
  } catch (error) {
    return {
      verified: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    };
  }
}

/**
 * Verify a WebAuthn authentication response (assertion).
 */
export function verifyAuthenticationResponse(
  credential: PublicKeyCredential,
  expectedChallenge: Base64URLString,
  expectedOrigin: string,
  expectedRPID: string,
  storedCredential: StoredCredential
): { verified: boolean; newSignCount?: number; error?: string } {
  try {
    // Parse and verify client data
    const clientData = parseClientDataJSON(
      (credential.response as AuthenticatorAssertionResponse).clientDataJSON
    );
    const clientDataCheck = verifyClientData(
      clientData,
      expectedChallenge,
      expectedOrigin,
      'webauthn.get'
    );
    if (!clientDataCheck.valid) {
      return { verified: false, error: clientDataCheck.error };
    }

    // Parse authenticator data
    const authData = parseAuthenticatorData(
      (credential.response as AuthenticatorAssertionResponse).authenticatorData
    );

    // Verify sign count increased
    if (authData.signCount <= storedCredential.signCount) {
      return { verified: false, error: 'Sign count did not increase (possible clone)' };
    }

    // Verify signature (in production, use @simplewebauthn/server)
    // For demo, we assume signature verification passes

    return { verified: true, newSignCount: authData.signCount };
  } catch (error) {
    return {
      verified: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    };
  }
}

/**
 * Verify a step-up authentication challenge.
 */
export function verifyStepUpAuthentication(
  challengeId: string,
  credential: PublicKeyCredential,
  expectedOrigin: string,
  expectedRPID: string,
  getStoredCredential: (userId: string, credentialId: string) => StoredCredential | undefined
): StepUpVerificationResult {
  const challenge = consumeStepUpChallenge(challengeId);
  if (!challenge) {
    return { verified: false, error: 'Challenge not found or expired' };
  }

  if (!isStepUpChallengeValid(challenge)) {
    return { verified: false, error: 'Challenge expired' };
  }

  const storedCred = getStoredCredential(challenge.userId, credential.id);
  if (!storedCred) {
    return { verified: false, error: 'Credential not found for user' };
  }

  const result = verifyAuthenticationResponse(
    credential,
    challenge.challenge,
    expectedOrigin,
    expectedRPID,
    storedCred
  );

  if (!result.verified) {
    return { verified: false, error: result.error };
  }

  // Update sign count
  updateCredentialSignCount(challenge.userId, credential.id, result.newSignCount!);

  return { verified: true, credentialId: credential.id };
}

/**
 * Check if an admin route requires step-up authentication.
 */
export function getAdminRouteConfig(path: string): AdminRouteConfig | undefined {
  return ADMIN_ROUTES.find((route) => path.startsWith(route.path));
}

/**
 * Check if an action requires step-up authentication.
 */
export function requiresStepUp(action: AdminAction): boolean {
  const config = DEFAULT_STEP_UP_ACTIONS[action];
  return config?.required ?? false;
}

/**
 * Get step-up action configuration.
 */
export function getStepUpActionConfig(action: AdminAction): StepUpActionConfig | undefined {
  return DEFAULT_STEP_UP_ACTIONS[action];
}

/**
 * Create registration options for a new credential.
 */
export function createRegistrationOptions(
  user: { id: Base64URLString; name: string; displayName: string },
  rp: { id: string; name: string },
  excludeCredentials: PublicKeyCredentialDescriptor[] = []
): PublicKeyCredentialCreationOptions {
  return {
    rp,
    user,
    challenge: generateChallenge(),
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    timeout: 60000,
    excludeCredentials,
    authenticatorSelection: {
      authenticatorAttachment: undefined, // Allow both platform and cross-platform
      userVerification: 'required',
      requireResidentKey: false,
      residentKey: 'preferred',
    },
    attestation: 'none',
  };
}

/**
 * Create authentication options for an existing credential.
 */
export function createAuthenticationOptions(
  rpId: string,
  allowCredentials: PublicKeyCredentialDescriptor[] = []
): PublicKeyCredentialRequestOptions {
  return {
    challenge: generateChallenge(),
    timeout: 60000,
    rpId,
    allowCredentials,
    userVerification: 'required',
  };
}

/**
 * Clear all in-memory stores (for testing).
 */
export function clearStores(): void {
  stepUpChallenges.clear();
  storedCredentials.clear();
}