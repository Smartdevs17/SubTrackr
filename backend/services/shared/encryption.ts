import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

export type Environment = 'development' | 'staging' | 'production';

export interface EncryptionKey {
  id: string;
  version: number;
  key: Buffer;
  createdAt: number;
  expiresAt: number;
}

export interface EncryptedField {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: string;
  algorithm: 'aes-256-gcm';
}

export interface BlindIndex {
  field: string;
  indexKeyId: string;
  tokens: string[];
}

export interface DecryptedField {
  value: string;
  keyId: string;
  keyVersion: number;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const BLIND_INDEX_PREFIX_LENGTH = 16;
const HMAC_ALGORITHM = 'sha256';
const MASKING_CHAR = '*';
const MAX_MASKED_LENGTH = 20;

const PII_FIELDS: ReadonlySet<string> = new Set([
  'email',
  'name',
  'phoneNumber',
  'address',
  'businessName',
  'recipientEmail',
  'subscriberId',
]);

function deriveKey(masterKey: Buffer, context: string, version: number): Buffer {
  const hmac = createHmac(HMAC_ALGORITHM, masterKey);
  hmac.update(context);
  hmac.update(String(version));
  return hmac.digest();
}

export function generateKey(): Buffer {
  return randomBytes(KEY_LENGTH);
}

export function generateEncryptionKey(masterKey: Buffer, version: number): EncryptionKey {
  const id = randomBytes(16).toString('hex');
  const createdAt = Date.now();
  const expiresAt = createdAt + 90 * 24 * 60 * 60 * 1000;
  const key = deriveKey(masterKey, 'pii-encryption', version);
  return { id, version, key, createdAt, expiresAt };
}

function getEnv(): Environment {
  return (process.env['APP_ENV'] as Environment | undefined) ?? 'development';
}

function isNonProduction(): boolean {
  const env = getEnv();
  return env === 'development' || env === 'staging';
}

export function isPiiField(fieldName: string): boolean {
  return PII_FIELDS.has(fieldName);
}

export function getPiiFields(): readonly string[] {
  return Array.from(PII_FIELDS);
}

export function encryptField(plaintext: string, key: EncryptionKey): EncryptedField {
  if (!plaintext) return { ciphertext: '', iv: '', authTag: '', keyId: key.id, algorithm: ALGORITHM };

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key.key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyId: key.id,
    algorithm: ALGORITHM,
  };
}

export function decryptField(encrypted: EncryptedField, key: EncryptionKey): DecryptedField {
  if (!encrypted.ciphertext) {
    return { value: '', keyId: encrypted.keyId, keyVersion: key.version };
  }

  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key.key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return {
    value: decrypted.toString('utf8'),
    keyId: encrypted.keyId,
    keyVersion: key.version,
  };
}

export function generateBlindIndexToken(field: string, value: string, indexKey: Buffer): string {
  const hmac = createHmac(HMAC_ALGORITHM, indexKey);
  hmac.update(field);
  hmac.update(':');
  hmac.update(value.toLowerCase().trim());
  return hmac.digest('hex').substring(0, BLIND_INDEX_PREFIX_LENGTH * 2);
}

export function generateBlindIndexTokens(
  field: string,
  value: string,
  indexKey: Buffer
): BlindIndex {
  const tokens: string[] = [];

  if (!value) return { field, indexKeyId: '', tokens: [] };

  const normalized = value.toLowerCase().trim();
  tokens.push(generateBlindIndexToken(field, normalized, indexKey));

  const words = normalized.split(/\s+/);
  for (const word of words) {
    if (word.length >= 3) {
      tokens.push(generateBlindIndexToken(field, word, indexKey));
    }
  }

  const trigrams = buildTrigrams(normalized);
  for (const trigram of trigrams) {
    tokens.push(generateBlindIndexToken(field, trigram, indexKey));
  }

  return { field, indexKeyId: '', tokens: Array.from(new Set(tokens)) };
}

function buildTrigrams(input: string): string[] {
  const trigrams: string[] = [];
  for (let i = 0; i <= input.length - 3; i++) {
    trigrams.push(input.substring(i, i + 3));
  }
  return trigrams;
}

