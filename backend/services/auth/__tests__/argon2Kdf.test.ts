import {
  hashPassword,
  verifyPassword,
  deriveSymmetricKey,
  ARGON2_INTERACTIVE,
} from '../domain/argon2Kdf';

// Use minimal params in tests so they run fast (< 100 ms per case).
const FAST_PARAMS = { memoryCost: 16384, timeCost: 1, parallelism: 1, keyLen: 32 };

describe('hashPassword', () => {
  it('produces a well-formed encoded string', () => {
    const { encoded } = hashPassword('hunter2', FAST_PARAMS);
    expect(encoded).toMatch(/^\$argon2id\$v=2\$m=16384,t=1,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  });

  it('two hashes of the same password differ (different salts)', () => {
    const a = hashPassword('hunter2', FAST_PARAMS);
    const b = hashPassword('hunter2', FAST_PARAMS);
    expect(a.encoded).not.toBe(b.encoded);
  });

  it('encodes ARGON2_INTERACTIVE parameters into the hash', () => {
    const params = { ...ARGON2_INTERACTIVE, memoryCost: 65536, timeCost: 3, parallelism: 4 };
    const { encoded } = hashPassword('secret', params);
    expect(encoded).toContain('m=65536,t=3,p=4');
  });
});

describe('verifyPassword', () => {
  it('verifies the correct password', () => {
    const { encoded } = hashPassword('correct-horse-battery-staple', FAST_PARAMS);
    expect(verifyPassword('correct-horse-battery-staple', encoded)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const { encoded } = hashPassword('correct-horse-battery-staple', FAST_PARAMS);
    expect(verifyPassword('wrong-password', encoded)).toBe(false);
  });

  it('rejects a truncated encoded string', () => {
    expect(verifyPassword('anything', '$argon2id$v=2$m=16384,t=1,p=1')).toBe(false);
  });

  it('rejects an empty encoded string', () => {
    expect(verifyPassword('anything', '')).toBe(false);
  });

  it('rejects a bcrypt-format string gracefully', () => {
    const bcryptLike = '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW';
    expect(verifyPassword('password', bcryptLike)).toBe(false);
  });

  it('round-trips with unicode password', () => {
    const pw = '🔑 Ünïcödé pässwörd! 🎉';
    const { encoded } = hashPassword(pw, FAST_PARAMS);
    expect(verifyPassword(pw, encoded)).toBe(true);
  });
});

describe('deriveSymmetricKey', () => {
  it('produces a Buffer of the requested length', () => {
    const salt = Buffer.from('0'.repeat(32), 'hex').subarray(0, 16);
    const key = deriveSymmetricKey('passphrase', salt, FAST_PARAMS);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.byteLength).toBe(FAST_PARAMS.keyLen);
  });

  it('is deterministic for the same inputs', () => {
    const salt = Buffer.alloc(16, 0xab);
    const k1 = deriveSymmetricKey('secret', salt, FAST_PARAMS);
    const k2 = deriveSymmetricKey('secret', salt, FAST_PARAMS);
    expect(k1.toString('hex')).toBe(k2.toString('hex'));
  });

  it('differs for different salts', () => {
    const k1 = deriveSymmetricKey('secret', Buffer.alloc(16, 0x01), FAST_PARAMS);
    const k2 = deriveSymmetricKey('secret', Buffer.alloc(16, 0x02), FAST_PARAMS);
    expect(k1.toString('hex')).not.toBe(k2.toString('hex'));
  });

  it('differs for different secrets', () => {
    const salt = Buffer.alloc(16, 0x77);
    const k1 = deriveSymmetricKey('secret-a', salt, FAST_PARAMS);
    const k2 = deriveSymmetricKey('secret-b', salt, FAST_PARAMS);
    expect(k1.toString('hex')).not.toBe(k2.toString('hex'));
  });
});
