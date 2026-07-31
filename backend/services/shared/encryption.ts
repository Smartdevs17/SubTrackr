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
