import { DisasterRecoveryService, RTO_SECONDS, RPO_SECONDS } from '../DisasterRecoveryService';

const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => store[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
  removeItem: jest.fn(async (key: string) => { delete store[key]; }),
  multiGet: jest.fn(async (keys: string[]) => keys.map((k) => [k, store[k] ?? null])),
  multiSet: jest.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => { store[k] = v; }); }),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((k) => delete store[k]); }),
}));

const APP_KEYS = ['subtrackr-subscriptions', 'subtrackr-wallet'];

function seedStorage() {
  store['subtrackr-subscriptions'] = JSON.stringify([{ id: '1', name: 'Netflix' }]);
  store['subtrackr-wallet'] = JSON.stringify({ address: '0xabc' });
  store['subtrackr-contract-cache'] = JSON.stringify({ poolId: 'pool_1', balance: '1000' });
  store['subtrackr-oracle-prices'] = JSON.stringify({ BTC: 67000, ETH: 3400 });
}

function clearStore() {
  Object.keys(store).forEach((k) => delete store[k]);
}

describe('DisasterRecoveryService', () => {
  let service: DisasterRecoveryService;

  beforeEach(() => {
    clearStore();
    seedStorage();
    service = new DisasterRecoveryService(APP_KEYS, ['subtrackr-contract-cache', 'subtrackr-oracle-prices'], 5);
  });

  it('defines RTO_SECONDS', () => {
    expect(typeof RTO_SECONDS).toBe('number');
    expect(RTO_SECONDS).toBeGreaterThan(0);
  });

  it('defines RPO_SECONDS', () => {
    expect(typeof RPO_SECONDS).toBe('number');
    expect(RPO_SECONDS).toBeGreaterThan(0);
  });

  describe('backup', () => {
    it('creates a backup and returns a manifest', async () => {
      const manifest = await service.createBackup();
      expect(manifest.id).toBeTruthy();
      expect(manifest.keys).toContain('subtrackr-subscriptions');
      expect(manifest.keys).toContain('subtrackr-contract-cache');
      expect(manifest.checksum).toMatch(/^[0-9a-f]{8}$/);
      expect(manifest.version).toBe(2);
      expect(manifest.region).toBe('us-east-1');
      expect(manifest.consistencyMarker).toBeTruthy();
    });

    it('lists backups newest first', async () => {
      await service.createBackup('us-east-1');
      const list = await service.listBackups();
      expect(list.length).toBe(3);
      expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt);
    });

    it('deduplicates backup IDs across regions', async () => {
      await service.createBackup('eu-west-1');
      const list = await service.listBackups();
      const ids = list.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('prunes backups beyond retention limit', async () => {
      for (let i = 0; i < 3; i++) await service.createBackup('eu-west-1');
      const list = await service.listBackups();
      const uniqueIds = new Set(list.map((m) => m.id));
      expect(list.length).toBe(3);
      expect(uniqueIds.size).toBe(3);
    });

    it('filters backups by region', async () => {
      await service.createBackup();
      const us = await service.listBackups('us-east-1');
      const eu = await service.listBackups('eu-west-1');
      expect(us.length).toBe(1);
      expect(eu.length).toBe(1);
    });
  });

  describe('backup verification', () => {
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

    it('warns on RPO-exceeded backups', async () => {
      jest.useFakeTimers({ now: 1_000_000_000 });
      const manifest = await service.createBackup();
      jest.setSystemTime(1_000_000_000 + RPO_SECONDS * 1000 + 1);
      const result = await service.verifyBackup(manifest.id);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.includes('RPO'))).toBe(true);
      jest.useRealTimers();
    });
  });

  describe('cross-service consistency', () => {
    it('reports consistent when all services match', async () => {
      const manifest = await service.createBackup();
      const result = await service.verifyCrossServiceConsistency(manifest.id);
      expect(result.consistent).toBe(true);
      expect(result.appConsistent).toBe(true);
      expect(result.contractConsistent).toBe(true);
    });

    it('reports inconsistent when app keys missing', async () => {
      const manifest = await service.createBackup();
      const key = `@subtrackr:dr:backup:${manifest.id}`;
      const raw = JSON.parse(store[key]);
      delete raw.data['subtrackr-subscriptions'];
      store[key] = JSON.stringify(raw);
      const result = await service.verifyCrossServiceConsistency(manifest.id);
      expect(result.appConsistent).toBe(false);
      expect(result.consistent).toBe(false);
    });
  });

  describe('contract state backup and recovery', () => {
    it('backups contract state separately', async () => {
      const result = await service.backupContractState();
      expect(result.snapshotId).toMatch(/^cs_/);
      expect(result.keys).toContain('subtrackr-contract-cache');
    });

    it('restores contract state from latest backup', async () => {
      await service.createBackup();
      store['subtrackr-contract-cache'] = JSON.stringify({ corrupted: true });
      const result = await service.restoreContractState();
      expect(result.success).toBe(true);
      expect(result.contractRestored).toBe(true);
      expect(store['subtrackr-contract-cache']).toContain('pool_1');
    });
  });

  describe('restore and failover', () => {
    it('restores data from a backup', async () => {
      const manifest = await service.createBackup();
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

    it('restores contract state alongside app state', async () => {
      const manifest = await service.createBackup();
      store['subtrackr-subscriptions'] = '[]';
      store['subtrackr-contract-cache'] = '{}';
      const result = await service.restoreBackup(manifest.id);
      expect(result.success).toBe(true);
      expect(result.contractRestored).toBe(true);
      expect(store['subtrackr-contract-cache']).toContain('pool_1');
    });

    it('failover restores from most recent valid backup', async () => {
      await service.createBackup();
      store['subtrackr-subscriptions'] = '[]';
      const result = await service.failover();
      expect(result.success).toBe(true);
      expect(store['subtrackr-subscriptions']).toContain('Netflix');
    });

    it('failover by region works', async () => {
      await service.createBackup('eu-west-1');
      store['subtrackr-subscriptions'] = '[]';
      const result = await service.failover('eu-west-1');
      expect(result.success).toBe(true);
      expect(store['subtrackr-subscriptions']).toContain('Netflix');
    });

    it('failover returns failure when no backups exist', async () => {
      clearStore();
      const result = await service.failover();
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/no valid backup/i);
    });

    it('deletes a backup', async () => {
      const manifest = await service.createBackup();
      await service.deleteBackup(manifest.id);
      const list = await service.listBackups();
      expect(list.find((m) => m.id === manifest.id)).toBeUndefined();
    });
  });

  describe('geographic redundancy', () => {
    it('replicates backups to replica regions on create', async () => {
      await service.createBackup();
      const euBackups = await service.listBackups('eu-west-1');
      const apBackups = await service.listBackups('ap-southeast-1');
      expect(euBackups.length).toBe(1);
      expect(apBackups.length).toBe(1);
    });

    it('reports region status', async () => {
      await service.createBackup();
      const statuses = await service.getRegionStatus();
      expect(statuses.length).toBeGreaterThanOrEqual(3);
      const primary = statuses.find((s) => s.region === 'us-east-1');
      expect(primary).toBeDefined();
      expect(primary!.backupCount).toBeGreaterThan(0);
    });

    it('checks region health', async () => {
      const health = await service.checkRegionHealth('nonexistent-region');
      expect(health.healthy).toBe(false);
      expect(health.issues.length).toBeGreaterThan(0);
    });

    it('replicates existing backups to a new region', async () => {
      await service.createBackup();
      const count = await service.replicateBackupsToRegion('ap-northeast-1');
      expect(count).toBeGreaterThan(0);
      const backups = await service.listBackups('ap-northeast-1');
      expect(backups.length).toBe(count);
    });
  });

  describe('RTO/RPO monitoring', () => {
    it('records RTO monitor entries on restore', async () => {
      const manifest = await service.createBackup();
      await service.restoreBackup(manifest.id);
      const report = await service.getRtoMonitorReport();
      expect(report.entries.length).toBeGreaterThan(0);
      expect(report.last24hCount).toBeGreaterThan(0);
    });

    it('records RPO monitor entries on backup', async () => {
      await service.createBackup();
      const report = await service.getRpoMonitorReport();
      expect(report.entries.length).toBeGreaterThan(0);
    });
  });

  describe('incident management', () => {
    it('tracks active incidents', async () => {
      const manifest = await service.createBackup();
      const key = `@subtrackr:dr:backup:${manifest.id}`;
      const raw = JSON.parse(store[key]);
      raw.manifest.checksum = 'bad';
      store[key] = JSON.stringify(raw);
      const result = await service.restoreBackup(manifest.id);
      expect(result.success).toBe(false);
      const active = await service.getActiveIncidents();
      expect(active.length).toBeGreaterThan(0);
    });

    it('resolves an incident', async () => {
      await service.createBackup();
      const active = await service.getActiveIncidents();
      if (active.length > 0) {
        const resolved = await service.resolveIncident(active[0].id, 'test');
        expect(resolved).toBe(true);
      }
    });

    it('returns incident history', async () => {
      const history = await service.getIncidentHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('DR drill scheduler', () => {
    it('sets and retrieves drill schedule', async () => {
      await service.setDrillSchedule(24, true);
      const schedule = await service.getDrillSchedule();
      expect(schedule).toBeDefined();
      expect(schedule!.intervalHours).toBe(24);
      expect(schedule!.enabled).toBe(true);
    });

    it('checks if drill is due', async () => {
      await service.setDrillSchedule(0, true);
      const due = await service.checkDrillDue();
      expect(due).toBe(true);
    });

    it('runs scheduled drill and updates schedule', async () => {
      await service.setDrillSchedule(24, true);
      const result = await service.runScheduledDrill();
      expect(result.passed).toBe(true);
      expect(result.rtoCompliant).toBe(true);
      expect(result.rpoCompliant).toBe(true);

      const schedule = await service.getDrillSchedule();
      expect(schedule!.lastRunAt).toBeGreaterThan(0);
    });
  });

  describe('DR drill', () => {
    it('passes a full DR drill with RTO/RPO compliance', async () => {
      const drill = await service.runDrDrill();
      expect(drill.passed).toBe(true);
      expect(drill.verification.valid).toBe(true);
      expect(drill.recovery.success).toBe(true);
      expect(drill.rtoCompliant).toBe(true);
      expect(drill.rpoCompliant).toBe(true);
    });

    it('drill reports RTO compliance', async () => {
      const drill = await service.runDrDrill();
      expect(drill.recovery.durationMs).toBeLessThanOrEqual(RTO_SECONDS * 1000);
    });
  });

  describe('DR during active incident', () => {
    it('performs DR steps during active incident', async () => {
      const result = await service.performDrDuringActiveIncident();
      expect(result.success).toBe(true);
      expect(result.steps.length).toBeGreaterThan(0);
    });

    it('handles data corruption incident with failover', async () => {
      await service.createBackup();
      const active = await service.getActiveIncidents();
      store['subtrackr-subscriptions'] = '[]';
      const result = await service.performDrDuringActiveIncident();
      expect(result.success).toBe(true);
    });
  });
});
