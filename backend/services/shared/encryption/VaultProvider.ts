import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import type { IKmsProvider, EncryptedDek } from './KmsProvider';

export class VaultProvider implements IKmsProvider {
  private transitKeys = new Map<string, Buffer>();
  private available = true;

  async generateDataKey(keyId: string): Promise<{ plaintext: Buffer; encrypted: EncryptedDek }> {
    this.ensureAvailable();
    const key = this.transitKeys.get(keyId);
    if (!key) throw new Error(`Vault transit key not found: ${keyId}`);

    const plaintext = randomBytes(32);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key.slice(0, 32), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      plaintext,
      encrypted: {
        ciphertext: encrypted.toString('base64') + ':' + authTag.toString('base64'),
        keyId,
        algorithm: 'aes-256-gcm',
      },
    };
  }

  async decryptDataKey(encrypted: EncryptedDek): Promise<Buffer> {
    this.ensureAvailable();
    const key = this.transitKeys.get(encrypted.keyId);
    if (!key) throw new Error(`Vault transit key not found: ${encrypted.keyId}`);

    const [ciphertextB64, authTagB64] = encrypted.ciphertext.split(':');
    const iv = randomBytes(16);
    const decipher = createDecipheriv('aes-256-gcm', key.slice(0, 32), iv);
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  }

  async ping(): Promise<boolean> {
    return this.available;
  }

  setAvailability(available: boolean): void {
    this.available = available;
  }

  registerTransitKey(keyId: string, keyMaterial: Buffer): void {
    this.transitKeys.set(keyId, keyMaterial);
  }

  private ensureAvailable(): void {
    if (!this.available) {
      throw new Error('VAULT_UNAVAILABLE');
    }
  }
}

export const vaultProvider = new VaultProvider();
