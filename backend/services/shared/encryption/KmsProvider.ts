import { randomBytes, createCipheriv, createDecipheriv, createHmac } from 'crypto';

export interface KmsKey {
  id: string;
  arn: string;
  algorithm: 'aes-256-gcm';
  createdAt: number;
}

export interface EncryptedDek {
  ciphertext: string;
  keyId: string;
  algorithm: 'aes-256-gcm';
}

export interface IKmsProvider {
  generateDataKey(keyId: string): Promise<{ plaintext: Buffer; encrypted: EncryptedDek }>;
  decryptDataKey(encrypted: EncryptedDek): Promise<Buffer>;
  ping(): Promise<boolean>;
}

export class KmsProvider implements IKmsProvider {
  private masterKeys = new Map<string, KmsKey>();
  private available = true;

  async generateDataKey(keyId: string): Promise<{ plaintext: Buffer; encrypted: EncryptedDek }> {
    this.ensureAvailable();
    const key = this.masterKeys.get(keyId);
    if (!key) throw new Error(`KMS master key not found: ${keyId}`);

    const plaintext = randomBytes(32);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key.id.padEnd(32, '0').slice(0, 32), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    return {
      plaintext,
      encrypted: {
        ciphertext: encrypted.toString('base64') + ':' + cipher.getAuthTag().toString('base64'),
        keyId,
        algorithm: 'aes-256-gcm',
      },
    };
  }

  async decryptDataKey(encrypted: EncryptedDek): Promise<Buffer> {
    this.ensureAvailable();
    const key = this.masterKeys.get(encrypted.keyId);
    if (!key) throw new Error(`KMS master key not found: ${encrypted.keyId}`);

    const [ciphertextB64, authTagB64] = encrypted.ciphertext.split(':');
    const iv = randomBytes(16);
    const decipher = createDecipheriv('aes-256-gcm', key.id.padEnd(32, '0').slice(0, 32), iv);
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  }

  async ping(): Promise<boolean> {
    return this.available;
  }

  setAvailability(available: boolean): void {
    this.available = available;
  }

  registerMasterKey(keyId: string, arn: string): void {
    this.masterKeys.set(keyId, {
      id: keyId,
      arn,
      algorithm: 'aes-256-gcm',
      createdAt: Date.now(),
    });
  }

  private ensureAvailable(): void {
    if (!this.available) {
      throw new Error('KMS_UNAVAILABLE');
    }
  }
}

export const kmsProvider = new KmsProvider();
