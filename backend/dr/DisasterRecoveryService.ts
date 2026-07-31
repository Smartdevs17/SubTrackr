import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// RTO / RPO targets
// ---------------------------------------------------------------------------

export const RTO_SECONDS = 300;
export const RPO_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupManifest {
  id: string;
  createdAt: number;
  keys: string[];
  checksum: string;
  version: number;
  consistencyMarker?: string;
  region?: string;
  contractSnapshotId?: string;
}

export interface BackupEntry {
  manifest: BackupManifest;
  data: Record<string, string | null>;
  contractSnapshot?: Record<string, string>;
  consistencyProof?: ConsistencyProof;
}

export interface VerificationResult {
  valid: boolean;
  manifest: BackupManifest;
  errors: string[];
  warnings?: string[];
}

export interface RecoveryResult {
  success: boolean;
  restoredKeys: string[];
  errors: string[];
  durationMs: number;
  contractRestored?: boolean;
}

export interface ConsistencyProof {
  marker: string;
  versionVector: Record<string, number>;
  timestamp: number;
}

export interface DrDrillResult {
  passed: boolean;
  backupId: string;
  verification: VerificationResult;
  recovery: RecoveryResult;
  rtoCompliant: boolean;
  rpoCompliant: boolean;
}

export interface DrDrillSchedule {
  intervalHours: number;
  lastRunAt: number | null;
  nextRunAt: number;
  enabled: boolean;
}

export interface RtoMonitorEntry {
  timestamp: number;
  operation: string;
  durationMs: number;
  withinRto: boolean;
}

export interface RpoMonitorEntry {
  timestamp: number;
  backupAgeMs: number;
  withinRpo: boolean;
}

