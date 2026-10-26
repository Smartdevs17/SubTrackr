/**
 * Tests for Issue #1007 – Encryption at Rest for Sensitive Data Fields
 *
 * Covers:
 *   - New helpers added to backend/services/shared/encryption.ts:
 *       isKeyExpired, validateEncryptionKey, encryptObject, decryptObject,
 *       isEncryptedField, EncryptionService
 *   - backend/secrets/FieldEncryptionProvider.ts
 */

import {
  generateKey,
  generateEncryptionKey,
  encryptField,
  decryptField,
  isKeyExpired,
  validateEncryptionKey,
  encryptObject,
  decryptObject,
  isEncryptedField,
  EncryptionService,
} from '../encryption';

import type { EncryptedField, EncryptionKey } from '../encryption';

// ─────────────────────────────────────────────────────────────────────────────
// isKeyExpired()
// ─────────────────────────────────────────────────────────────────────────────

describe('isKeyExpired()', () => {
  it('returns false for a freshly-generated key', () => {
    const mk = generateKey();
    const key = generateEncryptionKey(mk, 1);
    expect(isKeyExpired(key)).toBe(false);
  });

  it('returns true for a key with expiresAt in the past', () => {
    const mk = generateKey();
    const key = generateEncryptionKey(mk, 1);
    const expired: EncryptionKey = { ...key, expiresAt: Date.now() - 1 };
    expect(isKeyExpired(expired)).toBe(true);
  });

  it('returns false for a key expiring far in the future', () => {
    const mk = generateKey();
    const key = generateEncryptionKey(mk, 1);
    const future: EncryptionKey = { ...key, expiresAt: Date.now() + 1_000_000 };
    expect(isKeyExpired(future)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateEncryptionKey()
// ─────────────────────────────────────────────────────────────────────────────

describe('validateEncryptionKey()', () => {
  it('does not throw for a valid 32-byte key', () => {
    expect(() => validateEncryptionKey(generateKey())).not.toThrow();
  });

  it('throws for a buffer shorter than 32 bytes', () => {
    expect(() => validateEncryptionKey(Buffer.alloc(16))).toThrow(/length/);
  });

  it('throws for a buffer longer than 32 bytes', () => {
    expect(() => validateEncryptionKey(Buffer.alloc(48))).toThrow(/length/);
  });

  it('throws for an all-zero buffer', () => {
    expect(() => validateEncryptionKey(Buffer.alloc(32, 0))).toThrow(/all-zero/);
  });

  it('throws for a non-Buffer argument', () => {
    expect(() => validateEncryptionKey('not-a-buffer' as unknown as Buffer)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isEncryptedField()
// ─────────────────────────────────────────────────────────────────────────────

describe('isEncryptedField()', () => {
  const mk = generateKey();
  const key = generateEncryptionKey(mk, 1);

  it('returns true for an EncryptedField', () => {
    const enc = encryptField('test', key);
    expect(isEncryptedField(enc)).toBe(true);
  });

  it('returns false for a plain string', () => {
    expect(isEncryptedField('hello')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isEncryptedField(null)).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isEncryptedField(42)).toBe(false);
  });

  it('returns false for an object missing algorithm', () => {
    expect(isEncryptedField({ ciphertext: 'a', iv: 'b', authTag: 'c', keyId: 'd' })).toBe(false);
  });

  it('returns false for an object with wrong algorithm', () => {
    expect(
      isEncryptedField({ ciphertext: 'a', iv: 'b', authTag: 'c', keyId: 'd', algorithm: 'aes-128-cbc' })
    ).toBe(false);
  });

  it('returns true for an empty-string EncryptedField (empty plaintext)', () => {
    const enc = encryptField('', key);
    expect(isEncryptedField(enc)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// encryptObject()
// ─────────────────────────────────────────────────────────────────────────────

describe('encryptObject()', () => {
  const mk = generateKey();
  const key = generateEncryptionKey(mk, 1);

  it('encrypts string PII fields', () => {
    const obj = { email: 'alice@example.com', price: 9.99 };
    const result = encryptObject(obj, key);
    expect(isEncryptedField(result.email)).toBe(true);
  });

  it('passes through non-PII string fields unchanged', () => {
    const obj = { planId: 'pro', price: 9.99 };
    const result = encryptObject(obj, key);
    expect(result.planId).toBe('pro');
    expect(result.price).toBe(9.99);
  });

  it('does not encrypt numeric fields', () => {
    const obj = { email: 'a@b.com', amount: 100 };
    const result = encryptObject(obj, key);
    expect(result.amount).toBe(100);
  });

  it('encrypts nested PII fields', () => {
    const obj = { user: { email: 'a@b.com', id: '123' } };
    const result = encryptObject(obj, key);
    const user = result.user as Record<string, unknown>;
    expect(isEncryptedField(user.email)).toBe(true);
    expect(user.id).toBe('123');
  });

  it('does not re-encrypt already-encrypted fields', () => {
    const obj = { email: 'a@b.com' };
    const once = encryptObject(obj, key);
    const twice = encryptObject(once, key);
    // The ciphertext shape should be preserved, not double-encrypted
    expect(isEncryptedField(twice.email)).toBe(true);
    const original = once.email as EncryptedField;
    const second = twice.email as EncryptedField;
    expect(original.keyId).toBe(second.keyId);
  });

  it('passes through arrays unchanged', () => {
    const obj = { tags: ['a', 'b'], email: 'a@b.com' };
    const result = encryptObject(obj, key);
    expect(Array.isArray(result.tags)).toBe(true);
    expect(result.tags).toEqual(['a', 'b']);
  });

  it('encrypts multiple PII fields in the same object', () => {
    const obj = { email: 'a@b.com', name: 'Alice', phoneNumber: '555-1234' };
    const result = encryptObject(obj, key);
    expect(isEncryptedField(result.email)).toBe(true);
    expect(isEncryptedField(result.name)).toBe(true);
    expect(isEncryptedField(result.phoneNumber)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// decryptObject()
// ─────────────────────────────────────────────────────────────────────────────

describe('decryptObject()', () => {
  const mk = generateKey();
  const key = generateEncryptionKey(mk, 1);
  const getKey = (id: string) => (id === key.id ? key : null);

  it('decrypts PII fields back to plaintext', () => {
    const obj = { email: 'alice@example.com', price: 9.99 };
    const encrypted = encryptObject(obj, key);
    const decrypted = decryptObject(encrypted, getKey);
    expect(decrypted.email).toBe('alice@example.com');
  });

  it('passes non-encrypted fields through unchanged', () => {
    const obj = { email: 'alice@example.com', price: 9.99, planId: 'pro' };
    const encrypted = encryptObject(obj, key);
    const decrypted = decryptObject(encrypted, getKey);
    expect(decrypted.price).toBe(9.99);
    expect(decrypted.planId).toBe('pro');
  });

  it('decrypts nested encrypted objects', () => {
    const obj = { user: { email: 'a@b.com', id: '123' } };
    const encrypted = encryptObject(obj, key);
    const decrypted = decryptObject(encrypted, getKey);
    const user = decrypted.user as Record<string, unknown>;
    expect(user.email).toBe('a@b.com');
    expect(user.id).toBe('123');
  });

  it('preserves encrypted field when key is not found', () => {
    const obj = { email: 'a@b.com' };
    const encrypted = encryptObject(obj, key);
    const decrypted = decryptObject(encrypted, () => null); // no key resolver
    expect(isEncryptedField(decrypted.email)).toBe(true);
  });

  it('round-trips all PII fields correctly', () => {
    const original = {
      email: 'user@example.com',
      name: 'Alice',
      phoneNumber: '555-9999',
      price: 99.0,
    };
    const encrypted = encryptObject(original, key);
    const decrypted = decryptObject(encrypted, getKey);
    expect(decrypted.email).toBe(original.email);
    expect(decrypted.name).toBe(original.name);
    expect(decrypted.phoneNumber).toBe(original.phoneNumber);
    expect(decrypted.price).toBe(original.price);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EncryptionService
// ─────────────────────────────────────────────────────────────────────────────

describe('EncryptionService', () => {
  let service: EncryptionService;
  let masterKey: Buffer;

  beforeEach(() => {
    masterKey = generateKey();
    service = new EncryptionService(masterKey);
  });

  // ── Constructor ────────────────────────────────────────────────────────────

  it('throws if master key is invalid (too short)', () => {
    expect(() => new EncryptionService(Buffer.alloc(16))).toThrow();
  });

  it('throws if master key is all-zero', () => {
    expect(() => new EncryptionService(Buffer.alloc(32, 0))).toThrow();
  });

  // ── encrypt / decrypt ──────────────────────────────────────────────────────

  it('encrypts and decrypts a string', () => {
    const enc = service.encrypt('user@example.com');
    expect(service.decrypt(enc)).toBe('user@example.com');
  });

  it('handles empty strings', () => {
    const enc = service.encrypt('');
    expect(service.decrypt(enc)).toBe('');
  });

  it('produces different ciphertext each call (random IV)', () => {
    const a = service.encrypt('same');
    const b = service.encrypt('same');
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('throws decrypting with unknown keyId', () => {
    const enc = service.encrypt('secret');
    const enc2: EncryptedField = { ...enc, keyId: 'unknown-id' };
    expect(() => service.decrypt(enc2)).toThrow(/Unknown keyId/);
  });

  // ── encryptObject / decryptObject ──────────────────────────────────────────

  it('encrypts PII fields via encryptObject', () => {
    const result = service.encryptObject({ email: 'a@b.com', price: 5.0 });
    expect(isEncryptedField(result.email)).toBe(true);
    expect(result.price).toBe(5.0);
  });

  it('decryptObject round-trips an object', () => {
    const obj = { email: 'a@b.com', name: 'Bob', planId: 'basic' };
    const enc = service.encryptObject(obj);
    const dec = service.decryptObject(enc);
    expect(dec.email).toBe('a@b.com');
    expect(dec.name).toBe('Bob');
    expect(dec.planId).toBe('basic');
  });

  // ── reEncrypt ──────────────────────────────────────────────────────────────

  it('reEncrypt re-encrypts with the active key', () => {
    const enc = service.encrypt('secret value');
    const reEnc = service.reEncrypt(enc);
    // Still decryptable
    expect(service.decrypt(reEnc)).toBe('secret value');
  });

  it('reEncrypt throws for unknown keyId', () => {
    const enc = service.encrypt('secret');
    const fakeEnc: EncryptedField = { ...enc, keyId: 'bad-id' };
    expect(() => service.reEncrypt(fakeEnc)).toThrow(/Unknown keyId/);
  });

  // ── Blind index ────────────────────────────────────────────────────────────

  it('generates and searches a blind index', () => {
    const idx = service.generateBlindIndex('email', 'user@example.com');
    expect(service.searchBlindIndex('user@example.com', idx)).toBe(true);
    expect(service.searchBlindIndex('other@example.com', idx)).toBe(false);
  });

  // ── rotateKey ──────────────────────────────────────────────────────────────

  it('rotates the active key and returns a new EncryptionKey', () => {
    const oldKey = service.getActiveKey();
    const newKey = service.rotateKey(generateKey());
    expect(newKey.version).toBeGreaterThan(oldKey.version);
    expect(service.getActiveKey().id).toBe(newKey.id);
  });

  it('can still decrypt data encrypted with the old key after rotation', () => {
    const enc = service.encrypt('old data');
    service.rotateKey(generateKey());
    // The old key is still in the ring
    expect(service.decrypt(enc)).toBe('old data');
  });

  it('rotateKey throws for invalid master key', () => {
    expect(() => service.rotateKey(Buffer.alloc(32, 0))).toThrow();
  });

  // ── pruneOldKeys ───────────────────────────────────────────────────────────

  it('pruneOldKeys removes keys beyond keepCount', () => {
    const mk1 = generateKey();
    const mk2 = generateKey();
    const mk3 = generateKey();
    service.rotateKey(mk1);
    service.rotateKey(mk2);
    service.rotateKey(mk3);
    expect(service.getAllKeys().length).toBe(4);
    service.pruneOldKeys(2);
    expect(service.getAllKeys().length).toBe(2);
  });

  it('pruneOldKeys keeps the active key', () => {
    service.rotateKey(generateKey());
    service.pruneOldKeys(1);
    expect(service.getKeyById(service.getActiveKey().id)).not.toBeNull();
  });

  // ── getters ────────────────────────────────────────────────────────────────

  it('getActiveKey returns a key', () => {
    const key = service.getActiveKey();
    expect(key).not.toBeNull();
    expect(key.key.length).toBe(32);
  });

  it('getAllKeys returns all keys in the ring', () => {
    expect(service.getAllKeys()).toHaveLength(1);
    service.rotateKey(generateKey());
    expect(service.getAllKeys()).toHaveLength(2);
  });

  it('getKeyById returns null for unknown id', () => {
    expect(service.getKeyById('nonexistent')).toBeNull();
  });

  it('getKeyById resolves an existing key', () => {
    const key = service.getActiveKey();
    expect(service.getKeyById(key.id)).not.toBeNull();
  });

  it('isActiveKeyExpired returns false for fresh key', () => {
    expect(service.isActiveKeyExpired()).toBe(false);
  });

  // ── Integration: full encrypt → rotate → re-encrypt lifecycle ──────────────

  it('full key rotation lifecycle', () => {
    // Encrypt with original key
    const enc1 = service.encrypt('sensitive@data.com');

    // Rotate to new key
    const newMk = generateKey();
    const newKey = service.rotateKey(newMk);

    // Decrypt old data (uses old key from ring)
    expect(service.decrypt(enc1)).toBe('sensitive@data.com');

    // Re-encrypt with new key
    const enc2 = service.reEncrypt(enc1);
    expect(enc2.keyId).toBe(newKey.id);
    expect(service.decrypt(enc2)).toBe('sensitive@data.com');

    // Prune old keys; old enc no longer deryptable
    service.pruneOldKeys(1);
    expect(() => service.decrypt(enc1)).toThrow();

    // New enc still decryptable
    expect(service.decrypt(enc2)).toBe('sensitive@data.com');
  });
});
