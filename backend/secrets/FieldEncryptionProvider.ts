/**
 * Issue #1007 – FieldEncryptionProvider (backend/secrets/)
 *
 * Bridges the `SecretsVault` (which manages master key material) with the
 * `EncryptionService` (which performs field-level AES-256-GCM encryption at
 * rest).
 *
 * ### Architecture
 *
 * ```
 * ┌─────────────────────────────────┐
 * │  Database row / API payload     │
 * │  { email: 'a@b.com', … }        │
 * └────────────┬────────────────────┘
 *              │ encrypt / decrypt
 * ┌────────────▼────────────────────┐
 * │  FieldEncryptionProvider        │  ← this file
 * │  • bootstraps from SecretsVault │
 * │  • delegates to EncryptionService│
 * └────────────┬────────────────────┘
 *              │ reads master key material
 * ┌────────────▼────────────────────┐
 * │  SecretsVault (AsyncStorage)    │
 * └─────────────────────────────────┘
 * ```
 *
 * ### Usage
 * ```ts
 * const provider = new FieldEncryptionProvider();
 * await provider.initialize();
 *
 * // Encrypt a single field
 * const enc = await provider.encryptField('user@example.com');
 *
 * // Decrypt it later
 * const plain = await provider.decryptField(enc);
 *
 * // Encrypt a whole user row (only PII fields)
 * const encRow = await provider.encryptObject({ email: 'a@b.com', planId: 'pro' });
 * const plainRow = await provider.decryptObject(encRow);
 * ```
 */

import { SecretsVault } from './SecretsVault';
import {
  EncryptionService,
  generateKey,
  isEncryptedField,
} from '../services/shared/encryption';

import type { EncryptedField, EncryptionKey } from '../services/shared/encryption';

export type { EncryptedField, EncryptionKey };

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Key name under which the encrypted key ring is stored in the SecretsVault. */
const KEY_RING_SECRET = 'FIELD_ENCRYPTION_KEY_RING';

// ─────────────────────────────────────────────────────────────────────────────
// FieldEncryptionProvider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Production-ready provider that:
 * 1. Loads (or auto-generates) the key ring from `SecretsVault`.
 * 2. Initialises an `EncryptionService` backed by that ring.
 * 3. Exposes a clean API for encrypting / decrypting sensitive database fields.
 */
export class FieldEncryptionProvider {
  private encService: EncryptionService | null = null;
  private readonly vault: SecretsVault;

  /**
   * @param vault - Optional `SecretsVault` instance to use.
   *                Defaults to a new instance for the current environment.
   */
  constructor(vault?: SecretsVault) {
    this.vault = vault ?? new SecretsVault();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Bootstrap the encryption service.
   *
   * - Looks up the key ring in the vault.
   * - If none exists, generates a new master key, starts a ring, and stores it.
   *
   * **Must be called before any encrypt / decrypt operation.**
   */
  async initialize(): Promise<void> {
    const stored = await this.vault.get(KEY_RING_SECRET);

    if (stored) {
      this.encService = EncryptionService.fromJSON(stored);
    } else {
      const masterKey = generateKey();
      this.encService = new EncryptionService(masterKey);
      await this.vault.set(KEY_RING_SECRET, this.encService.toJSON());
    }
  }

  /**
   * Return `true` if `initialize()` has been called successfully.
   */
  isInitialized(): boolean {
    return this.encService !== null;
  }

  // ── Single field operations ───────────────────────────────────────────────

  /**
   * Encrypt a single sensitive string with the active encryption key.
   *
   * @throws If the provider has not been initialized.
   */
  encryptField(plaintext: string): EncryptedField {
    return this.service().encrypt(plaintext);
  }

  /**
   * Decrypt an `EncryptedField` value back to its plaintext.
   *
   * @throws If the provider has not been initialized or the key is unknown.
   */
  decryptField(encrypted: EncryptedField): string {
    return this.service().decrypt(encrypted);
  }

  // ── Object-level operations ───────────────────────────────────────────────

  /**
   * Encrypt all PII fields in a plain object.  Non-PII fields pass through
   * unchanged.
   *
   * @example
   * const row = { email: 'a@b.com', name: 'Alice', planId: 'pro' };
   * const encrypted = provider.encryptObject(row);
   * // → { email: { ciphertext: '…', … }, name: { ciphertext: '…', … }, planId: 'pro' }
   */
  encryptObject(obj: Record<string, unknown>): Record<string, unknown> {
    return this.service().encryptObject(obj);
  }

  /**
   * Decrypt all `EncryptedField` values in an object back to plaintext.
   * Non-encrypted fields pass through unchanged.
   */
  decryptObject(obj: Record<string, unknown>): Record<string, unknown> {
    return this.service().decryptObject(obj);
  }

  // ── Key rotation ──────────────────────────────────────────────────────────

  /**
   * Rotate the active encryption key and persist the new key ring
   * in the vault.
   *
   * After rotation, all **new** writes use the new key.  Existing encrypted
   * data can still be decrypted (the old key is kept in the ring).  Call
   * `reEncryptField()` to migrate individual fields to the new key.
   *
   * @returns The new active `EncryptionKey`.
   */
  async rotateKey(): Promise<EncryptionKey> {
    const newMasterKey = generateKey();
    const newKey = this.service().rotateKey(newMasterKey);
    await this.vault.set(KEY_RING_SECRET, this.service().toJSON());
    return newKey;
  }

  /**
   * Re-encrypt a field that was encrypted with an older key to the current
   * active key.  Use during key rotation migrations.
   */
  reEncryptField(encrypted: EncryptedField): EncryptedField {
    return this.service().reEncrypt(encrypted);
  }

  /**
   * Remove old keys from the ring after all data has been re-encrypted,
   * then persist the updated ring to the vault.
   *
   * @param keepCount - Number of most-recent key versions to retain (default 2).
   */
  async pruneOldKeys(keepCount = 2): Promise<void> {
    this.service().pruneOldKeys(keepCount);
    await this.vault.set(KEY_RING_SECRET, this.service().toJSON());
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  /**
   * Return the currently active encryption key metadata (without the raw key
   * bytes for security).
   */
  getActiveKeyInfo(): Pick<EncryptionKey, 'id' | 'version' | 'createdAt' | 'expiresAt'> {
    const key = this.service().getActiveKey();
    return { id: key.id, version: key.version, createdAt: key.createdAt, expiresAt: key.expiresAt };
  }

  /**
   * Return `true` if the active key has passed its expiry date and should be
   * rotated.
   */
  isRotationDue(): boolean {
    return this.service().isActiveKeyExpired();
  }

  /**
   * Type guard helper re-exported for consumers who need to check whether a
   * database value is encrypted or plaintext.
   */
  static isEncryptedField(value: unknown): value is EncryptedField {
    return isEncryptedField(value);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private service(): EncryptionService {
    if (!this.encService) {
      throw new Error(
        '[FieldEncryptionProvider] Not initialized — call await provider.initialize() first'
      );
    }
    return this.encService;
  }
}

/** Pre-wired singleton. Call `await fieldEncryptionProvider.initialize()` at app boot. */
export const fieldEncryptionProvider = new FieldEncryptionProvider();
