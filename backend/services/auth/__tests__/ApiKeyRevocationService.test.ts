import { ApiKeyRotationService, hashApiKey } from '../domain/ApiKeyRotationService';
import { ApiKeyRevocationService, redactApiKey } from '../domain/ApiKeyRevocationService';
import { AuthErrorCode } from '../errors';
import { eventBus, type AnyDomainEvent, type EventSubscription } from '../../shared/events';

// Built at runtime so key-shaped fixtures are not mistaken for real secrets by scanners.
const fakeKey = (suffix: string): string => ['sk', 'live', suffix].join('_');

async function expectAuthError(fn: () => unknown, code: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`Expected AuthError with code ${code}`);
}

describe('ApiKeyRevocationService', () => {
  let keys: ApiKeyRotationService;
  let service: ApiKeyRevocationService;
  let events: AnyDomainEvent[];
  let subscription: EventSubscription;

  beforeEach(() => {
    keys = new ApiKeyRotationService();
    service = new ApiKeyRevocationService(keys);
    events = [];
    subscription = eventBus.subscribe('*', (event) => {
      events.push(event);
    });
  });

  afterEach(() => {
    subscription.unsubscribe();
    jest.restoreAllMocks();
  });

  describe('revokeKey', () => {
    it('revokes a key so it can no longer authenticate', async () => {
      const { keyId, rawKey } = await keys.registerKey('merchant-1');

      const record = await service.revokeKey(keyId, {
        reason: 'employee_left',
        actorId: 'admin-1',
      });

      expect(record.status).toBe('revoked');
      expect(record.revocationReason).toBe('employee_left');
      expect(record.revokedAt).toEqual(expect.any(String));
      await expectAuthError(() => keys.validateKey(rawKey), AuthErrorCode.API_KEY_REVOKED);
    });

    it('writes an audit entry and publishes an event', async () => {
      const { keyId } = await keys.registerKey('merchant-1');
      await service.revokeKey(keyId, { reason: 'manual', actorId: 'admin-1' });

      const [entry] = service.getAuditLog({ keyId });
      expect(entry).toMatchObject({
        keyId,
        merchantId: 'merchant-1',
        action: 'revoked',
        actorId: 'admin-1',
      });

      const event = events.find((e) => e.name === 'auth.api_key_revoked');
      expect(event?.payload).toMatchObject({
        keyId,
        merchantId: 'merchant-1',
        reason: 'manual',
        revokedBy: 'admin-1',
      });
    });

    it('fails for unknown or already revoked keys', async () => {
      await expectAuthError(
        () => service.revokeKey('missing', { reason: 'manual', actorId: 'admin-1' }),
        AuthErrorCode.API_KEY_NOT_FOUND
      );

      const { keyId } = await keys.registerKey('merchant-1');
      await service.revokeKey(keyId, { reason: 'manual', actorId: 'admin-1' });
      await expectAuthError(
        () => service.revokeKey(keyId, { reason: 'manual', actorId: 'admin-1' }),
        AuthErrorCode.API_KEY_ALREADY_REVOKED
      );
    });

    it('still revokes when event publishing fails', async () => {
      jest.spyOn(eventBus, 'publish').mockRejectedValueOnce(new Error('bus down'));
      const { keyId } = await keys.registerKey('merchant-1');
      const record = await service.revokeKey(keyId, { reason: 'manual', actorId: 'admin-1' });
      expect(record.status).toBe('revoked');
    });
  });

  describe('revokeAllForMerchant', () => {
    it('revokes only the merchant keys that are not yet revoked', async () => {
      const a = await keys.registerKey('merchant-1');
      await keys.registerKey('merchant-1');
      const other = await keys.registerKey('merchant-2');
      await service.revokeKey(a.keyId, { reason: 'manual', actorId: 'admin-1' });

      const count = await service.revokeAllForMerchant('merchant-1', {
        reason: 'account_closed',
        actorId: 'admin-1',
      });

      expect(count).toBe(1);
      expect(
        keys.listKeyIds('merchant-1').every((id) => keys.getKey(id)?.status === 'revoked')
      ).toBe(true);
      expect(keys.getKey(other.keyId)?.status).toBe('active');
    });
  });

  describe('scanForLeaks', () => {
    it('auto-revokes a live key found in scanned content', async () => {
      const { keyId, rawKey } = await keys.registerKey('merchant-1');
      const content = `const client = new SubTrackr({ apiKey: "${rawKey}" });`;

      const result = await service.scanForLeaks(content, 'github:acme/app@abc123');

      expect(result.scannedCandidates).toBe(1);
      expect(result.incidents).toHaveLength(1);
      const [incident] = result.incidents;
      expect(incident).toMatchObject({
        keyId,
        merchantId: 'merchant-1',
        method: 'pattern_scan',
        severity: 'critical',
        status: 'auto_revoked',
        source: 'github:acme/app@abc123',
        resolvedBy: 'system:leak-detector',
      });
      expect(incident.redactedKey).toBe(redactApiKey(rawKey));
      expect(JSON.stringify(result)).not.toContain(rawKey);
      expect(keys.getKey(keyId)?.status).toBe('revoked');

      const leakEvent = events.find((e) => e.name === 'auth.api_key_leak_detected');
      expect(leakEvent?.payload).toMatchObject({
        keyId,
        autoRevoked: true,
        method: 'pattern_scan',
      });
      expect(service.getAuditLog({ keyId }).map((e) => e.action)).toEqual([
        'revoked',
        'leak_detected',
      ]);
    });

    it('ignores key-shaped strings that do not match a stored key', async () => {
      await keys.registerKey('merchant-1');
      const result = await service.scanForLeaks(
        `${fakeKey('abcdefghijklmnopqrstuvwxyz')} and sk_short`,
        'pastebin'
      );
      expect(result).toEqual({ scannedCandidates: 1, incidents: [] });
    });

    it('deduplicates repeated occurrences of the same key', async () => {
      const { rawKey } = await keys.registerKey('merchant-1');
      const result = await service.scanForLeaks(`${rawKey}\n${rawKey}`, 'logs');
      expect(result.scannedCandidates).toBe(1);
      expect(result.incidents).toHaveLength(1);
    });

    it('flags without revoking when auto-revoke is disabled, and does not duplicate open incidents', async () => {
      const { keyId, rawKey } = await keys.registerKey('merchant-1');
      service.updatePolicy('merchant-1', { autoRevokeOnExposure: false });

      const first = await service.scanForLeaks(rawKey, 'slack');
      const second = await service.scanForLeaks(rawKey, 'slack');

      expect(first.incidents[0].status).toBe('open');
      expect(second.incidents[0].id).toBe(first.incidents[0].id);
      expect(service.getIncidents({ keyId })).toHaveLength(1);
      expect(keys.getKey(keyId)?.status).toBe('active');
    });

    it('does not raise incidents for keys that are already revoked', async () => {
      const { keyId, rawKey } = await keys.registerKey('merchant-1');
      await service.revokeKey(keyId, { reason: 'manual', actorId: 'admin-1' });
      const result = await service.scanForLeaks(rawKey, 'logs');
      expect(result.incidents).toEqual([]);
    });

    it('rejects invalid content', async () => {
      await expect(service.scanForLeaks(42 as unknown as string, 'x')).rejects.toThrow(
        'content must be a string'
      );
      await expect(service.scanForLeaks('a'.repeat(5 * 1024 * 1024 + 1), 'x')).rejects.toThrow(
        'exceeds'
      );
    });
  });

  describe('checkLeakedHashes', () => {
    it('matches SHA-256 digests from a breach feed', async () => {
      const { keyId, rawKey, record } = await keys.registerKey('merchant-1');
      const result = await service.checkLeakedHashes(
        [hashApiKey(rawKey).toUpperCase(), 'not-a-hash', 'f'.repeat(64)],
        'partner-feed'
      );

      expect(result.scannedCandidates).toBe(2);
      expect(result.incidents).toHaveLength(1);
      expect(result.incidents[0]).toMatchObject({
        keyId,
        method: 'hash_match',
        status: 'auto_revoked',
      });
      expect(result.incidents[0].redactedKey).toBe(`${record.keyPrefix}…`);
    });

    it('rejects a non-array payload', async () => {
      await expect(service.checkLeakedHashes('abc' as unknown as string[], 'feed')).rejects.toThrow(
        'must be an array'
      );
    });
  });

  describe('reportLeak', () => {
    it('opens an incident for a manually reported key', async () => {
      service.updatePolicy('default', { autoRevokeOnExposure: false });
      const { keyId } = await keys.registerKey('merchant-1');

      const incident = await service.reportLeak(keyId, {
        source: 'screenshot',
        actorId: 'merchant-admin',
      });

      expect(incident).toMatchObject({ keyId, method: 'manual_report', status: 'open' });
      expect(service.getAuditLog({ keyId })[0]).toMatchObject({
        action: 'leak_detected',
        actorId: 'merchant-admin',
      });
    });

    it('fails for unknown or revoked keys', async () => {
      await expectAuthError(
        () => service.reportLeak('missing', { source: 'x', actorId: 'a' }),
        AuthErrorCode.API_KEY_NOT_FOUND
      );
      const { keyId } = await keys.registerKey('merchant-1');
      await service.revokeKey(keyId, { reason: 'manual', actorId: 'admin-1' });
      await expectAuthError(
        () => service.reportLeak(keyId, { source: 'x', actorId: 'a' }),
        AuthErrorCode.API_KEY_ALREADY_REVOKED
      );
    });
  });

  describe('recordUsage', () => {
    const t0 = 1_700_000_000_000;

    it('returns null while usage stays within policy', async () => {
      const { keyId } = await keys.registerKey('merchant-1');
      for (let i = 0; i < 5; i++) {
        expect(await service.recordUsage({ keyId, ip: '10.0.0.1', timestamp: t0 + i })).toBeNull();
      }
      expect(service.getIncidents()).toEqual([]);
    });

    it('flags a key used from too many distinct IPs', async () => {
      service.updatePolicy('merchant-1', { maxDistinctIps: 3 });
      const { keyId } = await keys.registerKey('merchant-1');

      const results = [];
      for (let i = 1; i <= 5; i++) {
        results.push(await service.recordUsage({ keyId, ip: `203.0.113.${i}`, timestamp: t0 + i }));
      }

      expect(results.slice(0, 3)).toEqual([null, null, null]);
      expect(results[3]).toMatchObject({
        keyId,
        method: 'usage_anomaly',
        severity: 'high',
        status: 'open',
      });
      expect(results[4]).toBeNull(); // open incident is not duplicated
      expect(keys.getKey(keyId)?.status).toBe('active');
      expect(service.getAuditLog({ keyId })[0].action).toBe('anomaly_flagged');
    });

    it('flags request bursts and auto-revokes when the policy says so', async () => {
      service.updatePolicy('merchant-1', { maxRequestsPerWindow: 2, autoRevokeOnAnomaly: true });
      const { keyId } = await keys.registerKey('merchant-1');

      await service.recordUsage({ keyId, ip: '10.0.0.1', timestamp: t0 });
      await service.recordUsage({ keyId, ip: '10.0.0.1', timestamp: t0 + 1 });
      const incident = await service.recordUsage({ keyId, ip: '10.0.0.1', timestamp: t0 + 2 });

      expect(incident?.status).toBe('auto_revoked');
      expect(keys.getKey(keyId)?.status).toBe('revoked');
      expect(await service.recordUsage({ keyId, ip: '10.0.0.1', timestamp: t0 + 3 })).toBeNull();
    });

    it('only counts usage inside the sliding window', async () => {
      service.updatePolicy('merchant-1', { maxDistinctIps: 2, anomalyWindowMs: 1000 });
      const { keyId } = await keys.registerKey('merchant-1');

      await service.recordUsage({ keyId, ip: '10.0.0.1', timestamp: t0 });
      await service.recordUsage({ keyId, ip: '10.0.0.2', timestamp: t0 + 10 });
      const incident = await service.recordUsage({ keyId, ip: '10.0.0.3', timestamp: t0 + 5000 });

      expect(incident).toBeNull();
    });

    it('ignores unknown keys', async () => {
      expect(await service.recordUsage({ keyId: 'missing', ip: '10.0.0.1' })).toBeNull();
    });
  });

  describe('incident management', () => {
    async function openIncident() {
      service.updatePolicy('merchant-1', { autoRevokeOnExposure: false });
      const { keyId, rawKey } = await keys.registerKey('merchant-1');
      const { incidents } = await service.scanForLeaks(rawKey, 'logs');
      return { keyId, incident: incidents[0] };
    }

    it('confirms an incident by revoking the key', async () => {
      const { keyId, incident } = await openIncident();

      const confirmed = await service.confirmIncident(incident.id, 'security-1');

      expect(confirmed).toMatchObject({ status: 'revoked', resolvedBy: 'security-1' });
      expect(keys.getKey(keyId)?.status).toBe('revoked');
      expect(keys.getKey(keyId)?.revocationReason).toBe('leak_confirmed:pattern_scan');
      // Confirming again is a no-op.
      expect((await service.confirmIncident(incident.id, 'security-2')).resolvedBy).toBe(
        'security-1'
      );
    });

    it('dismisses a false positive and keeps the key active', async () => {
      const { keyId, incident } = await openIncident();

      const dismissed = service.dismissIncident(incident.id, 'security-1', 'test fixture key');

      expect(dismissed.status).toBe('dismissed');
      expect(keys.getKey(keyId)?.status).toBe('active');
      expect(service.getAuditLog({ keyId })[0]).toMatchObject({
        action: 'incident_dismissed',
        reason: 'test fixture key',
      });
      expect(() => service.dismissIncident(incident.id, 'security-1', 'again')).toThrow(
        'already resolved'
      );
    });

    it('closes open incidents when the key is revoked manually', async () => {
      const { keyId, incident } = await openIncident();
      await service.revokeKey(keyId, { reason: 'manual', actorId: 'admin-1' });
      expect(service.getIncident(incident.id)?.status).toBe('revoked');
    });

    it('fails for unknown incidents', async () => {
      await expectAuthError(
        () => service.confirmIncident('missing', 'a'),
        AuthErrorCode.LEAK_INCIDENT_NOT_FOUND
      );
      await expectAuthError(
        () => service.dismissIncident('missing', 'a', 'r'),
        AuthErrorCode.LEAK_INCIDENT_NOT_FOUND
      );
      expect(service.getIncident('missing')).toBeUndefined();
    });

    it('filters incidents', async () => {
      const { keyId } = await openIncident();
      expect(service.getIncidents({ merchantId: 'merchant-1', status: 'open' })).toHaveLength(1);
      expect(service.getIncidents({ keyId, status: 'dismissed' })).toHaveLength(0);
      expect(service.getIncidents({ merchantId: 'merchant-2' })).toHaveLength(0);
    });
  });

  describe('policy', () => {
    it('falls back to the default policy', () => {
      expect(service.getPolicy('merchant-1')).toMatchObject({
        autoRevokeOnExposure: true,
        autoRevokeOnAnomaly: false,
      });
    });

    it('rejects invalid values and ignores unknown fields', () => {
      expect(() => service.updatePolicy('merchant-1', { maxDistinctIps: 0 })).toThrow(
        'positive number'
      );
      expect(() => service.updatePolicy('merchant-1', { anomalyWindowMs: Number.NaN })).toThrow(
        'positive number'
      );
      expect(() =>
        service.updatePolicy('merchant-1', { autoRevokeOnAnomaly: 'yes' as unknown as boolean })
      ).toThrow('boolean');

      const updated = service.updatePolicy('merchant-1', {
        maxDistinctIps: 5,
        extra: true,
      } as never);
      expect(updated.maxDistinctIps).toBe(5);
      expect(updated).not.toHaveProperty('extra');
    });
  });

  describe('redactApiKey', () => {
    it('keeps only a short prefix and suffix', () => {
      expect(redactApiKey(fakeKey('abcdefghijklmnop1234'))).toBe('sk_live_…1234');
      expect(redactApiKey('sk_short')).toBe('sk_…');
    });
  });
});
