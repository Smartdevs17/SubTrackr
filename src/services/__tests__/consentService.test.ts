import {
  allConsent,
  CONSENT_POLICY_VERSION,
  CONSENT_STORAGE_KEY,
  ConsentStorage,
  ConsentValidationError,
  createConsentService,
  MAX_CONSENT_HISTORY,
  StoredConsent,
} from '../consentService';
import { gdprService } from '../gdpr';

jest.mock('../logging', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function memoryStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  const storage: ConsentStorage & { data: Record<string, string> } = {
    data,
    getItem: jest.fn(async (key: string) => data[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      data[key] = value;
    }),
  };
  return storage;
}

const fixedNow = () => new Date('2026-09-27T10:00:00.000Z');

function setup(overrides: Parameters<typeof createConsentService>[0] = {}) {
  const storage = memoryStorage();
  const transport = jest.fn().mockResolvedValue(undefined);
  const service = createConsentService({ storage, transport, now: fixedNow, ...overrides });
  return { storage, transport, service };
}

function stored(storage: { data: Record<string, string> }): StoredConsent {
  return JSON.parse(storage.data[CONSENT_STORAGE_KEY]);
}

describe('consentService', () => {
  describe('load', () => {
    it('returns null when the user has never decided', async () => {
      const { service } = setup();
      await expect(service.load()).resolves.toBeNull();
    });

    it('treats malformed JSON as no decision', async () => {
      const storage = memoryStorage({ [CONSENT_STORAGE_KEY]: '{not json' });
      const service = createConsentService({ storage });
      await expect(service.load()).resolves.toBeNull();
    });

    it('treats a record with the wrong shape as no decision', async () => {
      const storage = memoryStorage({
        [CONSENT_STORAGE_KEY]: JSON.stringify({
          policyVersion: CONSENT_POLICY_VERSION,
          updatedAt: 'x',
          preferences: { analytics: 'yes', marketing: false, notifications: false },
          history: [],
          pendingRecords: [],
        }),
      });
      const service = createConsentService({ storage });
      await expect(service.load()).resolves.toBeNull();
    });

    it('propagates storage read failures', async () => {
      const storage = memoryStorage();
      (storage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
      const service = createConsentService({ storage });
      await expect(service.load()).rejects.toThrow('disk unavailable');
    });
  });

  describe('requiresConsent', () => {
    it('requires consent when nothing is stored or the policy version changed', async () => {
      const { service } = setup();
      expect(service.requiresConsent(null)).toBe(true);

      const { consent } = await service.save('u1', allConsent(false), 'banner');
      expect(service.requiresConsent(consent)).toBe(false);
      expect(service.requiresConsent({ ...consent, policyVersion: '2020-01-01' })).toBe(true);
    });
  });

  describe('save', () => {
    it('records every category on the first decision and persists it', async () => {
      const { service, storage, transport } = setup();

      const result = await service.save(
        'u1',
        { analytics: true, marketing: false, notifications: true },
        'banner'
      );

      expect(result.synced).toBe(true);
      expect(result.consent.preferences).toEqual({
        analytics: true,
        marketing: false,
        notifications: true,
      });
      expect(result.consent.history).toHaveLength(3);
      expect(result.consent.history.map((r) => r.category).sort()).toEqual([
        'analytics',
        'marketing',
        'notifications',
      ]);
      expect(result.consent.history.every((r) => r.source === 'banner')).toBe(true);
      expect(result.consent.history.every((r) => r.version === CONSENT_POLICY_VERSION)).toBe(true);
      expect(result.consent.history.every((r) => r.userId === 'u1')).toBe(true);
      expect(result.consent.pendingRecords).toEqual([]);
      expect(result.consent.updatedAt).toBe('2026-09-27T10:00:00.000Z');
      expect(stored(storage)).toEqual(result.consent);
      expect(transport).toHaveBeenCalledWith(
        'u1',
        result.consent.preferences,
        expect.arrayContaining([expect.objectContaining({ category: 'analytics', granted: true })])
      );
    });

    it('only records categories that changed on later saves', async () => {
      const { service, transport } = setup();
      await service.save('u1', allConsent(false), 'banner');
      transport.mockClear();

      const result = await service.save(
        'u1',
        { analytics: true, marketing: false, notifications: false },
        'settings'
      );

      expect(result.consent.history).toHaveLength(4);
      expect(result.consent.history[0]).toMatchObject({
        category: 'analytics',
        granted: true,
        source: 'settings',
      });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0][2]).toHaveLength(1);
    });

    it('is a no-op when nothing changed', async () => {
      const { service, storage, transport } = setup();
      const first = await service.save('u1', allConsent(true), 'banner');
      transport.mockClear();
      (storage.setItem as jest.Mock).mockClear();

      const second = await service.save('u1', allConsent(true), 'settings');

      expect(second).toEqual({ consent: first.consent, synced: true });
      expect(transport).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('re-records every category after a policy version change', async () => {
      const storage = memoryStorage();
      const transport = jest.fn().mockResolvedValue(undefined);
      await createConsentService({ storage, transport, policyVersion: 'v1' }).save(
        'u1',
        allConsent(true),
        'banner'
      );

      const v2 = createConsentService({ storage, transport, policyVersion: 'v2' });
      const result = await v2.save('u1', allConsent(true), 'banner');

      expect(result.consent.policyVersion).toBe('v2');
      expect(result.consent.history).toHaveLength(6);
      expect(result.consent.history.slice(0, 3).every((r) => r.version === 'v2')).toBe(true);
    });

    it('keeps the local decision and queues records when sync fails', async () => {
      const { service, storage, transport } = setup();
      transport.mockRejectedValueOnce(new Error('offline'));

      const result = await service.save('u1', allConsent(false), 'settings');

      expect(result.synced).toBe(false);
      expect(result.consent.preferences).toEqual(allConsent(false));
      expect(result.consent.pendingRecords).toHaveLength(3);
      expect(stored(storage).pendingRecords).toHaveLength(3);
    });

    it('sends previously queued records with the next save', async () => {
      const { service, transport } = setup();
      transport.mockRejectedValueOnce(new Error('offline'));
      await service.save('u1', allConsent(false), 'settings');

      const result = await service.save(
        'u1',
        { analytics: true, marketing: false, notifications: false },
        'settings'
      );

      expect(result.synced).toBe(true);
      expect(transport.mock.calls[1][2]).toHaveLength(4);
      expect(result.consent.pendingRecords).toEqual([]);
    });

    it('retries pending records even when preferences are unchanged', async () => {
      const { service, transport } = setup();
      transport.mockRejectedValueOnce(new Error('offline'));
      await service.save('u1', allConsent(true), 'banner');

      const result = await service.save('u1', allConsent(true), 'banner');

      expect(transport).toHaveBeenCalledTimes(2);
      expect(result.synced).toBe(true);
      expect(result.consent.pendingRecords).toEqual([]);
      expect(result.consent.history).toHaveLength(3);
    });

    it('caps the audit history', async () => {
      const { service } = setup();
      for (let i = 0; i < MAX_CONSENT_HISTORY; i += 1) {
        await service.save('u1', allConsent(i % 2 === 0), 'settings');
      }
      const { consent } = await service.save('u1', allConsent(true), 'settings');
      expect(consent.history).toHaveLength(MAX_CONSENT_HISTORY);
    });

    it('rejects a missing user id', async () => {
      const { service, storage } = setup();
      await expect(service.save('  ', allConsent(true), 'banner')).rejects.toBeInstanceOf(
        ConsentValidationError
      );
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('rejects non-boolean preferences', async () => {
      const { service } = setup();
      const bad = { analytics: 'yes', marketing: false } as unknown as ReturnType<
        typeof allConsent
      >;
      await expect(service.save('u1', bad, 'banner')).rejects.toThrow(
        'Consent preferences must be booleans'
      );
    });

    it('propagates storage write failures', async () => {
      const { service, storage } = setup();
      (storage.setItem as jest.Mock).mockRejectedValueOnce(new Error('quota exceeded'));
      await expect(service.save('u1', allConsent(true), 'banner')).rejects.toThrow(
        'quota exceeded'
      );
    });

    it('syncs through gdprService by default', async () => {
      const spy = jest.spyOn(gdprService, 'updateConsent').mockResolvedValue(allConsent(true));
      const service = createConsentService({ storage: memoryStorage() });

      const result = await service.save('u1', allConsent(true), 'banner');

      expect(result.synced).toBe(true);
      expect(spy).toHaveBeenCalledWith(allConsent(true));
      spy.mockRestore();
    });
  });

  describe('retrySync', () => {
    it('returns null when nothing is stored', async () => {
      const { service, transport } = setup();
      await expect(service.retrySync('u1')).resolves.toBeNull();
      expect(transport).not.toHaveBeenCalled();
    });

    it('does not call the backend when nothing is pending', async () => {
      const { service, transport } = setup();
      await service.save('u1', allConsent(true), 'banner');
      transport.mockClear();

      const result = await service.retrySync('u1');

      expect(result?.synced).toBe(true);
      expect(transport).not.toHaveBeenCalled();
    });

    it('clears the queue once the backend accepts it', async () => {
      const { service, storage, transport } = setup();
      transport.mockRejectedValueOnce(new Error('offline'));
      await service.save('u1', allConsent(true), 'banner');

      const result = await service.retrySync('u1');

      expect(result?.synced).toBe(true);
      expect(result?.consent.pendingRecords).toEqual([]);
      expect(stored(storage).pendingRecords).toEqual([]);
    });

    it('keeps the queue when the backend is still unreachable', async () => {
      const { service, transport } = setup();
      transport.mockRejectedValue(new Error('offline'));
      await service.save('u1', allConsent(true), 'banner');

      const result = await service.retrySync('u1');

      expect(result?.synced).toBe(false);
      expect(result?.consent.pendingRecords).toHaveLength(3);
    });
  });

  it('allConsent sets every category', () => {
    expect(allConsent(true)).toEqual({ analytics: true, marketing: true, notifications: true });
    expect(allConsent(false)).toEqual({ analytics: false, marketing: false, notifications: false });
  });
});