export interface DrIncident {
  id: string;
  type: 'data_corruption' | 'backup_failure' | 'restore_failure' | 'rto_breach' | 'rpo_breach' | 'region_failover';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  openedAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

export interface GeoRegionStatus {
  region: string;
  lastBackupAt: number | null;
  backupCount: number;
  healthy: boolean;
  lastDrillPassed: boolean | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKUP_INDEX_KEY = '@subtrackr:dr:index';
const BACKUP_DATA_PREFIX = '@subtrackr:dr:backup:';
const BACKUP_VERSION = 2;
const APP_STORAGE_KEYS = ['subtrackr-subscriptions', 'subtrackr-wallet', 'subtrackr-tx-queue'];
const CONTRACT_STATE_KEYS = ['subtrackr-contract-cache', 'subtrackr-oracle-prices'];
const MAX_BACKUPS = 10;
const INCIDENT_KEY = '@subtrackr:dr:incidents';
const RTO_MONITOR_KEY = '@subtrackr:dr:rto_monitor';
const RPO_MONITOR_KEY = '@subtrackr:dr:rpo_monitor';
const DRILL_SCHEDULE_KEY = '@subtrackr:dr:drill_schedule';
const REGION_STATUS_KEY = '@subtrackr:dr:region_status';

const CURRENT_REGION = 'us-east-1';
const REPLICA_REGIONS = ['eu-west-1', 'ap-southeast-1'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checksum(data: string): string {
  let hash = 5381;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) + hash) ^ data.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function generateConsistencyMarker(): string {
  return `cm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// DisasterRecoveryService
// ---------------------------------------------------------------------------

export class DisasterRecoveryService {
  private readonly appKeys: string[];
  private readonly contractKeys: string[];
  private readonly maxBackups: number;

  constructor(
    appKeys = APP_STORAGE_KEYS,
    contractKeys = CONTRACT_STATE_KEYS,
    maxBackups = MAX_BACKUPS
  ) {
    this.appKeys = appKeys;
    this.contractKeys = contractKeys;
    this.maxBackups = maxBackups;
  }

  // ── Backup ───────────────────────────────────────────────────────────────

  async createBackup(region?: string): Promise<BackupManifest> {
    const allKeys = [...this.appKeys, ...this.contractKeys];
    const pairs = await AsyncStorage.multiGet(allKeys);
    const data: Record<string, string | null> = {};
    for (const [key, value] of pairs) data[key] = value;

    const contractSnapshot: Record<string, string> = {};
    for (const key of this.contractKeys) {
      if (data[key] !== null && data[key] !== undefined) {
        contractSnapshot[key] = data[key]!;
      }
    }

    const consistencyProof: ConsistencyProof = {
      marker: generateConsistencyMarker(),
      versionVector: {},
      timestamp: Date.now(),
    };
    for (const key of allKeys) {
      consistencyProof.versionVector[key] = Date.now();
    }

    const serialised = JSON.stringify(data);
    const effectiveRegion = region || CURRENT_REGION;
    const manifest: BackupManifest = {
      id: generateId(),
      createdAt: Date.now(),
      keys: allKeys,
      checksum: checksum(serialised),
      version: BACKUP_VERSION,
      consistencyMarker: consistencyProof.marker,
      region: effectiveRegion,
      contractSnapshotId: Object.keys(contractSnapshot).length > 0 ? `cs_${generateId()}` : undefined,
    };

    const entry: BackupEntry = { manifest, data, contractSnapshot, consistencyProof };
    await AsyncStorage.setItem(`${BACKUP_DATA_PREFIX}${manifest.id}`, JSON.stringify(entry));

    await this._updateIndex(manifest);

    if (effectiveRegion === CURRENT_REGION) {
      await this._replicateToRegions(manifest, entry);
    }

    await this._recordRpoMonitorEntry(manifest.createdAt);

    return manifest;
  }

  // ── Verification ─────────────────────────────────────────────────────────

  async verifyBackup(backupId: string): Promise<VerificationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const raw = await AsyncStorage.getItem(`${BACKUP_DATA_PREFIX}${backupId}`);

    if (!raw) {
      return {
        valid: false,
        manifest: { id: backupId, createdAt: 0, keys: [], checksum: '', version: 0 },
        errors: ['Backup not found'],
        warnings,
      };
    }

    const entry: BackupEntry = JSON.parse(raw);
    const { manifest, data, contractSnapshot, consistencyProof } = entry;

    const recomputed = checksum(JSON.stringify(data));
    if (recomputed !== manifest.checksum) {
      errors.push(`Checksum mismatch: expected ${manifest.checksum}, got ${recomputed}`);
    }

    if (manifest.version !== BACKUP_VERSION) {
      errors.push(`Version mismatch: expected ${BACKUP_VERSION}, got ${manifest.version}`);
    }

    if (manifest.keys.length === 0) {
      errors.push('Backup contains no keys');
    }

    const ageMs = Date.now() - manifest.createdAt;
    if (ageMs > RPO_SECONDS * 1000) {
      warnings.push(`Backup age ${Math.round(ageMs / 1000)}s exceeds RPO of ${RPO_SECONDS}s`);
    }

    if (this.contractKeys.length > 0 && contractSnapshot) {
      for (const key of this.contractKeys) {
        if (key in data && data[key] !== null && !(key in contractSnapshot)) {
          warnings.push(`Contract key ${key} present in data but missing from contractSnapshot`);
        }
      }
    }

    if (consistencyProof && consistencyProof.marker !== manifest.consistencyMarker) {
      warnings.push('Consistency marker mismatch between proof and manifest');
    }

    return {
      valid: errors.length === 0,
      manifest,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  async verifyCrossServiceConsistency(backupId: string): Promise<{
    consistent: boolean;
    appConsistent: boolean;
    contractConsistent: boolean;
    details: string[];
  }> {
    const details: string[] = [];
    const raw = await AsyncStorage.getItem(`${BACKUP_DATA_PREFIX}${backupId}`);
    if (!raw) {
      return { consistent: false, appConsistent: false, contractConsistent: false, details: ['Backup not found'] };
    }

    const entry: BackupEntry = JSON.parse(raw);
    const { data, contractSnapshot } = entry;

    let appConsistent = true;
    let contractConsistent = true;

    for (const key of this.appKeys) {
      if (!(key in data)) {
        appConsistent = false;
        details.push(`Missing app key: ${key}`);
      }
    }

    if (contractSnapshot && Object.keys(contractSnapshot).length > 0) {
      for (const key of this.contractKeys) {
        const inData = key in data && data[key] !== null;
        const inSnapshot = key in contractSnapshot;
        if (inData !== inSnapshot) {
          contractConsistent = false;
          details.push(`Contract key ${key} presence mismatch: data=${inData}, snapshot=${inSnapshot}`);
        }
      }
    }

    const consistent = appConsistent && contractConsistent;
    return { consistent, appConsistent, contractConsistent, details };
  }

  // ── Contract State Backup & Recovery ─────────────────────────────────────

  async backupContractState(): Promise<{ snapshotId: string; keys: string[] }> {
    const pairs = await AsyncStorage.multiGet(this.contractKeys);
    const snapshot: Record<string, string> = {};
    for (const [key, value] of pairs) {
      if (value !== null) snapshot[key] = value;
    }
    const snapshotId = `cs_${generateId()}`;
    await AsyncStorage.setItem(
      `${BACKUP_DATA_PREFIX}contract:${snapshotId}`,
      JSON.stringify(snapshot)
    );
    return { snapshotId, keys: this.contractKeys };
  }

  async restoreContractState(snapshotId?: string): Promise<RecoveryResult> {
    const start = Date.now();
    const errors: string[] = [];

    let snapshot: Record<string, string>;
    if (snapshotId) {
      const raw = await AsyncStorage.getItem(`${BACKUP_DATA_PREFIX}contract:${snapshotId}`);
      if (!raw) {
        return { success: false, restoredKeys: [], errors: ['Contract snapshot not found'], durationMs: Date.now() - start };
      }
      snapshot = JSON.parse(raw);
    } else {
      const backups = await this.listBackups();
      for (const manifest of backups) {
        const raw = await AsyncStorage.getItem(`${BACKUP_DATA_PREFIX}${manifest.id}`);
        if (!raw) continue;
        const entry: BackupEntry = JSON.parse(raw);
        if (entry.contractSnapshot && Object.keys(entry.contractSnapshot).length > 0) {
          snapshot = entry.contractSnapshot;
          const restoredKeys = Object.keys(snapshot);
          const pairs: [string, string][] = restoredKeys.map((k) => [k, snapshot[k]]);
          if (pairs.length > 0) await AsyncStorage.multiSet(pairs);
          return { success: true, restoredKeys, errors: [], durationMs: Date.now() - start, contractRestored: true };
        }
      }
      return { success: false, restoredKeys: [], errors: ['No contract snapshot found in any backup'], durationMs: Date.now() - start };
    }

    const restoredKeys = Object.keys(snapshot);
    if (restoredKeys.length > 0) {
      const pairs: [string, string][] = restoredKeys.map((k) => [k, snapshot[k]]);
      await AsyncStorage.multiSet(pairs);
    }

    return { success: true, restoredKeys, errors, durationMs: Date.now() - start, contractRestored: true };
  }

  // ── Failover / Restore ───────────────────────────────────────────────────

  async restoreBackup(backupId: string): Promise<RecoveryResult> {
    const start = Date.now();
    const errors: string[] = [];

    const verification = await this.verifyBackup(backupId);
    const hardErrors = verification.errors.filter((e) => !e.startsWith('Backup age'));
    if (hardErrors.length > 0) {
      await this._openIncident({ type: 'backup_failure', severity: 'critical', message: `Backup ${backupId} failed verification: ${hardErrors.join(', ')}` });
      return { success: false, restoredKeys: [], errors: hardErrors, durationMs: Date.now() - start };
    }

    const raw = await AsyncStorage.getItem(`${BACKUP_DATA_PREFIX}${backupId}`);
    if (!raw) {
      await this._openIncident({ type: 'backup_failure', severity: 'critical', message: `Backup data missing for ${backupId}` });
      return { success: false, restoredKeys: [], errors: ['Backup data missing'], durationMs: Date.now() - start };
    }

    const { data, contractSnapshot }: BackupEntry = JSON.parse(raw);
    const pairs: [string, string][] = [];
    const nullKeys: string[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (value !== null) pairs.push([key, value]);
      else nullKeys.push(key);
    }

    if (pairs.length > 0) await AsyncStorage.multiSet(pairs);
    if (nullKeys.length > 0) await AsyncStorage.multiRemove(nullKeys);

    let contractRestored = false;
    if (contractSnapshot && Object.keys(contractSnapshot).length > 0) {
      const contractPairs: [string, string][] = Object.entries(contractSnapshot);
      if (contractPairs.length > 0) {
        await AsyncStorage.multiSet(contractPairs);
        contractRestored = true;
      }
    }

    const durationMs = Date.now() - start;
    await this._recordRtoMonitorEntry('restore', durationMs);

    return {
      success: true,
      restoredKeys: Object.keys(data),
      errors,
      durationMs,
      contractRestored,
    };
  }

  async failover(region?: string): Promise<RecoveryResult> {
    const index = await this.listBackups(region);
    for (const manifest of index) {
      if (region && manifest.region !== region) continue;
      const result = await this.restoreBackup(manifest.id);
      if (result.success) return result;
    }
    return { success: false, restoredKeys: [], errors: ['No valid backup found for failover'], durationMs: 0 };
  }

  // ── Index Management ─────────────────────────────────────────────────────

  async listBackups(region?: string): Promise<BackupManifest[]> {
    const raw = await AsyncStorage.getItem(BACKUP_INDEX_KEY);
    if (!raw) return [];
    let manifests = JSON.parse(raw) as BackupManifest[];
    if (region) manifests = manifests.filter((m) => m.region === region);
    return manifests.sort((a, b) => b.createdAt - a.createdAt);
  }

  async deleteBackup(backupId: string): Promise<void> {
    await AsyncStorage.removeItem(`${BACKUP_DATA_PREFIX}${backupId}`);
    const index = await this.listBackups();
    const updated = index.filter((m) => m.id !== backupId);
    await AsyncStorage.setItem(BACKUP_INDEX_KEY, JSON.stringify(updated));
  }

  async pruneOldBackups(): Promise<string[]> {
    const index = await this.listBackups();
    const toDelete = index.slice(this.maxBackups);
    for (const manifest of toDelete) await this.deleteBackup(manifest.id);
    return toDelete.map((m) => m.id);
  }

  // ── Geographic Redundancy ────────────────────────────────────────────────

  private async _replicateToRegions(manifest: BackupManifest, entry: BackupEntry): Promise<void> {
    for (const region of REPLICA_REGIONS) {
      const replicaManifest = { ...manifest, region, id: `${manifest.id}_${region}` };
      const replicaEntry = { ...entry, manifest: replicaManifest };
      await AsyncStorage.setItem(
        `${BACKUP_DATA_PREFIX}${replicaManifest.id}`,
        JSON.stringify(replicaEntry)
      );
      await this._updateReplicaIndex(replicaManifest);
      await this._updateIndex(replicaManifest);
      await this._updateRegionStatus(region, replicaManifest.createdAt);
    }
  }

  private async _updateReplicaIndex(manifest: BackupManifest): Promise<void> {
    const key = `${BACKUP_INDEX_KEY}:${manifest.region}`;
    const raw = await AsyncStorage.getItem(key);
    const index: BackupManifest[] = raw ? JSON.parse(raw) : [];
    index.unshift(manifest);
    const trimmed = index.slice(0, this.maxBackups);
    await AsyncStorage.setItem(key, JSON.stringify(trimmed));
  }

  async getRegionStatus(): Promise<GeoRegionStatus[]> {
    const regions = [CURRENT_REGION, ...REPLICA_REGIONS];
    const statuses: GeoRegionStatus[] = [];

    for (const region of regions) {
      const raw = await AsyncStorage.getItem(`${REGION_STATUS_KEY}:${region}`);
      const data = raw ? JSON.parse(raw) : null;
      const backups = await this.listBackups(region);

      statuses.push({
        region,
        lastBackupAt: data?.lastBackupAt ?? null,
        backupCount: backups.length,
        healthy: true,
        lastDrillPassed: data?.lastDrillPassed ?? null,
      });
    }

    return statuses;
  }

  async replicateBackupsToRegion(region: string): Promise<number> {
    const localBackups = await this.listBackups(CURRENT_REGION);
    let replicated = 0;
    for (const manifest of localBackups) {
      const raw = await AsyncStorage.getItem(`${BACKUP_DATA_PREFIX}${manifest.id}`);
      if (!raw) continue;
      const entry: BackupEntry = JSON.parse(raw);
      const replicaManifest = { ...manifest, region, id: `${manifest.id}_${region}` };
      const replicaEntry = { ...entry, manifest: replicaManifest };
      await AsyncStorage.setItem(
        `${BACKUP_DATA_PREFIX}${replicaManifest.id}`,
        JSON.stringify(replicaEntry)
      );
      await this._updateReplicaIndex(replicaManifest);
      await this._updateIndex(replicaManifest);
      replicated++;
    }
    await this._updateRegionStatus(region, Date.now());
    return replicated;
  }

  async checkRegionHealth(region: string): Promise<{ healthy: boolean; issues: string[] }> {
    const issues: string[] = [];
    const backups = await this.listBackups(region);

    if (backups.length === 0) {
      issues.push(`No backups found in region ${region}`);
      return { healthy: false, issues };
    }

    const newest = backups[0];
    const ageMs = Date.now() - newest.createdAt;
    if (ageMs > RPO_SECONDS * 1000 * 2) {
      issues.push(`Newest backup in ${region} is ${Math.round(ageMs / 1000)}s old (2x RPO threshold)`);
    }

    const verified = await this.verifyBackup(newest.id);
    if (!verified.valid) {
      issues.push(`Newest backup in ${region} failed verification: ${verified.errors.join(', ')}`);
    }

    return { healthy: issues.length === 0, issues };
  }

  // ── RTO/RPO Monitoring ───────────────────────────────────────────────────

  private async _recordRtoMonitorEntry(operation: string, durationMs: number): Promise<void> {
    const entry: RtoMonitorEntry = {
      timestamp: Date.now(),
      operation,
      durationMs,
      withinRto: durationMs <= RTO_SECONDS * 1000,
    };

    const raw = await AsyncStorage.getItem(RTO_MONITOR_KEY);
    const entries: RtoMonitorEntry[] = raw ? JSON.parse(raw) : [];
    entries.push(entry);
    await AsyncStorage.setItem(RTO_MONITOR_KEY, JSON.stringify(entries.slice(-100)));

    if (!entry.withinRto) {
      await this._openIncident({
        type: 'rto_breach',
        severity: 'critical',
        message: `RTO breach: ${operation} took ${durationMs}ms (limit ${RTO_SECONDS * 1000}ms)`,
      });
    }
  }

  private async _recordRpoMonitorEntry(backupCreatedAt: number): Promise<void> {
    const ageMs = Date.now() - backupCreatedAt;
    const entry: RpoMonitorEntry = {
      timestamp: Date.now(),
      backupAgeMs: ageMs,
      withinRpo: ageMs <= RPO_SECONDS * 1000,
    };

    const raw = await AsyncStorage.getItem(RPO_MONITOR_KEY);
    const entries: RpoMonitorEntry[] = raw ? JSON.parse(raw) : [];
    entries.push(entry);
    await AsyncStorage.setItem(RPO_MONITOR_KEY, JSON.stringify(entries.slice(-100)));

    if (!entry.withinRpo) {
      await this._openIncident({
        type: 'rpo_breach',
        severity: 'warning',
        message: `RPO breach: backup age ${Math.round(ageMs / 1000)}s exceeds limit ${RPO_SECONDS}s`,
      });
    }
  }

  async getRtoMonitorReport(): Promise<{
    entries: RtoMonitorEntry[];
    breachRate: number;
    averageDurationMs: number;
    last24hCount: number;
  }> {
    const raw = await AsyncStorage.getItem(RTO_MONITOR_KEY);
    const entries: RtoMonitorEntry[] = raw ? JSON.parse(raw) : [];
    const total = entries.length;
    const breaches = entries.filter((e) => !e.withinRto).length;
    const avgDuration = total > 0 ? entries.reduce((s, e) => s + e.durationMs, 0) / total : 0;
    const last24h = entries.filter((e) => e.timestamp > Date.now() - 86_400_000).length;

    return {
      entries,
      breachRate: total > 0 ? breaches / total : 0,
      averageDurationMs: Math.round(avgDuration),
      last24hCount: last24h,
    };
  }

  async getRpoMonitorReport(): Promise<{
    entries: RpoMonitorEntry[];
    breachRate: number;
    averageAgeMs: number;
    last24hCount: number;
  }> {
    const raw = await AsyncStorage.getItem(RPO_MONITOR_KEY);
    const entries: RpoMonitorEntry[] = raw ? JSON.parse(raw) : [];
    const total = entries.length;
    const breaches = entries.filter((e) => !e.withinRpo).length;
    const avgAge = total > 0 ? entries.reduce((s, e) => s + e.backupAgeMs, 0) / total : 0;
    const last24h = entries.filter((e) => e.timestamp > Date.now() - 86_400_000).length;

    return {
      entries,
      breachRate: total > 0 ? breaches / total : 0,
      averageAgeMs: Math.round(avgAge),
      last24hCount: last24h,
    };
  }

  // ── Incident Management ──────────────────────────────────────────────────

  private async _openIncident(input: Omit<DrIncident, 'id' | 'openedAt'>): Promise<DrIncident> {
    const raw = await AsyncStorage.getItem(INCIDENT_KEY);
    const incidents: DrIncident[] = raw ? JSON.parse(raw) : [];

    const existing = incidents.find((i) => i.type === input.type && !i.resolvedAt);
    if (existing) return existing;

    const incident: DrIncident = {
      ...input,
      id: generateId(),
      openedAt: Date.now(),
    };
    incidents.push(incident);
    await AsyncStorage.setItem(INCIDENT_KEY, JSON.stringify(incidents.slice(-50)));
    return incident;
  }

  async resolveIncident(incidentId: string, resolvedBy?: string): Promise<boolean> {
    const raw = await AsyncStorage.getItem(INCIDENT_KEY);
    const incidents: DrIncident[] = raw ? JSON.parse(raw) : [];
    const idx = incidents.findIndex((i) => i.id === incidentId);
    if (idx === -1) return false;
    incidents[idx].resolvedAt = Date.now();
    incidents[idx].resolvedBy = resolvedBy || 'system';
    await AsyncStorage.setItem(INCIDENT_KEY, JSON.stringify(incidents));
    return true;
  }

  async getActiveIncidents(): Promise<DrIncident[]> {
    const raw = await AsyncStorage.getItem(INCIDENT_KEY);
    const incidents: DrIncident[] = raw ? JSON.parse(raw) : [];
    return incidents.filter((i) => !i.resolvedAt).sort((a, b) => b.openedAt - a.openedAt);
  }

  async getIncidentHistory(limit = 50): Promise<DrIncident[]> {
    const raw = await AsyncStorage.getItem(INCIDENT_KEY);
    const incidents: DrIncident[] = raw ? JSON.parse(raw) : [];
    return incidents.sort((a, b) => b.openedAt - a.openedAt).slice(0, limit);
  }

  // ── DR Drill Scheduler ───────────────────────────────────────────────────

  async getDrillSchedule(): Promise<DrDrillSchedule | null> {
    const raw = await AsyncStorage.getItem(DRILL_SCHEDULE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  async setDrillSchedule(intervalHours: number, enabled = true): Promise<DrDrillSchedule> {
    const schedule: DrDrillSchedule = {
      intervalHours,
      lastRunAt: null,
      nextRunAt: Date.now() + intervalHours * 3_600_000,
      enabled,
    };
    await AsyncStorage.setItem(DRILL_SCHEDULE_KEY, JSON.stringify(schedule));
    return schedule;
  }

  async checkDrillDue(): Promise<boolean> {
    const schedule = await this.getDrillSchedule();
    if (!schedule || !schedule.enabled) return false;
    return Date.now() >= schedule.nextRunAt;
  }

  async runScheduledDrill(): Promise<DrDrillResult> {
    const result = await this.runDrDrill();
    const schedule = await this.getDrillSchedule();
    if (schedule) {
      schedule.lastRunAt = Date.now();
      schedule.nextRunAt = Date.now() + schedule.intervalHours * 3_600_000;
      await AsyncStorage.setItem(DRILL_SCHEDULE_KEY, JSON.stringify(schedule));
    }
    return result;
  }

  // ── DR Drill ─────────────────────────────────────────────────────────────

  async runDrDrill(): Promise<DrDrillResult> {
    const manifest = await this.createBackup();
    const verification = await this.verifyBackup(manifest.id);
    const recovery = await this.restoreBackup(manifest.id);
    const rtoCompliant = recovery.durationMs <= RTO_SECONDS * 1000;

    const ageMs = Date.now() - manifest.createdAt;
    const rpoCompliant = ageMs <= RPO_SECONDS * 1000;

    await this._updateRegionStatus(CURRENT_REGION, manifest.createdAt, verification.valid && recovery.success);

    return {
      passed: verification.valid && recovery.success && rtoCompliant,
      backupId: manifest.id,
      verification,
      recovery,
      rtoCompliant,
      rpoCompliant,
    };
  }

  // ── Active Incident DR ───────────────────────────────────────────────────

  async performDrDuringActiveIncident(): Promise<{
    success: boolean;
    steps: { step: string; status: 'ok' | 'skipped' | 'failed'; detail?: string }[];
  }> {
    const steps: { step: string; status: 'ok' | 'skipped' | 'failed'; detail?: string }[] = [];
    let success = true;

    const activeIncidents = await this.getActiveIncidents();
    if (activeIncidents.length === 0) {
      steps.push({ step: 'assess_incidents', status: 'skipped', detail: 'No active incidents' });
    } else {
      const critical = activeIncidents.filter((i) => i.severity === 'critical');
      for (const inc of critical) {
        if (inc.type === 'data_corruption' || inc.type === 'backup_failure') {
          const failoverResult = await this.failover();
          if (failoverResult.success) {
            steps.push({ step: `failover_${inc.id}`, status: 'ok', detail: `Restored from backup: ${failoverResult.restoredKeys.join(', ')}` });
            await this.resolveIncident(inc.id, 'dr_automation');
          } else {
            steps.push({ step: `failover_${inc.id}`, status: 'failed', detail: failoverResult.errors.join(', ') });
            success = false;
          }
        } else if (inc.type === 'region_failover') {
          for (const replica of REPLICA_REGIONS) {
            const health = await this.checkRegionHealth(replica);
            if (health.healthy) {
              const result = await this.failover(replica);
              steps.push({ step: `region_failover_${replica}`, status: result.success ? 'ok' : 'failed', detail: result.success ? 'Region failover completed' : result.errors.join(', ') });
              if (!result.success) success = false;
              break;
            }
          }
        }
      }
    }

    if (success) {
      steps.push({ step: 'create_post_recovery_backup', status: 'ok' });
      await this.createBackup();
    }

    return { success, steps };
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async _updateIndex(manifest: BackupManifest): Promise<void> {
    const index = await this.listBackups();
    index.unshift(manifest);
    await AsyncStorage.setItem(BACKUP_INDEX_KEY, JSON.stringify(index));
    await this.pruneOldBackups();
  }

  private async _updateRegionStatus(
    region: string,
    lastBackupAt: number,
    lastDrillPassed?: boolean
  ): Promise<void> {
    const key = `${REGION_STATUS_KEY}:${region}`;
    const raw = await AsyncStorage.getItem(key);
    const status = raw ? JSON.parse(raw) : {};
    status.lastBackupAt = lastBackupAt;
    if (lastDrillPassed !== undefined) status.lastDrillPassed = lastDrillPassed;
    await AsyncStorage.setItem(key, JSON.stringify(status));
  }
}

export const disasterRecoveryService = new DisasterRecoveryService();
