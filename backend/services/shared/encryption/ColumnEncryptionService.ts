import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { logger } from '../logging';
import type { IKmsProvider, EncryptedDek } from './KmsProvider';

export interface EncryptedColumnValue {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: string;
  dek: EncryptedDek;
  algorithm: 'aes-256-gcm';
}

export interface ColumnEncryptionConfig {
  failClosedOnKmsError: boolean;
  writeQueueWhenKmsDown: boolean;
}

const DEFAULT_CONFIG: ColumnEncryptionConfig = {
  failClosedOnKmsError: true,
  writeQueueWhenKmsDown: false,
};

const PII_FIELD_WHITELIST: ReadonlySet<string> = new Set([
  'email', 'name', 'address', 'phone', 'phoneNumber',
  'paymentMethodToken', 'payment_method_token',
  'metadata', 'businessName', 'recipientEmail',
  'subscriberId', 'bankAccount', 'routingNumber',
]);

export class ColumnEncryptionService {
  private dekCache = new Map<string, Buffer>();
  private writeQueue: Array<{ field: string; value: string; keyId: string }> = [];
  private keyVersion = 0;
  private pendingRotation: string[] = [];

  constructor(
    private kmsProvider: IKmsProvider,
    private config: ColumnEncryptionConfig = DEFAULT_CONFIG
  ) {}

  async encryptField(plaintext: string, keyId: string): Promise<EncryptedColumnValue> {
    if (!plaintext) {
      return { ciphertext: '', iv: '', authTag: '', keyId, dek: { ciphertext: '', keyId, algorithm: 'aes-256-gcm' }, algorithm: 'aes-256-gcm' };
    }

    try {
      const { plaintext: dek, encrypted } = await this.kmsProvider.generateDataKey(keyId);
      this.dekCache.set(keyId, dek);

      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', dek, iv);
      const encrypted_data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      logger.info('Field encrypted', { keyId, algorithm: 'aes-256-gcm' });

      return {
        ciphertext: encrypted_data.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        keyId,
        dek: encrypted,
        algorithm: 'aes-256-gcm',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Encryption failed', { keyId, error: message });

      if (this.config.failClosedOnKmsError && !this.config.writeQueueWhenKmsDown) {
        throw new Error(`ENCRYPTION_KMS_UNAVAILABLE: ${message}`);
      }

      if (this.config.writeQueueWhenKmsDown) {
        this.writeQueue.push({ field: 'unknown', value: plaintext, keyId });
        return { ciphertext: '', iv: '', authTag: '', keyId, dek: { ciphertext: '', keyId, algorithm: 'aes-256-gcm' }, algorithm: 'aes-256-gcm' };
      }

      throw err;
    }
  }

  async decryptField(encrypted: EncryptedColumnValue): Promise<string> {
    if (!encrypted.ciphertext) return '';

    try {
      let dek = this.dekCache.get(encrypted.keyId);
      if (!dek) {
        dek = await this.kmsProvider.decryptDataKey(encrypted.dek);
        this.dekCache.set(encrypted.keyId, dek);
      }

      const iv = Buffer.from(encrypted.iv, 'base64');
      const authTag = Buffer.from(encrypted.authTag, 'base64');
      const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');

      const decipher = createDecipheriv('aes-256-gcm', dek, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      return decrypted.toString('utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Decryption failed', { keyId: encrypted.keyId, error: message });
      if (this.config.failClosedOnKmsError) {
        throw new Error(`ENCRYPTION_DECRYPT_FAILED: ${message}`);
      }
      throw err;
    }
  }

  async rotateKey(oldKeyId: string, newKeyId: string): Promise<number> {
    let rotatedCount = 0;
    try {
      this.pendingRotation.push(oldKeyId);
      logger.info('Key rotation initiated', { oldKeyId, newKeyId });
      rotatedCount++;
      this.pendingRotation = this.pendingRotation.filter((id) => id !== oldKeyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Key rotation failed', { oldKeyId, newKeyId, error: message });
      throw new Error(`ENCRYPTION_KEY_ROTATION_FAILED: ${message}`);
    }
    return rotatedCount;
  }

  getWriteQueueLength(): number {
    return this.writeQueue.length;
  }

  drainWriteQueue(): Array<{ field: string; value: string; keyId: string }> {
    const items = [...this.writeQueue];
    this.writeQueue = [];
    return items;
  }

  clearDekCache(): void {
    this.dekCache.clear();
  }

  static isPiiField(fieldName: string): boolean {
    return PII_FIELD_WHITELIST.has(fieldName);
  }

  static getPiiFields(): readonly string[] {
    return Array.from(PII_FIELD_WHITELIST);
  }
}
