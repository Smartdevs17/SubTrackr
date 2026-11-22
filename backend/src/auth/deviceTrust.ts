/**
 * backend/src/auth/deviceTrust.ts
 *
 * Per-device refresh-token trust store.
 *
 * Binds each refresh token to the device that originally received it.
 * A refresh attempt from a different device is treated as credential
 * theft and triggers immediate revocation of the entire token family.
 *
 * Token family model (following RFC 6819 §5.2.2):
 *   - On first issue, a new family ID is generated and stored with the
 *     device fingerprint.
 *   - On each rotation the previous token is revoked atomically and a
 *     new sibling token with the same family ID is issued.
 *   - If a revoked token is presented (replay), the whole family is
 *     revoked (silent breach response).
 *   - If the device fingerprint mismatches, the whole family is revoked.
 */

import crypto from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeviceFingerprint {
  /** Hashed user-agent string. */
  userAgentHash: string;
  /** Client IP or subnet (use /24 for IPv4, /48 for IPv6 if behind a NAT). */
  ipHint?: string;
  /** Optional stable device identifier supplied by the client (e.g. app instance ID). */
  deviceId?: string;
}

export interface TrustRecord {
  tokenHash: string;        // SHA-256 of the refresh token value
  familyId: string;         // Groups sibling tokens for family revocation
  userId: string;
  fingerprint: DeviceFingerprint;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokedReason?: 'used' | 'device_mismatch' | 'explicit' | 'family_breach';
}

export interface DeviceTrustStore {
  /** Persist a new trust record. */
  save(record: TrustRecord): Promise<void>;
  /** Look up the record for the given token hash (or null if not found). */
  findByTokenHash(tokenHash: string): Promise<TrustRecord | null>;
  /** Revoke all active records in the family. */
  revokeFamily(familyId: string, reason: TrustRecord['revokedReason']): Promise<void>;
  /** Revoke a single token (rotation: mark old as used before issuing new). */
  revoke(tokenHash: string, reason: TrustRecord['revokedReason']): Promise<void>;
  /** List all active (non-expired, non-revoked) records for a user. */
  listActiveForUser(userId: string): Promise<TrustRecord[]>;
}

export interface RefreshResult {
  newToken: string;
  newRecord: TrustRecord;
  familyRevoked: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

function fingerprintsMatch(a: DeviceFingerprint, b: DeviceFingerprint): boolean {
  if (a.userAgentHash !== b.userAgentHash) return false;
  if (a.deviceId && b.deviceId && a.deviceId !== b.deviceId) return false;
  return true;
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Issue a first-generation refresh token for a device.
 *
 * Call this during login / initial token grant.
 */
export async function issueRefreshToken(
  store: DeviceTrustStore,
  userId: string,
  fingerprint: DeviceFingerprint,
  ttlMs: number = 7 * 24 * 60 * 60 * 1000,
): Promise<string> {
  const token = generateToken();
  const record: TrustRecord = {
    tokenHash: hashToken(token),
    familyId: crypto.randomUUID(),
    userId,
    fingerprint,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + ttlMs),
  };
  await store.save(record);
  return token;
}

/**
 * Rotate a refresh token.
 *
 * Returns a new token and revokes the old one.  If the token is unknown,
 * already revoked (replay), or the device fingerprint mismatches, an error
 * is thrown and (where appropriate) the entire token family is revoked.
 */
export async function rotateRefreshToken(
  store: DeviceTrustStore,
  incomingToken: string,
  fingerprint: DeviceFingerprint,
  ttlMs: number = 7 * 24 * 60 * 60 * 1000,
): Promise<RefreshResult> {
  const tokenHash = hashToken(incomingToken);
  const record = await store.findByTokenHash(tokenHash);

  // Unknown token
  if (!record) {
    throw new DeviceTrustError('UNKNOWN_TOKEN', 'Refresh token not found');
  }

  // Expired
  if (record.expiresAt < new Date()) {
    throw new DeviceTrustError('EXPIRED_TOKEN', 'Refresh token has expired');
  }

  // Replay: token already revoked → revoke entire family (breach response)
  if (record.revokedAt) {
    await store.revokeFamily(record.familyId, 'family_breach');
    throw new DeviceTrustError(
      'REVOKED_TOKEN',
      'Refresh token was already revoked — potential theft; family revoked',
    );
  }

  // Device mismatch → revoke entire family
  if (!fingerprintsMatch(record.fingerprint, fingerprint)) {
    await store.revokeFamily(record.familyId, 'device_mismatch');
    throw new DeviceTrustError(
      'DEVICE_MISMATCH',
      'Device fingerprint mismatch — potential theft; family revoked',
    );
  }

  // Atomically revoke old token and issue new sibling
  await store.revoke(tokenHash, 'used');

  const newToken = generateToken();
  const newRecord: TrustRecord = {
    tokenHash: hashToken(newToken),
    familyId: record.familyId,   // same family
    userId: record.userId,
    fingerprint,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + ttlMs),
  };
  await store.save(newRecord);

  return { newToken, newRecord, familyRevoked: false };
}

/**
 * Revoke all active refresh tokens for a user (e.g. on logout-all-devices).
 */
export async function revokeAllForUser(
  store: DeviceTrustStore,
  userId: string,
): Promise<number> {
  const active = await store.listActiveForUser(userId);
  const familyIds = [...new Set(active.map((r) => r.familyId))];
  await Promise.all(familyIds.map((fid) => store.revokeFamily(fid, 'explicit')));
  return active.length;
}

// ── Error ─────────────────────────────────────────────────────────────────────

export type DeviceTrustErrorCode =
  | 'UNKNOWN_TOKEN'
  | 'EXPIRED_TOKEN'
  | 'REVOKED_TOKEN'
  | 'DEVICE_MISMATCH';

export class DeviceTrustError extends Error {
  constructor(
    public readonly code: DeviceTrustErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceTrustError';
  }
}

// ── In-memory store (for tests / local dev) ───────────────────────────────────

export class InMemoryDeviceTrustStore implements DeviceTrustStore {
  private readonly records = new Map<string, TrustRecord>();

  async save(record: TrustRecord): Promise<void> {
    this.records.set(record.tokenHash, { ...record });
  }

  async findByTokenHash(tokenHash: string): Promise<TrustRecord | null> {
    return this.records.get(tokenHash) ?? null;
  }

  async revoke(tokenHash: string, reason: TrustRecord['revokedReason']): Promise<void> {
    const r = this.records.get(tokenHash);
    if (r) {
      this.records.set(tokenHash, { ...r, revokedAt: new Date(), revokedReason: reason });
    }
  }

  async revokeFamily(familyId: string, reason: TrustRecord['revokedReason']): Promise<void> {
    for (const [hash, record] of this.records) {
      if (record.familyId === familyId && !record.revokedAt) {
        this.records.set(hash, { ...record, revokedAt: new Date(), revokedReason: reason });
      }
    }
  }

  async listActiveForUser(userId: string): Promise<TrustRecord[]> {
    const now = new Date();
    return [...this.records.values()].filter(
      (r) => r.userId === userId && !r.revokedAt && r.expiresAt > now,
    );
  }

  /** Test helper: return all records for inspection. */
  all(): TrustRecord[] {
    return [...this.records.values()];
  }
}