export function searchBlindIndex(
  query: string,
  blindIndex: BlindIndex,
  indexKey: Buffer
): boolean {
  if (!query?.trim()) return true;
  const queryToken = generateBlindIndexToken(blindIndex.field, query, indexKey);
  return blindIndex.tokens.some((token) => {
    if (token.length !== queryToken.length) return false;
    const a = Buffer.from(token, 'hex');
    const b = Buffer.from(queryToken, 'hex');
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

export function maskField(value: string, fieldName: string): string {
  if (!value) return '';

  if (!isNonProduction()) return value;

  if (fieldName === 'email') {
    const atIndex = value.indexOf('@');
    if (atIndex <= 1) return MASKING_CHAR.repeat(10) + '@masked.example.com';
    const visibleStart = Math.max(1, Math.floor(atIndex / 3));
    return (
      value.substring(0, visibleStart) +
      MASKING_CHAR.repeat(Math.min(atIndex - visibleStart, 5)) +
      '@' +
      value.substring(atIndex + 1, atIndex + 2) +
      MASKING_CHAR.repeat(Math.min(value.length - atIndex - 2, 8))
    );
  }

  if (fieldName === 'phoneNumber') {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length < 4) return MASKING_CHAR.repeat(cleaned.length);
    return MASKING_CHAR.repeat(cleaned.length - 4) + cleaned.slice(-4);
  }

  if (value.length <= 3) return MASKING_CHAR.repeat(value.length);
  const visibleChars = Math.min(2, Math.floor(value.length / 4));
  return (
    value.substring(0, visibleChars) +
    MASKING_CHAR.repeat(Math.min(value.length - visibleChars, MAX_MASKED_LENGTH))
  );
}

export function maskObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && isPiiField(key)) {
      result[key] = maskField(value, key);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = maskObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function reEncryptField(
  encrypted: EncryptedField,
  newKey: EncryptionKey,
  decryptKey: EncryptionKey
): EncryptedField {
  const decrypted = decryptField(encrypted, decryptKey);
  return encryptField(decrypted.value, newKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// Key validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns `true` when the encryption key has passed its `expiresAt` timestamp.
 */
export function isKeyExpired(key: EncryptionKey): boolean {
  return Date.now() >= key.expiresAt;
}

/**
 * Validates a key Buffer: must be exactly 32 bytes and non-zero.
 * Throws if invalid so callers fail loudly.
 */
export function validateEncryptionKey(keyBuf: Buffer): void {
  if (!Buffer.isBuffer(keyBuf) || keyBuf.length !== KEY_LENGTH) {
    throw new Error(
      `Invalid encryption key length: expected ${KEY_LENGTH} bytes, got ${keyBuf?.length ?? 0}`
    );
  }
  // A buffer of all zeroes is a degenerate key – reject it
  if (keyBuf.every((b) => b === 0)) {
    throw new Error('Encryption key must not be all-zero bytes');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Object-level encryption helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypts all PII fields found in a plain object, replacing string values with
 * their `EncryptedField` representation.  Non-PII fields are passed through
 * unmodified.  Nested objects are processed recursively (max depth 10).
 *
 * @param obj    - The source object to encrypt.
 * @param key    - Active `EncryptionKey` to use.
 * @param depth  - Internal recursion depth guard (do not pass externally).
 * @returns A new object with PII string values replaced by `EncryptedField`.
 *
 * @example
 * const encrypted = encryptObject({ email: 'a@b.com', price: 9.99 }, key);
 * // → { email: { ciphertext: '…', iv: '…', authTag: '…', keyId: '…', algorithm: 'aes-256-gcm' }, price: 9.99 }
 */
export function encryptObject(
  obj: Record<string, unknown>,
  key: EncryptionKey,
  depth = 0
): Record<string, unknown> {
  if (depth > 10) return obj;
  const result: Record<string, unknown> = {};
  for (const [fieldName, value] of Object.entries(obj)) {
    if (typeof value === 'string' && isPiiField(fieldName)) {
      result[fieldName] = encryptField(value, key);
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value as Record<string, unknown>).ciphertext // don't re-encrypt already-encrypted fields
    ) {
      result[fieldName] = encryptObject(value as Record<string, unknown>, key, depth + 1);
    } else {
      result[fieldName] = value;
    }
  }
  return result;
}

/**
 * Decrypts all `EncryptedField`-shaped values in an object back to plain
 * strings, using the supplied key lookup function to resolve the correct key
 * per field (supports multi-key scenarios during key rotation).
 *
 * Non-encrypted fields are passed through unmodified.  Nested objects are
 * processed recursively.
 *
 * @param obj       - The source object with encrypted field values.
 * @param getKey    - Function that resolves an `EncryptionKey` by id.
 * @param depth     - Internal recursion depth guard.
 *
 * @example
 * const plain = decryptObject(encrypted, (id) => keyManager.getKeyById(id));
 */
export function decryptObject(
  obj: Record<string, unknown>,
  getKey: (keyId: string) => EncryptionKey | null,
  depth = 0
): Record<string, unknown> {
  if (depth > 10) return obj;
  const result: Record<string, unknown> = {};
  for (const [fieldName, value] of Object.entries(obj)) {
    if (isEncryptedField(value)) {
      const key = getKey((value as EncryptedField).keyId);
      if (!key) {
        // Key not available – preserve ciphertext rather than silently dropping data
        result[fieldName] = value;
      } else {
        try {
          result[fieldName] = decryptField(value as EncryptedField, key).value;
        } catch {
          // Decryption failure – preserve encrypted form and add error sentinel
          result[fieldName] = value;
        }
      }
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[fieldName] = decryptObject(value as Record<string, unknown>, getKey, depth + 1);
    } else {
      result[fieldName] = value;
    }
  }
  return result;
}

/**
 * Type guard: returns `true` if `value` looks like an `EncryptedField`.
 */
export function isEncryptedField(value: unknown): value is EncryptedField {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ciphertext === 'string' &&
    typeof v.iv === 'string' &&
    typeof v.authTag === 'string' &&
    typeof v.keyId === 'string' &&
    v.algorithm === ALGORITHM
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EncryptionService – high-level stateful service for encryption at rest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stateful encryption service that manages a live key ring and provides
 * high-level encrypt/decrypt operations for sensitive data fields stored at
 * rest in the database.
 *
 * ### Key ring
 * The service keeps a map of all encryption keys (current + historical) so it
 * can decrypt data encrypted with any previous key while only writing with the
 * currently active key.
 *
 * ### Usage
 * ```ts
 * const service = new EncryptionService(masterKey);
 * const enc = service.encrypt('user@example.com');
 * const plain = service.decrypt(enc);
 *
 * // Encrypt a full object (only PII fields)
 * const encObj = service.encryptObject({ email: 'a@b.com', price: 9.99 });
 *
 * // Rotate key, then re-encrypt old data
 * service.rotateKey();
 * const reEnc = service.reEncrypt(enc);  // decrypts with old key, re-encrypts with new
 * ```
 */
export class EncryptionService {
  private keys: Map<string, EncryptionKey>;
  private activeKeyId: string;

  /**
   * Initialize a new key ring from a master key.
   */
  constructor(masterKey: Buffer, initialVersion = 1) {
    validateEncryptionKey(masterKey);
    const initial = generateEncryptionKey(masterKey, initialVersion);
    this.keys = new Map([[initial.id, initial]]);
    this.activeKeyId = initial.id;
  }

  /**
   * Reconstitute a key ring from serialized JSON state.
   */
  static fromJSON(jsonStr: string): EncryptionService {
    const data = JSON.parse(jsonStr);
    const service = Object.create(EncryptionService.prototype) as EncryptionService;
    service.keys = new Map();
    for (const k of data.keys) {
      service.keys.set(k.id, {
        id: k.id,
        version: k.version,
        key: Buffer.from(k.key, 'base64'),
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
      });
    }
    service.activeKeyId = data.activeKeyId;
    if (!service.keys.has(service.activeKeyId)) {
      throw new Error(`Active key ${service.activeKeyId} not found in key ring`);
    }
    return service;
  }

  /**
   * Serialize the key ring to a JSON string for storage.
   */
  toJSON(): string {
    return JSON.stringify({
      activeKeyId: this.activeKeyId,
      keys: Array.from(this.keys.values()).map(k => ({
        ...k,
        key: k.key.toString('base64')
      }))
    });
  }

  // ── Core field operations ─────────────────────────────────────────────────

  /** Encrypt a single plaintext string using the active key. */
  encrypt(plaintext: string): EncryptedField {
    return encryptField(plaintext, this.getActiveKey());
  }

  /** Decrypt a single `EncryptedField`, resolving its key from the key ring. */
  decrypt(encrypted: EncryptedField): string {
    const key = this.keys.get(encrypted.keyId);
    if (!key) throw new Error(`Unknown keyId: ${encrypted.keyId}`);
    return decryptField(encrypted, key).value;
  }

  /** Re-encrypt a field from any historical key to the currently active key. */
  reEncrypt(encrypted: EncryptedField): EncryptedField {
    const decryptKey = this.keys.get(encrypted.keyId);
    if (!decryptKey) throw new Error(`Unknown keyId for re-encryption: ${encrypted.keyId}`);
    return reEncryptField(encrypted, this.getActiveKey(), decryptKey);
  }

  // ── Object-level operations ───────────────────────────────────────────────

  /**
   * Encrypt all PII fields in an object using the active key.
   * Non-PII fields pass through unchanged.
   */
  encryptObject(obj: Record<string, unknown>): Record<string, unknown> {
    return encryptObject(obj, this.getActiveKey());
  }

  /**
   * Decrypt all encrypted fields in an object, resolving keys from the ring.
   */
  decryptObject(obj: Record<string, unknown>): Record<string, unknown> {
    return decryptObject(obj, (id) => this.keys.get(id) ?? null);
  }

  // ── Blind index operations ────────────────────────────────────────────────

  /**
   * Generate a blind index for a value so it can be searched without decrypting.
   * Uses a deterministic HMAC of the active key as the index key.
   */
  generateBlindIndex(field: string, value: string): BlindIndex {
    const indexKey = this.deriveIndexKey();
    return generateBlindIndexTokens(field, value, indexKey);
  }

  /** Search a blind index for a query value. */
  searchBlindIndex(query: string, blindIndex: BlindIndex): boolean {
    const indexKey = this.deriveIndexKey();
    return searchBlindIndex(query, blindIndex, indexKey);
  }

  // ── Key rotation ──────────────────────────────────────────────────────────

  /**
   * Rotate the active key by generating a new `EncryptionKey` with an
   * incremented version number.  The old key is retained in the ring for
   * decryption of existing data until `pruneOldKeys()` is called.
   *
   * @returns The new `EncryptionKey`.
   */
  rotateKey(masterKey: Buffer): EncryptionKey {
    validateEncryptionKey(masterKey);
    const nextVersion = Math.max(...Array.from(this.keys.values()).map((k) => k.version)) + 1;
    const newKey = generateEncryptionKey(masterKey, nextVersion);
    this.keys.set(newKey.id, newKey);
    this.activeKeyId = newKey.id;
    return newKey;
  }

  /**
   * Remove all keys older than `keepCount` most-recent versions from the ring.
   * Call this only **after** all data has been re-encrypted with the new key.
   */
  pruneOldKeys(keepCount = 2): void {
    const sorted = Array.from(this.keys.values()).sort((a, b) => b.version - a.version);
    const toRemove = sorted.slice(keepCount);
    for (const k of toRemove) this.keys.delete(k.id);
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  /** Return the currently active `EncryptionKey`. */
  getActiveKey(): EncryptionKey {
    const key = this.keys.get(this.activeKeyId);
    if (!key) throw new Error('No active encryption key');
    return key;
  }

  /** Return all keys currently in the ring. */
  getAllKeys(): EncryptionKey[] {
    return Array.from(this.keys.values());
  }

  /** Return the key with the given id, or `null` if not in the ring. */
  getKeyById(id: string): EncryptionKey | null {
    return this.keys.get(id) ?? null;
  }

  /** Return `true` if the active key is past its expiry date. */
  isActiveKeyExpired(): boolean {
    return isKeyExpired(this.getActiveKey());
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private deriveIndexKey(): Buffer {
    const activeKey = this.getActiveKey();
    const hmac = createHmac(HMAC_ALGORITHM, activeKey.key);
    hmac.update('blind-index-v1');
    return hmac.digest();
  }
}
