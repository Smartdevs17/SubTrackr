/**
 * Tests — API Key Rotation Service (Issue #1009)
 */

import {
  ApiKeyRotationService,
  type ManagedApiKey,
} from '../apiKeyRotation';

// Helper: advance mocked clock by ms
const tickMs = (n: number) => {
  jest.setSystemTime(Date.now() + n);
};

describe('ApiKeyRotationService', () => {
  let service: ApiKeyRotationService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z').getTime());
    service = new ApiKeyRotationService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── createKey ─────────────────────────────────────────────────────────────

  describe('createKey', () => {
    it('creates an active key with correct metadata', () => {
      const key = service.createKey('dev_1', 'My Key', 'test', ['subscriptions:read']);
      expect(key.status).toBe('active');
      expect(key.developerId).toBe('dev_1');
      expect(key.environment).toBe('test');
      expect(key.permissions).toEqual(['subscriptions:read']);
      expect(key.key).toMatch(/^sk_test_/);
      expect(key.usageCount).toBe(0);
    });

    it('creates production keys with sk_live_ prefix', () => {
      const key = service.createKey('dev_1', 'Prod Key', 'production');
      expect(key.key).toMatch(/^sk_live_/);
    });

    it('assigns unique IDs per call', () => {
      const a = service.createKey('dev_1', 'Key A', 'test');
      const b = service.createKey('dev_1', 'Key B', 'test');
      expect(a.id).not.toBe(b.id);
      expect(a.key).not.toBe(b.key);
    });
  });

  // ── validateKey ───────────────────────────────────────────────────────────

  describe('validateKey', () => {
    it('returns valid for an active key', () => {
      const key = service.createKey('dev_1', 'K', 'test');
      const result = service.validateKey(key.key);
      expect(result.valid).toBe(true);
      expect(result.isGrace).toBe(false);
      expect(result.graceRemainingMs).toBe(0);
    });

    it('returns invalid for an unknown key', () => {
      const result = service.validateKey('sk_test_unknown');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('key_not_found');
    });

    it('increments usageCount on valid use', () => {
      const key = service.createKey('dev_1', 'K', 'test');
      service.validateKey(key.key);
      service.validateKey(key.key);
      expect(service.getKey(key.id)!.usageCount).toBe(2);
    });

    it('expires an active key past its TTL', () => {
      const key = service.createKey('dev_1', 'K', 'test', [], 1_000); // 1s TTL
      tickMs(2_000);
      const result = service.validateKey(key.key);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
    });
  });

  // ── rotateKey ─────────────────────────────────────────────────────────────

  describe('rotateKey', () => {
    it('returns a new active key and old key in grace', async () => {
      const old = service.createKey('dev_1', 'K', 'test');
      const result = await service.rotateKey(old.id, { gracePeriodMs: 60_000 });

      expect(result.newKey.status).toBe('active');
      expect(result.oldKey.status).toBe('grace');
      expect(result.gracePeriodRemainingMs).toBe(60_000);
      expect(result.newKey.replacesKeyId).toBe(old.id);
      expect(result.oldKey.replacedByKeyId).toBe(result.newKey.id);
    });

    it('old key remains valid during grace period', async () => {
      const old = service.createKey('dev_1', 'K', 'test');
      const { oldKey, newKey } = await service.rotateKey(old.id, {
        gracePeriodMs: 60_000,
      });

      const oldValidation = service.validateKey(old.key);
      expect(oldValidation.valid).toBe(true);
      expect(oldValidation.isGrace).toBe(true);
      expect(oldValidation.graceRemainingMs).toBeGreaterThan(0);

      const newValidation = service.validateKey(newKey.key);
      expect(newValidation.valid).toBe(true);
      expect(newValidation.isGrace).toBe(false);
    });

    it('old key becomes invalid after grace period expires', async () => {
      const old = service.createKey('dev_1', 'K', 'test');
      const { oldKey } = await service.rotateKey(old.id, { gracePeriodMs: 5_000 });

      tickMs(6_000); // advance past grace
      const result = service.validateKey(old.key);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
    });

    it('throws when rotating a revoked key', async () => {
      const key = service.createKey('dev_1', 'K', 'test');
      service.revokeKey(key.id);
      await expect(service.rotateKey(key.id)).rejects.toThrow('Cannot rotate a revoked key');
    });

    it('throws when rotating an expired key', async () => {
      const key = service.createKey('dev_1', 'K', 'test', [], 1_000);
      tickMs(2_000);
      service.validateKey(key.key); // triggers expiry
      await expect(service.rotateKey(key.id)).rejects.toThrow('Cannot rotate an expired key');
    });

    it('records rotation history', async () => {
      const key = service.createKey('dev_1', 'K', 'test');
      await service.rotateKey(key.id, { reason: 'security audit' });
      const history = service.getRotationHistory('dev_1');
      expect(history).toHaveLength(1);
      expect(history[0]!.reason).toBe('security audit');
      expect(history[0]!.oldKeyId).toBe(key.id);
    });
  });

  // ── revokeKey ─────────────────────────────────────────────────────────────

  describe('revokeKey', () => {
    it('revokes a key and makes it invalid', () => {
      const key = service.createKey('dev_1', 'K', 'test');
      expect(service.revokeKey(key.id)).toBe(true);
      const result = service.validateKey(key.key);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('revoked');
    });

    it('returns false for already-revoked key', () => {
      const key = service.createKey('dev_1', 'K', 'test');
      service.revokeKey(key.id);
      expect(service.revokeKey(key.id)).toBe(false);
    });

    it('revokeAllKeys revokes all developer keys', async () => {
      const k1 = service.createKey('dev_2', 'K1', 'test');
      const k2 = service.createKey('dev_2', 'K2', 'production');
      const other = service.createKey('dev_3', 'Other', 'test');

      const count = service.revokeAllKeys('dev_2');
      expect(count).toBe(2);
      expect(service.validateKey(k1.key).valid).toBe(false);
      expect(service.validateKey(k2.key).valid).toBe(false);
      expect(service.validateKey(other.key).valid).toBe(true);
    });
  });

  // ── cleanupExpiredKeys ────────────────────────────────────────────────────

  describe('cleanupExpiredKeys', () => {
    it('transitions grace keys past deadline to expired', async () => {
      const key = service.createKey('dev_1', 'K', 'test');
      await service.rotateKey(key.id, { gracePeriodMs: 1_000 });
      tickMs(2_000);
      const cleaned = service.cleanupExpiredKeys();
      expect(cleaned).toBeGreaterThanOrEqual(1);
      expect(service.getKey(key.id)!.status).toBe('expired');
    });
  });

  // ── getGracePeriodStatus ──────────────────────────────────────────────────

  describe('getGracePeriodStatus', () => {
    it('returns remaining ms for a key in grace', async () => {
      const key = service.createKey('dev_1', 'K', 'test');
      const { newKey } = await service.rotateKey(key.id, { gracePeriodMs: 60_000 });
      const status = service.getGracePeriodStatus(key.id);
      expect(status).not.toBeNull();
      expect(status!.remainingMs).toBeGreaterThan(0);
      expect(status!.successorKeyId).toBe(newKey.id);
    });

    it('returns null for an active (non-grace) key', () => {
      const key = service.createKey('dev_1', 'K', 'test');
      expect(service.getGracePeriodStatus(key.id)).toBeNull();
    });

    it('returns null after grace period has passed', async () => {
      const key = service.createKey('dev_1', 'K', 'test');
      await service.rotateKey(key.id, { gracePeriodMs: 1_000 });
      tickMs(2_000);
      expect(service.getGracePeriodStatus(key.id)).toBeNull();
    });
  });

  // ── metrics ───────────────────────────────────────────────────────────────

  describe('metrics', () => {
    it('tracks key counts and validation totals', async () => {
      const k1 = service.createKey('dev_1', 'K1', 'test');
      const k2 = service.createKey('dev_1', 'K2', 'test');

      service.validateKey(k1.key); // active
      await service.rotateKey(k1.id, { gracePeriodMs: 60_000 });
      service.validateKey(k1.key); // grace hit
      service.revokeKey(k2.id);

      const m = service.getMetrics();
      expect(m.totalKeys).toBeGreaterThanOrEqual(3); // k1, k2, new rotated
      expect(m.graceKeys).toBe(1);
      expect(m.revokedKeys).toBe(1);
      expect(m.totalRotations).toBe(1);
      expect(m.gracePeriodHits).toBe(1);
      expect(m.totalValidations).toBeGreaterThanOrEqual(2);
    });

    it('exports valid prometheus metrics string', () => {
      service.createKey('dev_1', 'K', 'test');
      const prom = service.prometheusMetrics();
      expect(prom).toContain('subtrackr_api_key_total');
      expect(prom).toContain('subtrackr_api_key_rotations_total');
    });
  });
});
