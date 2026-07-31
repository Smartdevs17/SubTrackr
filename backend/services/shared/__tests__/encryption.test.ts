import {
  encryptField,
  decryptField,
  generateBlindIndexTokens,
  searchBlindIndex,
  maskField,
  maskObject,
  generateKey,
  generateEncryptionKey,
  isPiiField,
  getPiiFields,
  reEncryptField,
} from '../encryption';

describe('Encryption Service', () => {
  const masterKey = generateKey();

  describe('generateKey', () => {
    it('generates a 32-byte key', () => {
      const key = generateKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('generates unique keys each time', () => {
      const key1 = generateKey();
      const key2 = generateKey();
      expect(key1.toString('hex')).not.toBe(key2.toString('hex'));
    });
  });

  describe('generateEncryptionKey', () => {
    it('creates a key with id, version, and expiry', () => {
      const key = generateEncryptionKey(masterKey, 1);
      expect(key.id).toBeTruthy();
      expect(key.version).toBe(1);
      expect(key.key.length).toBe(32);
      expect(key.createdAt).toBeLessThanOrEqual(Date.now());
      expect(key.expiresAt).toBeGreaterThan(Date.now());
    });

    it('generates deterministic keys from the same master key and version', () => {
      const key1 = generateEncryptionKey(masterKey, 1);
      const key2 = generateEncryptionKey(masterKey, 1);
      expect(key1.key.toString('hex')).toBe(key2.key.toString('hex'));
    });

    it('generates different keys for different versions', () => {
      const key1 = generateEncryptionKey(masterKey, 1);
      const key2 = generateEncryptionKey(masterKey, 2);
      expect(key1.key.toString('hex')).not.toBe(key2.key.toString('hex'));
    });
  });

  describe('encryptField / decryptField', () => {
    let key: ReturnType<typeof generateEncryptionKey>;

    beforeEach(() => {
      key = generateEncryptionKey(generateKey(), 1);
    });

    it('encrypts and decrypts a plaintext value', () => {
      const plaintext = 'user@example.com';
      const encrypted = encryptField(plaintext, key);
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.authTag).toBeTruthy();
      expect(encrypted.algorithm).toBe('aes-256-gcm');

      const decrypted = decryptField(encrypted, key);
      expect(decrypted.value).toBe(plaintext);
    });

    it('handles empty strings', () => {
      const encrypted = encryptField('', key);
      expect(encrypted.ciphertext).toBe('');
      const decrypted = decryptField(encrypted, key);
      expect(decrypted.value).toBe('');
    });

    it('produces different ciphertext for the same plaintext (random IV)', () => {
      const encrypted1 = encryptField('test', key);
      const encrypted2 = encryptField('test', key);
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });

    it('throws when decrypting with wrong key', () => {
      const encrypted = encryptField('secret', key);
      const wrongKey = generateEncryptionKey(generateKey(), 99);
      expect(() => decryptField(encrypted, wrongKey)).toThrow();
    });

    it('includes keyId in encrypted field', () => {
      const encrypted = encryptField('data', key);
      expect(encrypted.keyId).toBe(key.id);
    });
  });

  describe('reEncryptField', () => {
    it('re-encrypts with a new key', () => {
      const oldKey = generateEncryptionKey(generateKey(), 1);
      const newKey = generateEncryptionKey(generateKey(), 2);
      const encrypted = encryptField('sensitive data', oldKey);
      const reEncrypted = reEncryptField(encrypted, newKey, oldKey);
      expect(reEncrypted.keyId).toBe(newKey.id);
      const decrypted = decryptField(reEncrypted, newKey);
      expect(decrypted.value).toBe('sensitive data');
    });
  });

  describe('blind indexing', () => {
    const indexKey = generateKey();

    it('generates blind index tokens for a value', () => {
      const idx = generateBlindIndexTokens('email', 'user@example.com', indexKey);
      expect(idx.field).toBe('email');
      expect(idx.tokens.length).toBeGreaterThan(0);
    });

    it('returns empty tokens for empty value', () => {
      const idx = generateBlindIndexTokens('email', '', indexKey);
      expect(idx.tokens).toHaveLength(0);
    });

    it('searchBlindIndex finds matching value', () => {
      const idx = generateBlindIndexTokens('name', 'John Doe', indexKey);
      expect(searchBlindIndex('John Doe', idx, indexKey)).toBe(true);
      expect(searchBlindIndex('john', idx, indexKey)).toBe(true);
      expect(searchBlindIndex('doe', idx, indexKey)).toBe(true);
    });

    it('searchBlindIndex does not match unrelated value', () => {
      const idx = generateBlindIndexTokens('name', 'John Doe', indexKey);
      expect(searchBlindIndex('Jane', idx, indexKey)).toBe(false);
      expect(searchBlindIndex('xyz', idx, indexKey)).toBe(false);
    });

    it('blind index is deterministic for same inputs', () => {
      const idx1 = generateBlindIndexTokens('email', 'user@example.com', indexKey);
      const idx2 = generateBlindIndexTokens('email', 'user@example.com', indexKey);
      expect(idx1.tokens).toEqual(idx2.tokens);
    });

    it('different index keys produce different tokens', () => {
      const key1 = generateKey();
      const key2 = generateKey();
      const idx1 = generateBlindIndexTokens('email', 'test@test.com', key1);
      const idx2 = generateBlindIndexTokens('email', 'test@test.com', key2);
      expect(idx1.tokens).not.toEqual(idx2.tokens);
    });
  });

  describe('isPiiField', () => {
    it('identifies known PII fields', () => {
      expect(isPiiField('email')).toBe(true);
      expect(isPiiField('name')).toBe(true);
      expect(isPiiField('phoneNumber')).toBe(true);
      expect(isPiiField('address')).toBe(true);
    });

    it('returns false for non-PII fields', () => {
      expect(isPiiField('id')).toBe(false);
      expect(isPiiField('price')).toBe(false);
      expect(isPiiField('category')).toBe(false);
    });
  });

  describe('getPiiFields', () => {
    it('returns all known PII fields', () => {
      const fields = getPiiFields();
      expect(fields).toContain('email');
      expect(fields).toContain('name');
      expect(fields).toContain('phoneNumber');
    });
  });

  describe('maskField', () => {
    const originalEnv = process.env['APP_ENV'];

    afterEach(() => {
      process.env['APP_ENV'] = originalEnv;
    });

    it('masks email in non-production', () => {
      process.env['APP_ENV'] = 'development';
      const masked = maskField('john.doe@example.com', 'email');
      expect(masked).not.toBe('john.doe@example.com');
      expect(masked).toContain('@');
    });

    it('does not mask in production', () => {
      process.env['APP_ENV'] = 'production';
      const masked = maskField('john.doe@example.com', 'email');
      expect(masked).toBe('john.doe@example.com');
    });

    it('masks phone number showing last 4 digits', () => {
      process.env['APP_ENV'] = 'development';
      const masked = maskField('555-123-4567', 'phoneNumber');
      expect(masked).toContain('4567');
      expect(masked).not.toContain('123');
    });

    it('masks short strings completely', () => {
      process.env['APP_ENV'] = 'development';
      const masked = maskField('ab', 'name');
      expect(masked).toBe('**');
    });

    it('handles empty string', () => {
      process.env['APP_ENV'] = 'development';
      expect(maskField('', 'name')).toBe('');
    });
  });

  describe('maskObject', () => {
    const originalEnv = process.env['APP_ENV'];

    afterEach(() => {
      process.env['APP_ENV'] = originalEnv;
    });

    it('masks PII fields in an object', () => {
      process.env['APP_ENV'] = 'development';
      const obj = { email: 'test@test.com', name: 'John', price: 10, id: '123' };
      const masked = maskObject(obj);
      expect(masked.email).not.toBe('test@test.com');
      expect(masked.name).not.toBe('John');
      expect(masked.price).toBe(10);
      expect(masked.id).toBe('123');
    });

    it('does not mask in production', () => {
      process.env['APP_ENV'] = 'production';
      const obj = { email: 'test@test.com', name: 'John' };
      const masked = maskObject(obj);
      expect(masked.email).toBe('test@test.com');
      expect(masked.name).toBe('John');
    });
  });
});
