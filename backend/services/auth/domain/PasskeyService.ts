/**
 * Passkey (WebAuthn) Service — SubTrackr
 *
 * Issue #1272: Implement passwordless login with passkeys
 *
 * Features:
 *   - Registration ceremony: options generation + attestation verification
 *     (`none` and `packed` attestation formats)
 *   - Authentication ceremony: options generation (username or usernameless /
 *     discoverable credentials) + assertion signature verification
 *   - Single-use, expiring challenges bound to ceremony type (and user)
 *   - Origin, RP ID hash, user presence and user verification checks
 *   - Signature counter checks — regressions suspend the credential
 *   - Credential storage per user (ES256, EdDSA, RS256 public keys)
 *   - Audit trail for every ceremony outcome
 */

import { randomBytes, timingSafeEqual, X509Certificate } from 'crypto';
import { AuthError } from '../errors';
import { logger } from '../../shared/logging';
import {
  SUPPORTED_COSE_ALGORITHMS,
  coseToPublicKey,
  decodeCbor,
  fromBase64Url,
  parseAuthenticatorData,
  sha256,
  toBase64Url,
  verifySignature,
  type CborValue,
  type CoseAlgorithm,
  type ParsedAuthenticatorData,
} from './webauthn';
import type {
  PasskeyAuditEntry,
  PasskeyAuthenticationOptions,
  PasskeyAuthenticationResponse,
  PasskeyAuthenticationResult,
  PasskeyConfig,
  PasskeyCredential,
  PasskeyRegistrationOptions,
  PasskeyRegistrationResponse,
  PublicKeyCredentialDescriptorJSON,
} from '../interfaces';

const CHALLENGE_BYTE_LENGTH = 32;
const USER_HANDLE_BYTE_LENGTH = 32;
const MAX_AUDIT_ENTRIES = 10_000;

type CeremonyType = 'registration' | 'authentication';

interface PendingChallenge {
  challenge: string;
  type: CeremonyType;
  userId: string | null;
  expiresAt: number;
}

interface CollectedClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

export const DEFAULT_PASSKEY_CONFIG: PasskeyConfig = {
  rpId: process.env['PASSKEY_RP_ID'] ?? 'localhost',
  rpName: process.env['PASSKEY_RP_NAME'] ?? 'SubTrackr',
  origins: (process.env['PASSKEY_ORIGINS'] ?? 'http://localhost:8081')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  challengeTtlMs: 5 * 60 * 1000,
  userVerification: 'preferred',
  maxCredentialsPerUser: 10,
};

export class PasskeyService {
  private config: PasskeyConfig;
  private challenges = new Map<string, PendingChallenge>(); // challenge → pending
  private credentials = new Map<string, PasskeyCredential>(); // credentialId → credential
  private userCredentials = new Map<string, Set<string>>(); // userId → Set<credentialId>
  private userHandles = new Map<string, string>(); // userId → base64url user handle
  private auditLog: PasskeyAuditEntry[] = [];

  constructor(config: Partial<PasskeyConfig> = {}) {
    this.config = { ...DEFAULT_PASSKEY_CONFIG, ...config };
  }

  // ── Registration ─────────────────────────────────────────────────────────

