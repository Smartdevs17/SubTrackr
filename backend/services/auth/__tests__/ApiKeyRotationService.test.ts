import { ApiKeyRotationService } from '../domain/ApiKeyRotationService';

describe('ApiKeyRotationService', () => {
  let service: ApiKeyRotationService;

  beforeEach(() => {
    service = new ApiKeyRotationService();
  });

  describe('registerKey', () => {
    it('registers a new API key for a merchant', async () => {
      const result = await service.registerKey('merchant-1');
      expect(result.keyId).toBeDefined();
      expect(result.rawKey).toMatch(/^sk_/);
      expect(result.record.merchantId).toBe('merchant-1');
      expect(result.record.status).toBe('active');
    });
  });

  describe('rotateKey', () => {
    it('rotates an existing key', async () => {
      const { keyId } = await service.registerKey('merchant-1');
      const rotated = await service.rotateKey(keyId);
      expect(rotated.id).not.toBe(keyId);
      expect(rotated.status).toBe('active');
    });

    it('throws for non-existent key', async () => {
      await expect(service.rotateKey('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('forceRotateKey', () => {
    it('immediately revokes and replaces a key', async () => {
      const { keyId } = await service.registerKey('merchant-1');
      const rotated = await service.forceRotateKey(keyId);
      expect(rotated.status).toBe('active');
    });
  });

  describe('getPolicy / updatePolicy', () => {
    it('returns default policy', async () => {
      const policy = await service.getPolicy('merchant-1');
      expect(policy.intervalDays).toBe(30);
      expect(policy.gracePeriodHours).toBe(24);
    });

    it('updates policy', async () => {
      const updated = await service.updatePolicy('merchant-1', { intervalDays: 60 });
      expect(updated.intervalDays).toBe(60);
      expect(updated.gracePeriodHours).toBe(24);
    });
  });

  describe('getKeysDueForRotation', () => {
    it('returns empty when no keys are due', async () => {
      const due = await service.getKeysDueForRotation();
      expect(due).toHaveLength(0);
    });
  });

  describe('validateKey', () => {
    it('validates a raw key', async () => {
      const { rawKey, keyId } = await service.registerKey('merchant-1');
      const record = await service.validateKey(rawKey);
      expect(record).not.toBeNull();
      expect(record!.merchantId).toBe('merchant-1');
    });

    it('returns null for unknown key', async () => {
      const record = await service.validateKey('sk_invalid');
      expect(record).toBeNull();
    });
  });
});
