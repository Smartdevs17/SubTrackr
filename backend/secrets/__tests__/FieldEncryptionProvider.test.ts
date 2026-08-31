/**
 * Tests for backend/secrets/FieldEncryptionProvider.ts (Issue #1007)
 */

import { FieldEncryptionProvider } from '../FieldEncryptionProvider';
import { SecretsVault } from '../SecretsVault';
import { isEncryptedField } from '../../services/shared/encryption';

// ─────────────────────────────────────────────────────────────────────────────
// AsyncStorage mock (in-memory)
// ─────────────────────────────────────────────────────────────────────────────

const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => store[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete store[key];
  }),
  multiGet: jest.fn(async (keys: string[]) => keys.map((k) => [k, store[k] ?? null])),
  multiSet: jest.fn(async (pairs: [string, string][]) => {
    pairs.forEach(([k, v]) => {
      store[k] = v;
    });
  }),
  multiRemove: jest.fn(async (keys: string[]) => {
    keys.forEach((k) => delete store[k]);
  }),
}));

beforeEach(() => Object.keys(store).forEach((k) => delete store[k]));

// ─────────────────────────────────────────────────────────────────────────────
// FieldEncryptionProvider tests
// ─────────────────────────────────────────────────────────────────────────────

describe('FieldEncryptionProvider', () => {
  let provider: FieldEncryptionProvider;

  beforeEach(() => {
    provider = new FieldEncryptionProvider(new SecretsVault('development'));
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  it('isInitialized() returns false before initialize()', () => {
    expect(provider.isInitialized()).toBe(false);
  });

  it('isInitialized() returns true after initialize()', async () => {
    await provider.initialize();
    expect(provider.isInitialized()).toBe(true);
  });

  it('throws if encryptField() called before initialize()', () => {
    expect(() => provider.encryptField('test')).toThrow(/Not initialized/);
  });

  it('throws if decryptField() called before initialize()', () => {
    const fakeEnc = {
      ciphertext: 'x',
      iv: 'y',
      authTag: 'z',
      keyId: 'k',
      algorithm: 'aes-256-gcm' as const,
    };
    expect(() => provider.decryptField(fakeEnc)).toThrow(/Not initialized/);
  });

  it('persists key ring to vault on first initialization', async () => {
    await provider.initialize();
    // The vault should now contain the key ring
    const vault = new SecretsVault('development');
    const stored = await vault.get('FIELD_ENCRYPTION_KEY_RING');
    expect(stored).not.toBeNull();
    expect(stored!.length).toBeGreaterThan(0);
  });

  it('reuses existing master key across two provider instances', async () => {
    await provider.initialize();
    const enc = provider.encryptField('consistent');

    // A second provider for the same env should load the same key
    const provider2 = new FieldEncryptionProvider(new SecretsVault('development'));
    await provider2.initialize();
    expect(provider2.decryptField(enc)).toBe('consistent');
  });

  // ── encryptField / decryptField ───────────────────────────────────────────

  it('encrypts and decrypts a single field', async () => {
    await provider.initialize();
    const enc = provider.encryptField('alice@example.com');
    expect(isEncryptedField(enc)).toBe(true);
    expect(provider.decryptField(enc)).toBe('alice@example.com');
  });

  it('encrypts empty string gracefully', async () => {
    await provider.initialize();
    const enc = provider.encryptField('');
    expect(provider.decryptField(enc)).toBe('');
  });

  it('produces unique ciphertext for same input (random IV)', async () => {
    await provider.initialize();
    const a = provider.encryptField('same');
    const b = provider.encryptField('same');
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  // ── encryptObject / decryptObject ─────────────────────────────────────────

  it('encryptObject encrypts PII fields', async () => {
    await provider.initialize();
    const result = provider.encryptObject({ email: 'a@b.com', price: 5.0 });
    expect(isEncryptedField(result.email)).toBe(true);
    expect(result.price).toBe(5.0);
  });

  it('decryptObject round-trips the full object', async () => {
    await provider.initialize();
    const obj = { email: 'alice@example.com', name: 'Alice', planId: 'pro' };
    const enc = provider.encryptObject(obj);
    const dec = provider.decryptObject(enc);
    expect(dec.email).toBe('alice@example.com');
    expect(dec.name).toBe('Alice');
    expect(dec.planId).toBe('pro');
  });

  // ── rotateKey ─────────────────────────────────────────────────────────────

  it('rotateKey returns a new EncryptionKey with incremented version', async () => {
    await provider.initialize();
    const info1 = provider.getActiveKeyInfo();
    const newKey = await provider.rotateKey();
    const info2 = provider.getActiveKeyInfo();
    expect(newKey.version).toBeGreaterThan(info1.version);
    expect(info2.id).toBe(newKey.id);
  });

  it('can decrypt old data after key rotation', async () => {
    await provider.initialize();
    const enc = provider.encryptField('old value');

    await provider.rotateKey();

    // Old data still decryptable
    expect(provider.decryptField(enc)).toBe('old value');
  });

  it('new data after rotation uses the new key', async () => {
    await provider.initialize();
    const info1 = provider.getActiveKeyInfo();

    await provider.rotateKey();

    const enc = provider.encryptField('new value');
    expect(enc.keyId).not.toBe(info1.id);
    expect(provider.decryptField(enc)).toBe('new value');
  });

  // ── reEncryptField ────────────────────────────────────────────────────────

  it('reEncryptField migrates data to the new key', async () => {
    await provider.initialize();
    const enc = provider.encryptField('migrate me');
    const info1 = provider.getActiveKeyInfo();

    await provider.rotateKey();
    const info2 = provider.getActiveKeyInfo();

    const reEnc = provider.reEncryptField(enc);
    expect(reEnc.keyId).toBe(info2.id);
    expect(reEnc.keyId).not.toBe(info1.id);
    expect(provider.decryptField(reEnc)).toBe('migrate me');
  });

  // ── getActiveKeyInfo ──────────────────────────────────────────────────────

  it('getActiveKeyInfo returns key metadata without raw bytes', async () => {
    await provider.initialize();
    const info = provider.getActiveKeyInfo();
    expect(info.id).toBeTruthy();
    expect(typeof info.version).toBe('number');
    expect(info.createdAt).toBeLessThanOrEqual(Date.now());
    expect(info.expiresAt).toBeGreaterThan(Date.now());
    // Must NOT expose the raw key buffer
    expect((info as Record<string, unknown>).key).toBeUndefined();
  });

  // ── isRotationDue ─────────────────────────────────────────────────────────

  it('isRotationDue() returns false for a fresh key', async () => {
    await provider.initialize();
    expect(provider.isRotationDue()).toBe(false);
  });

  // ── pruneOldKeys ──────────────────────────────────────────────────────────

  it('pruneOldKeys removes old keys from ring', async () => {
    await provider.initialize();
    await provider.rotateKey();
    await provider.rotateKey();
    // Should not throw; reduces ring size
    await expect(provider.pruneOldKeys(1)).resolves.toBeUndefined();
  });

  // ── isEncryptedField static helper ────────────────────────────────────────

  it('FieldEncryptionProvider.isEncryptedField identifies encrypted values', async () => {
    await provider.initialize();
    const enc = provider.encryptField('test');
    expect(FieldEncryptionProvider.isEncryptedField(enc)).toBe(true);
    expect(FieldEncryptionProvider.isEncryptedField('plain')).toBe(false);
    expect(FieldEncryptionProvider.isEncryptedField(null)).toBe(false);
  });

  // ── Integration: full encryption-at-rest lifecycle ────────────────────────

  it('full lifecycle: init → encrypt → rotate → re-encrypt → prune → decrypt', async () => {
    await provider.initialize();

    // Encrypt a user record
    const row = { email: 'user@example.com', name: 'Bob', planId: 'enterprise' };
    const encRow = provider.encryptObject(row);
    expect(isEncryptedField(encRow.email)).toBe(true);
    expect(isEncryptedField(encRow.name)).toBe(true);
    expect(encRow.planId).toBe('enterprise');

    // Rotate key
    const oldInfo = provider.getActiveKeyInfo();
    await provider.rotateKey();
    const newInfo = provider.getActiveKeyInfo();
    expect(newInfo.id).not.toBe(oldInfo.id);

    // Old data still decryptable during migration window
    const decOld = provider.decryptObject(encRow);
    expect(decOld.email).toBe('user@example.com');

    // Re-encrypt the row with the new key
    const reEncRow = provider.encryptObject(provider.decryptObject(encRow));
    const emailEnc = reEncRow.email as import('../../services/shared/encryption').EncryptedField;
    expect(emailEnc.keyId).toBe(newInfo.id);

    // Prune and verify new data is still readable
    await provider.pruneOldKeys(1);
    const finalDec = provider.decryptObject(reEncRow);
    expect(finalDec.email).toBe('user@example.com');
    expect(finalDec.name).toBe('Bob');
  });
});