  generateRegistrationOptions(input: {
    userId: string;
    userName: string;
    displayName?: string;
  }): PasskeyRegistrationOptions {
    if (!input.userId) throw AuthError.passkeyChallengeInvalid('userId is required');
    if (!input.userName) throw AuthError.passkeyChallengeInvalid('userName is required');

    const challenge = this.issueChallenge('registration', input.userId);
    this.audit({ userId: input.userId, credentialId: null, action: 'registration_started' });

    return {
      challenge,
      rp: { id: this.config.rpId, name: this.config.rpName },
      user: {
        id: this.getOrCreateUserHandle(input.userId),
        name: input.userName,
        displayName: input.displayName ?? input.userName,
      },
      pubKeyCredParams: SUPPORTED_COSE_ALGORITHMS.map((alg) => ({ type: 'public-key', alg })),
      timeout: this.config.challengeTtlMs,
      attestation: 'none',
      excludeCredentials: this.describeCredentials(input.userId),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: this.config.userVerification,
      },
    };
  }

  verifyRegistration(input: {
    userId: string;
    response: PasskeyRegistrationResponse;
    deviceName?: string;
  }): PasskeyCredential {
    const { userId, response } = input;
    try {
      this.assertCredentialShape(response);
      const { clientDataHash } = this.consumeClientData(
        response.response.clientDataJSON,
        'registration',
        'webauthn.create',
        userId
      );

      const attestation = decodeCbor(
        this.decode(response.response.attestationObject, 'attestationObject')
      );
      if (!(attestation instanceof Map)) {
        throw AuthError.passkeyVerificationFailed('attestationObject is not a CBOR map');
      }
      const fmt = attestation.get('fmt');
      const attStmt = attestation.get('attStmt');
      const authDataRaw = attestation.get('authData');
      if (typeof fmt !== 'string' || !(attStmt instanceof Map) || !Buffer.isBuffer(authDataRaw)) {
        throw AuthError.passkeyVerificationFailed('attestationObject is malformed');
      }

      const authData = this.parseAuthData(authDataRaw);
      this.assertAuthDataFlags(authData);
      const attested = authData.attestedCredentialData;
      if (!attested) throw AuthError.passkeyVerificationFailed('attested credential data missing');

      const rawId = this.decode(response.rawId, 'rawId');
      if (!rawId.equals(attested.credentialId) || response.id !== toBase64Url(rawId)) {
        throw AuthError.passkeyVerificationFailed('credential ID mismatch');
      }

      let publicKey: ReturnType<typeof coseToPublicKey>;
      try {
        publicKey = coseToPublicKey(attested.credentialPublicKey);
      } catch (err) {
        throw AuthError.passkeyVerificationFailed(
          err instanceof Error ? err.message : 'invalid public key'
        );
      }

      this.verifyAttestationStatement(
        fmt,
        attStmt,
        Buffer.concat([authDataRaw, clientDataHash]),
        publicKey
      );

      const credentialId = toBase64Url(attested.credentialId);
      if (this.credentials.has(credentialId)) throw AuthError.passkeyCredentialExists(credentialId);
      const existing = this.userCredentials.get(userId) ?? new Set<string>();
      if (existing.size >= this.config.maxCredentialsPerUser) {
        throw AuthError.passkeyVerificationFailed('maximum number of passkeys reached');
      }

      const credential: PasskeyCredential = {
        id: credentialId,
        userId,
        publicKey: toBase64Url(attested.credentialPublicKey),
        algorithm: publicKey.algorithm,
        signCount: authData.signCount,
        transports: Array.isArray(response.response.transports)
          ? [...response.response.transports]
          : [],
        aaguid: attested.aaguid,
        backupEligible: authData.backupEligible,
        backedUp: authData.backedUp,
        deviceName: input.deviceName?.trim() || 'Passkey',
        status: 'active',
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      };

      this.credentials.set(credentialId, credential);
      existing.add(credentialId);
      this.userCredentials.set(userId, existing);

      this.audit({ userId, credentialId, action: 'registered', detail: `fmt=${fmt}` });
      logger.info('Passkey registered', { userId, credentialId });
      return { ...credential };
    } catch (err) {
      this.audit({
        userId,
        credentialId: null,
        action: 'registration_failed',
        detail: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // ── Authentication ───────────────────────────────────────────────────────

  /**
   * Generate assertion options. When `userId` is omitted the ceremony is
   * usernameless and relies on discoverable credentials (the authenticator
   * returns the user handle).
   */
  generateAuthenticationOptions(input: { userId?: string } = {}): PasskeyAuthenticationOptions {
    const userId = input.userId ?? null;
    const challenge = this.issueChallenge('authentication', userId);
    this.audit({ userId, credentialId: null, action: 'authentication_started' });

    return {
      challenge,
      rpId: this.config.rpId,
      timeout: this.config.challengeTtlMs,
      allowCredentials: userId ? this.describeCredentials(userId) : [],
      userVerification: this.config.userVerification,
    };
  }

  verifyAuthentication(response: PasskeyAuthenticationResponse): PasskeyAuthenticationResult {
    let credential: PasskeyCredential | undefined;
    try {
      this.assertCredentialShape(response);
      const { clientDataHash, pending } = this.consumeClientData(
        response.response.clientDataJSON,
        'authentication',
        'webauthn.get'
      );

      const credentialId = toBase64Url(this.decode(response.rawId, 'rawId'));
      if (response.id !== credentialId)
        throw AuthError.passkeyVerificationFailed('credential ID mismatch');

      credential = this.credentials.get(credentialId);
      if (!credential) throw AuthError.passkeyCredentialNotFound(credentialId);
      if (credential.status !== 'active') {
        throw AuthError.passkeyVerificationFailed('credential is suspended');
      }
      if (pending.userId && pending.userId !== credential.userId) {
        throw AuthError.passkeyVerificationFailed(
          'credential does not belong to the requested user'
        );
      }
      if (response.response.userHandle) {
        const expectedHandle = this.userHandles.get(credential.userId);
        if (response.response.userHandle !== expectedHandle) {
          throw AuthError.passkeyVerificationFailed('user handle mismatch');
        }
      }

      const authDataRaw = this.decode(response.response.authenticatorData, 'authenticatorData');
      const authData = this.parseAuthData(authDataRaw);
      this.assertAuthDataFlags(authData);

      const { keyObject } = coseToPublicKey(fromBase64Url(credential.publicKey));
      const signature = this.decode(response.response.signature, 'signature');
      const signedData = Buffer.concat([authDataRaw, clientDataHash]);
      if (
        !verifySignature(credential.algorithm as CoseAlgorithm, keyObject, signedData, signature)
      ) {
        throw AuthError.passkeyVerificationFailed('invalid signature');
      }

      // Authenticators that do not implement a counter always report 0. Any
      // other value must strictly increase, otherwise the key may be cloned.
      if (
        (authData.signCount !== 0 || credential.signCount !== 0) &&
        authData.signCount <= credential.signCount
      ) {
        credential.status = 'suspended';
        this.audit({
          userId: credential.userId,
          credentialId,
          action: 'counter_regression',
          detail: `stored=${credential.signCount} received=${authData.signCount}`,
        });
        logger.warn('Passkey counter regression — credential suspended', {
          userId: credential.userId,
          credentialId,
        });
        throw AuthError.passkeyCounterRegression(credentialId);
      }

      credential.signCount = authData.signCount;
      credential.backedUp = authData.backedUp;
      credential.lastUsedAt = new Date().toISOString();

      this.audit({ userId: credential.userId, credentialId, action: 'authenticated' });
      return {
        userId: credential.userId,
        credentialId,
        userVerified: authData.userVerified,
        signCount: authData.signCount,
      };
    } catch (err) {
      this.audit({
        userId: credential?.userId ?? null,
        credentialId: credential?.id ?? null,
        action: 'authentication_failed',
        detail: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // ── Credential management ────────────────────────────────────────────────

  listCredentials(userId: string): PasskeyCredential[] {
    const ids = this.userCredentials.get(userId) ?? new Set<string>();
    return Array.from(ids)
      .map((id) => this.credentials.get(id))
      .filter((c): c is PasskeyCredential => c !== undefined)
      .map((c) => ({ ...c }));
  }

  removeCredential(userId: string, credentialId: string): boolean {
    const credential = this.credentials.get(credentialId);
    if (!credential || credential.userId !== userId) {
      throw AuthError.passkeyCredentialNotFound(credentialId);
    }
    this.credentials.delete(credentialId);
    this.userCredentials.get(userId)?.delete(credentialId);
    this.audit({ userId, credentialId, action: 'removed' });
    return true;
  }

  /** Drop expired challenges. Returns the number removed. */
  sweepExpiredChallenges(now = Date.now()): number {
    let removed = 0;
    for (const [challenge, pending] of this.challenges) {
      if (pending.expiresAt <= now) {
        this.challenges.delete(challenge);
        removed++;
      }
    }
    return removed;
  }

  getAuditLog(options: { userId?: string; limit?: number } = {}): PasskeyAuditEntry[] {
    const filtered = options.userId
      ? this.auditLog.filter((e) => e.userId === options.userId)
      : this.auditLog;
    return filtered.slice(-(options.limit ?? 100)).reverse();
  }

  getConfig(): PasskeyConfig {
    return { ...this.config, origins: [...this.config.origins] };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private issueChallenge(type: CeremonyType, userId: string | null): string {
    this.sweepExpiredChallenges();
    const challenge = toBase64Url(randomBytes(CHALLENGE_BYTE_LENGTH));
    this.challenges.set(challenge, {
      challenge,
      type,
      userId,
      expiresAt: Date.now() + this.config.challengeTtlMs,
    });
    return challenge;
  }

  /**
   * Parse `clientDataJSON`, validate type/origin and consume the matching
   * challenge. Challenges are single-use: they are removed even when a later
   * verification step fails, which prevents replaying a captured response.
   */
  private consumeClientData(
    clientDataJSON: string,
    ceremony: CeremonyType,
    expectedType: 'webauthn.create' | 'webauthn.get',
    expectedUserId?: string
  ): { clientData: CollectedClientData; clientDataHash: Buffer; pending: PendingChallenge } {
    const raw = this.decode(clientDataJSON, 'clientDataJSON');
    let clientData: CollectedClientData;
    try {
      clientData = JSON.parse(raw.toString('utf8')) as CollectedClientData;
    } catch {
      throw AuthError.passkeyVerificationFailed('clientDataJSON is not valid JSON');
    }

    const pending =
      typeof clientData.challenge === 'string'
        ? this.challenges.get(clientData.challenge)
        : undefined;
    if (!pending) throw AuthError.passkeyChallengeInvalid('unknown or already used challenge');
    this.challenges.delete(pending.challenge);

    if (pending.expiresAt <= Date.now())
      throw AuthError.passkeyChallengeInvalid('challenge expired');
    if (pending.type !== ceremony)
      throw AuthError.passkeyChallengeInvalid('challenge issued for a different ceremony');
    if (expectedUserId !== undefined && pending.userId !== expectedUserId) {
      throw AuthError.passkeyChallengeInvalid('challenge issued for a different user');
    }
    if (clientData.type !== expectedType) {
      throw AuthError.passkeyVerificationFailed(
        `unexpected client data type "${String(clientData.type)}"`
      );
    }
    if (!this.config.origins.includes(clientData.origin)) {
      throw AuthError.passkeyVerificationFailed(`origin not allowed: ${String(clientData.origin)}`);
    }
    if (clientData.crossOrigin === true) {
      throw AuthError.passkeyVerificationFailed('cross-origin ceremonies are not allowed');
    }

    return { clientData, clientDataHash: sha256(raw), pending };
  }

  private parseAuthData(raw: Buffer): ParsedAuthenticatorData {
    try {
      return parseAuthenticatorData(raw);
    } catch (err) {
      throw AuthError.passkeyVerificationFailed(
        err instanceof Error ? err.message : 'invalid authenticator data'
      );
    }
  }

  private assertAuthDataFlags(authData: ParsedAuthenticatorData): void {
    const expectedRpIdHash = sha256(this.config.rpId);
    if (!timingSafeEqual(authData.rpIdHash, expectedRpIdHash)) {
      throw AuthError.passkeyVerificationFailed('RP ID hash mismatch');
    }
    if (!authData.userPresent)
      throw AuthError.passkeyVerificationFailed('user presence flag not set');
    if (this.config.userVerification === 'required' && !authData.userVerified) {
      throw AuthError.passkeyVerificationFailed('user verification required');
    }
  }

  private verifyAttestationStatement(
    fmt: string,
    attStmt: Map<CborValue, CborValue>,
    signedData: Buffer,
    credentialKey: ReturnType<typeof coseToPublicKey>
  ): void {
    if (fmt === 'none') {
      if (attStmt.size !== 0)
        throw AuthError.passkeyVerificationFailed('"none" attestation must be empty');
      return;
    }

    if (fmt === 'packed') {
      const alg = attStmt.get('alg');
      const sig = attStmt.get('sig');
      const x5c = attStmt.get('x5c');
      if (typeof alg !== 'number' || !Buffer.isBuffer(sig)) {
        throw AuthError.passkeyVerificationFailed('packed attestation is malformed');
      }

      if (Array.isArray(x5c) && x5c.length > 0) {
        if (!Buffer.isBuffer(x5c[0]))
          throw AuthError.passkeyVerificationFailed('packed x5c is malformed');
        let leaf: X509Certificate;
        try {
          leaf = new X509Certificate(x5c[0]);
        } catch {
          throw AuthError.passkeyVerificationFailed('packed attestation certificate is invalid');
        }
        if (!verifySignature(alg as CoseAlgorithm, leaf.publicKey, signedData, sig)) {
          throw AuthError.passkeyVerificationFailed('packed attestation signature invalid');
        }
        return;
      }

      // Self attestation: signed with the credential private key itself.
      if (alg !== credentialKey.algorithm) {
        throw AuthError.passkeyVerificationFailed('packed self attestation algorithm mismatch');
      }
      if (!verifySignature(credentialKey.algorithm, credentialKey.keyObject, signedData, sig)) {
        throw AuthError.passkeyVerificationFailed('packed attestation signature invalid');
      }
      return;
    }

    throw AuthError.passkeyVerificationFailed(`unsupported attestation format "${fmt}"`);
  }

  private assertCredentialShape(
    response: PasskeyRegistrationResponse | PasskeyAuthenticationResponse
  ): void {
    if (!response || typeof response !== 'object' || !response.response) {
      throw AuthError.passkeyVerificationFailed('credential response is missing');
    }
    if (response.type !== 'public-key') {
      throw AuthError.passkeyVerificationFailed('credential type must be "public-key"');
    }
  }

  private decode(value: string, field: string): Buffer {
    try {
      return fromBase64Url(value);
    } catch {
      throw AuthError.passkeyVerificationFailed(`${field} is not valid base64url`);
    }
  }

  private describeCredentials(userId: string): PublicKeyCredentialDescriptorJSON[] {
    return this.listCredentials(userId)
      .filter((c) => c.status === 'active')
      .map((c) => ({
        type: 'public-key' as const,
        id: c.id,
        ...(c.transports.length > 0 ? { transports: c.transports } : {}),
      }));
  }

  private getOrCreateUserHandle(userId: string): string {
    let handle = this.userHandles.get(userId);
    if (!handle) {
      // Opaque random handle — WebAuthn user handles must not contain PII.
      handle = toBase64Url(randomBytes(USER_HANDLE_BYTE_LENGTH));
      this.userHandles.set(userId, handle);
    }
    return handle;
  }

  private audit(entry: Omit<PasskeyAuditEntry, 'timestamp'>): void {
    this.auditLog.push({ ...entry, timestamp: new Date().toISOString() });
    if (this.auditLog.length > MAX_AUDIT_ENTRIES) this.auditLog.shift();
  }
}

export const passkeyService = new PasskeyService();
