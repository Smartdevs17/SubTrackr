import { ExportService, type ExportRequestSummary } from '../exportService';
import { decryptField, generateKey } from '../encryption';
import { keyManager } from '../keyManager';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete store[key];
    }),
    multiGet: jest.fn(async (keys: string[]) => keys.map((k) => [k, store[k] ?? null])),
    multiSet: jest.fn(async (pairs: [string, string][]) => {
      pairs.forEach(([k, v]) => {
        store[k] = v;
      });
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach((k) => delete store[k]);
    }),
  };
});

describe('ExportService', () => {
  let exportService: ExportService;

  beforeEach(async () => {
    exportService = new ExportService();
    await keyManager.initialize(generateKey());
  });

  it('creates a secure export request with encrypted payload and a time-limited URL', async () => {
    const result = await exportService.requestExport({
      actorId: 'user-1',
      ownerId: 'user-1',
    });

    expect(result.status).toBe('completed');
    expect(result.downloadUrl).toMatch(/https:\/\/api\.subtrackr\.example\.com\/gdpr\/download\/[0-9a-f]{48}/);
    expect(result.encryptedPayload).toBeDefined();
    expect(result.encryptedPayload?.algorithm).toBe('aes-256-gcm');
    expect(result.fieldsIncluded).toContain('profile.email');
  });

  it('rejects export requests from unauthorized actors', async () => {
    await expect(
      exportService.requestExport({
        actorId: 'user-2',
        ownerId: 'user-1',
      })
    ).rejects.toThrow('Unauthorized to request export');
  });

  it('allows admin to request exports for another user', async () => {
    const result = await exportService.requestExport({
      actorId: 'admin',
      ownerId: 'user-1',
    });

    expect(result.status).toBe('completed');
    expect(result.downloadUrl).toContain('/gdpr/download/');
  });

  it('cancels an in-progress export before finalization', async () => {
    const pending = exportService.requestExport({
      actorId: 'user-1',
      ownerId: 'user-1',
      sections: ['subscriptions', 'billingHistory'],
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const requests = Array.from(
      (exportService as unknown as { requests: Map<string, ExportRequestSummary> }).requests.values()
    );
    expect(requests.length).toBeGreaterThan(0);
    const exportId = requests[0].exportId;

    const cancelled = exportService.cancelExport(exportId, 'user-1');
    expect(cancelled).toBe(true);
    await expect(pending).rejects.toThrow('Export request cancelled');
  });

  it('expires download links after the configured TTL', async () => {
    const result = await exportService.requestExport({
      actorId: 'user-1',
      ownerId: 'user-1',
      expiresInMinutes: 0.001,
    });

    const token = result.downloadUrl?.split('/').pop();
    expect(token).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(() => exportService.downloadExport(token as string, 'user-1')).toThrow(
      'Download link has expired'
    );
  });

  it('minimizes exported content when only requested fields are included', async () => {
    const result = await exportService.requestExport({
      actorId: 'user-1',
      ownerId: 'user-1',
      sections: ['profile', 'consentLogs'],
      profileFields: ['email'],
    });

    const encrypted = result.encryptedPayload!;
    const decrypted = decryptField(encrypted, keyManager.getActiveEncryptionKey()!);
    const payload = JSON.parse(decrypted.value);

    expect(payload.profile).toBeDefined();
    expect(payload.profile.email).toBe('user@example.com');
    expect(payload.profile.name).toBeUndefined();
    expect(payload.subscriptions).toBeUndefined();
    expect(payload.billingHistory).toBeUndefined();
  });
});
