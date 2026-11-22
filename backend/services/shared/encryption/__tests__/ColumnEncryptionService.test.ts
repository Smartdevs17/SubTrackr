import { ColumnEncryptionService } from '../ColumnEncryptionService';
import { KmsProvider } from '../KmsProvider';

describe('ColumnEncryptionService', () => {
  let kms: KmsProvider;
  let encryptionService: ColumnEncryptionService;

  beforeEach(() => {
    kms = new KmsProvider();
    kms.registerMasterKey('key-1', 'arn:aws:kms:us-east-1:123:key/key-1');
    encryptionService = new ColumnEncryptionService(kms);
  });

  describe('encryptField', () => {
    it('encrypts and decrypts a field', async () => {
      const encrypted = await encryptionService.encryptField('test@example.com', 'key-1');
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.authTag).toBeTruthy();
      expect(encrypted.keyId).toBe('key-1');

      const decrypted = await encryptionService.decryptField(encrypted);
      expect(decrypted).toBe('test@example.com');
    });

    it('returns empty result for empty input', async () => {
      const encrypted = await encryptionService.encryptField('', 'key-1');
      expect(encrypted.ciphertext).toBe('');
    });

    it('throws when KMS is unavailable and failClosed is true', async () => {
      kms.setAvailability(false);
      await expect(encryptionService.encryptField('data', 'key-1')).rejects.toThrow();
    });
  });

  describe('decryptField', () => {
    it('returns empty string for empty ciphertext', async () => {
      const result = await encryptionService.decryptField({
        ciphertext: '', iv: '', authTag: '', keyId: 'key-1',
        dek: { ciphertext: '', keyId: 'key-1', algorithm: 'aes-256-gcm' },
        algorithm: 'aes-256-gcm',
      });
      expect(result).toBe('');
    });
  });

  describe('rotateKey', () => {
    it('initiates key rotation', async () => {
      kms.registerMasterKey('key-2', 'arn:aws:kms:us-east-1:123:key/key-2');
      const count = await encryptionService.rotateKey('key-1', 'key-2');
      expect(count).toBe(1);
    });
  });

  describe('isPiiField', () => {
    it('identifies PII fields', () => {
      expect(ColumnEncryptionService.isPiiField('email')).toBe(true);
      expect(ColumnEncryptionService.isPiiField('name')).toBe(true);
      expect(ColumnEncryptionService.isPiiField('randomField')).toBe(false);
    });
  });
});
