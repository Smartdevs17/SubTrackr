import { ApiKeyRotationService, hasScope } from '../domain/ApiKeyRotationService';
import { AuthErrorCode } from '../errors';

describe('Scoped API Keys with Expiry', () => {
  let service: ApiKeyRotationService;

  beforeEach(() => {
    service = new ApiKeyRotationService();
  });

  describe('hasScope helper', () => {
    it('matches exact scope', () => {
      expect(hasScope(['read:subscriptions', 'write:subscriptions'], 'read:subscriptions')).toBe(true);
      expect(hasScope(['read:subscriptions'], 'delete:subscriptions')).toBe(false);
    });

    it('matches universal wildcard *', () => {
      expect(hasScope(['*'], 'admin:billing')).toBe(true);
      expect(hasScope(['*'], 'read:metrics')).toBe(true);
    });

    it('matches namespace prefix wildcard like read:*', () => {
      expect(hasScope(['read:*'], 'read:subscriptions')).toBe(true);
      expect(hasScope(['read:*'], 'read:invoices')).toBe(true);
      expect(hasScope(['read:*'], 'write:subscriptions')).toBe(false);
    });

    it('handles empty or undefined scopes', () => {
      expect(hasScope(undefined, 'read:subscriptions')).toBe(false);
      expect(hasScope([], 'read:subscriptions')).toBe(false);
    });
  });

  describe('Registration and Scope Enforcement', () => {
    it('registers a key with specific scopes and validates successfully', async () => {
      const { rawKey, record } = await service.registerKey('merchant-1', {
        scopes: ['read:subscriptions', 'write:subscriptions'],
        expiresInDays: 7,
      });

      expect(record.scopes).toEqual(['read:subscriptions', 'write:subscriptions']);
      expect(record.status).toBe('active');

      const validated = await service.validateKey(rawKey, 'read:subscriptions');
      expect(validated).toBeDefined();
      expect(validated?.id).toBe(record.id);
    });

    it('rejects validation when key lacks required scope', async () => {
      const { rawKey } = await service.registerKey('merchant-1', {
        scopes: ['read:subscriptions'],
      });

      await expect(service.validateKey(rawKey, 'write:subscriptions')).rejects.toThrow(
        /lacks required scope: write:subscriptions/
      );
    });

    it('defaults to wildcard scope when none specified', async () => {
      const { rawKey, record } = await service.registerKey('merchant-1');
      expect(record.scopes).toEqual(['*']);

      const validated = await service.validateKey(rawKey, 'any:arbitrary:scope');
      expect(validated).toBeDefined();
    });
  });

  describe('Expiry Enforcement', () => {
    it('enforces expiry when key has expired', async () => {
      const { rawKey, record } = await service.registerKey('merchant-1', {
        scopes: ['read:plans'],
        expiresInDays: -1, // already in the past
      });

      await expect(service.validateKey(rawKey)).rejects.toThrow(
        /API key expired/
      );

      const storedKey = service.getKey(record.id);
      expect(storedKey?.status).toBe('expired');
    });

    it('preserves scopes when rotated', async () => {
      const { keyId, record } = await service.registerKey('merchant-1', {
        scopes: ['read:subscriptions', 'billing:manage'],
      });

      const rotated = await service.rotateKey(keyId);
      expect(rotated.scopes).toEqual(['read:subscriptions', 'billing:manage']);
    });
  });
});
