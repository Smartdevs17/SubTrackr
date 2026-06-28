import { DisasterRecoveryService, RTO_SECONDS, RPO_SECONDS } from '../DisasterRecoveryService';

// ---------------------------------------------------------------------------
// AsyncStorage mock
// ---------------------------------------------------------------------------

const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
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
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const APP_KEYS = ['subtrackr-subscriptions', 'subtrackr-wallet'];

function seedStorage() {
  store['subtrackr-subscriptions'] = JSON.stringify([{ id: '1', name: 'Netflix' }]);
  store['subtrackr-wallet'] = JSON.stringify({ address: '0xabc' });
}

function clearStore() {
  Object.keys(store).forEach((k) => delete store[k]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DisasterRecoveryService', () => {
  let service: DisasterRecoveryService;

  beforeEach(() => {
    clearStore();
    seedStorage();
    service = new DisasterRecoveryService(APP_KEYS, 3);
  });

  // RTO / RPO targets
  it('defines RTO_SECONDS', () => {
    expect(typeof RTO_SECONDS).toBe('number');
    expect(RTO_SECONDS).toBeGreaterThan(0);
  });

  it('defines RPO_SECONDS', () => {
    expect(typeof RPO_SECONDS).toBe('number');
    expect(RPO_SECONDS).toBeGreaterThan(0);
  });

  // Backup (indexing pipeline)
  it('creates a backup and returns a manifest', async () => {
    const manifest = await service.createBackup();
    expect(manifest.id).toBeTruthy();
    expect(manifest.keys).toEqual(APP_KEYS);
    expect(manifest.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(manifest.version).toBe(1);
  });

  it('lists backups newest first', async () => {
    await service.createBackup();
    await service.createBackup();
    const list = await service.listBackups();
    expect(list.length).toBe(2);
    expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt);
  });

  it('prunes backups beyond retention limit', async () => {
    await service.createBackup();
    await service.createBackup();
    await service.createBackup();
    await service.createBackup(); // 4th — should prune oldest
    const list = await service.listBackups();
    expect(list.length).toBe(3);
  });

  // Backup verification
  it('verifies a valid backup as valid', async () => {
    const manifest = await service.createBackup();
    const result = await service.verifyBackup(manifest.id);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects a missing backup', async () => {
    const result = await service.verifyBackup('nonexistent-id');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not found/i);
  });

  it('detects checksum tampering', async () => {
    const manifest = await service.createBackup();
    const key = `@subtrackr:dr:backup:${manifest.id}`;
    const raw = JSON.parse(store[key]);
    raw.manifest.checksum = 'deadbeef';
    store[key] = JSON.stringify(raw);

    const result = await service.verifyBackup(manifest.id);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Checksum'))).toBe(true);
  });

  // Failover / restore
  it('restores data from a backup', async () => {
    const manifest = await service.createBackup();
    // Corrupt live storage
    store['subtrackr-subscriptions'] = '[]';

    const result = await service.restoreBackup(manifest.id);
    expect(result.success).toBe(true);
    expect(result.restoredKeys).toContain('subtrackr-subscriptions');
    expect(store['subtrackr-subscriptions']).toContain('Netflix');
  });

  it('refuses to restore a tampered backup', async () => {
    const manifest = await service.createBackup();
    const key = `@subtrackr:dr:backup:${manifest.id}`;
    const raw = JSON.parse(store[key]);
    raw.manifest.checksum = '00000000';
    store[key] = JSON.stringify(raw);

    const result = await service.restoreBackup(manifest.id);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes('Checksum'))).toBe(true);
  });

  it('failover restores from most recent valid backup', async () => {
    await service.createBackup();
    store['subtrackr-subscriptions'] = '[]';

    const result = await service.failover();
    expect(result.success).toBe(true);
    expect(store['subtrackr-subscriptions']).toContain('Netflix');
  });

  it('failover returns failure when no backups exist', async () => {
    const result = await service.failover();
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/no valid backup/i);
  });

  // Delete backup
  it('deletes a backup', async () => {
    const manifest = await service.createBackup();
    await service.deleteBackup(manifest.id);
    const list = await service.listBackups();
    expect(list.find((m) => m.id === manifest.id)).toBeUndefined();
  });

  // DR drill (regular testing)
  it('passes a full DR drill', async () => {
    const drill = await service.runDrDrill();
    expect(drill.passed).toBe(true);
    expect(drill.verification.valid).toBe(true);
    expect(drill.recovery.success).toBe(true);
    expect(drill.rtoCompliant).toBe(true);
  });

  it('drill reports RTO compliance', async () => {
    const drill = await service.runDrDrill();
    expect(drill.recovery.durationMs).toBeLessThanOrEqual(RTO_SECONDS * 1000);
  });
});
