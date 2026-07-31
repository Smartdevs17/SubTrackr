import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// RTO / RPO targets (acceptance criterion 1)
// ---------------------------------------------------------------------------

/** Recovery Time Objective: maximum tolerable downtime (seconds) */
export const RTO_SECONDS = 300; // 5 minutes

/** Recovery Point Objective: maximum tolerable data loss window (seconds) */
export const RPO_SECONDS = 3600; // 1 hour

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupManifest {
  id: string;
  createdAt: number; // Unix ms
  keys: string[];
  checksum: string;
  version: number;
}

export interface BackupEntry {
  manifest: BackupManifest;
  data: Record<string, string | null>;
}

export interface VerificationResult {
  valid: boolean;
  manifest: BackupManifest;
  errors: string[];
}

export interface RecoveryResult {
  success: boolean;
  restoredKeys: string[];
  errors: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKUP_INDEX_KEY = '@subtrackr:dr:index';
const BACKUP_DATA_PREFIX = '@subtrackr:dr:backup:';
const BACKUP_VERSION = 1;
/** Keys that are part of the application state and must be backed up */
const APP_STORAGE_KEYS = ['subtrackr-subscriptions', 'subtrackr-wallet', 'subtrackr-tx-queue'];
/** Maximum number of backups to retain */
const MAX_BACKUPS = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic checksum: djb2 over the serialised data */
function checksum(data: string): string {
  let hash = 5381;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) + hash) ^ data.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16).padStart(8, '0');
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// DisasterRecoveryService
// ---------------------------------------------------------------------------

export class DisasterRecoveryService {
  private readonly appKeys: string[];
  private readonly maxBackups: number;

  constructor(appKeys = APP_STORAGE_KEYS, maxBackups = MAX_BACKUPS) {
    this.appKeys = appKeys;
    this.maxBackups = maxBackups;
  }

  // ── Backup ───────────────────────────────────────────────────────────────

  /** Create a snapshot of all app storage keys (indexing pipeline) */
  async createBackup(): Promise<BackupManifest> {
    const pairs = await AsyncStorage.multiGet(this.appKeys);
    const data: Record<string, string | null> = {};
    for (const [key, value] of pairs) data[key] = value;

    const serialised = JSON.stringify(data);
    const manifest: BackupManifest = {
      id: generateId(),
      createdAt: Date.now(),
      keys: this.appKeys,
      checksum: checksum(serialised),
      version: BACKUP_VERSION,
    };

    const entry: BackupEntry = { manifest, data };
    await AsyncStorage.setItem(`${BACKUP_DATA_PREFIX}${manifest.id}`, JSON.stringify(entry));

    await this._updateIndex(manifest);
    return manifest;
  }

  // ── Verification ─────────────────────────────────────────────────────────

  /** Verify a backup's integrity by re-computing its checksum */
  async verifyBackup(backupId: string): Promise<VerificationResult> {
    const errors: string[] = [];
    const raw = await AsyncStorage.getItem(`${BACKUP_DATA_PREFIX}${backupId}`);

    if (!raw) {
      const stub: BackupManifest = {
        id: backupId,
        createdAt: 0,
        keys: [],
        checksum: '',
        version: 0,
      };
      return { valid: false, manifest: stub, errors: ['Backup not found'] };
    }

    const entry: BackupEntry = JSON.parse(raw);
    const { manifest, data } = entry;

    const recomputed = checksum(JSON.stringify(data));
    if (recomputed !== manifest.checksum) {
      errors.push(`Checksum mismatch: expected ${manifest.checksum}, got ${recomputed}`);
    }

    if (manifest.version !== BACKUP_VERSION) {
      errors.push(`Version mismatch: expected ${BACKUP_VERSION}, got ${manifest.version}`);
    }

    const ageMs = Date.now() - manifest.createdAt;
    if (ageMs > RPO_SECONDS * 1000) {
      errors.push(`Backup age ${Math.round(ageMs / 1000)}s exceeds RPO of ${RPO_SECONDS}s`);
    }

    return { valid: errors.length === 0, manifest, errors };
  }

  // ── Failover / Restore ───────────────────────────────────────────────────

  /**
   * Restore from a specific backup (failover procedure).
   * Verifies integrity before writing to storage.
   */
  async restoreBackup(backupId: string): Promise<RecoveryResult> {
    const start = Date.now();
    const errors: string[] = [];

    const verification = await this.verifyBackup(backupId);
    // Allow restore even if RPO warning fires; block on checksum/version errors
    const hardErrors = verification.errors.filter((e) => !e.startsWith('Backup age'));
    if (hardErrors.length > 0) {
      return {
        success: false,
        restoredKeys: [],
        errors: hardErrors,
        durationMs: Date.now() - start,
      };
    }

    const raw = await AsyncStorage.getItem(`${BACKUP_DATA_PREFIX}${backupId}`);
    if (!raw) {
      return {
        success: false,
        restoredKeys: [],
        errors: ['Backup data missing'],
        durationMs: Date.now() - start,
      };
    }

    const { data }: BackupEntry = JSON.parse(raw);
    const pairs: [string, string][] = [];
    const nullKeys: string[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (value !== null) pairs.push([key, value]);
      else nullKeys.push(key);
    }

    if (pairs.length > 0) await AsyncStorage.multiSet(pairs);
    if (nullKeys.length > 0) await AsyncStorage.multiRemove(nullKeys);

    return {
      success: true,
      restoredKeys: Object.keys(data),
      errors,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Failover: restore from the most recent valid backup automatically.
   * Implements the failover procedure acceptance criterion.
   */
  async failover(): Promise<RecoveryResult> {
    const index = await this.listBackups();
    for (const manifest of index) {
      const result = await this.restoreBackup(manifest.id);
      if (result.success) return result;
    }
    return {
      success: false,
      restoredKeys: [],
      errors: ['No valid backup found for failover'],
      durationMs: 0,
    };
  }

  // ── Index management ─────────────────────────────────────────────────────

  /** Returns all backup manifests, newest first */
  async listBackups(): Promise<BackupManifest[]> {
    const raw = await AsyncStorage.getItem(BACKUP_INDEX_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as BackupManifest[]).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Delete a specific backup */
  async deleteBackup(backupId: string): Promise<void> {
    await AsyncStorage.removeItem(`${BACKUP_DATA_PREFIX}${backupId}`);
    const index = await this.listBackups();
    const updated = index.filter((m) => m.id !== backupId);
    await AsyncStorage.setItem(BACKUP_INDEX_KEY, JSON.stringify(updated));
  }

  /** Prune old backups beyond the retention limit */
  async pruneOldBackups(): Promise<string[]> {
    const index = await this.listBackups();
    const toDelete = index.slice(this.maxBackups);
    for (const manifest of toDelete) await this.deleteBackup(manifest.id);
    return toDelete.map((m) => m.id);
  }

  // ── DR drill ─────────────────────────────────────────────────────────────

  /**
   * Run a full DR drill: backup → verify → restore → measure RTO.
   * Returns whether the drill passed all checks including RTO compliance.
   */
  async runDrDrill(): Promise<{
    passed: boolean;
    backupId: string;
    verification: VerificationResult;
    recovery: RecoveryResult;
    rtoCompliant: boolean;
  }> {
    const manifest = await this.createBackup();
    const verification = await this.verifyBackup(manifest.id);
    const recovery = await this.restoreBackup(manifest.id);
    const rtoCompliant = recovery.durationMs <= RTO_SECONDS * 1000;

    return {
      passed: verification.valid && recovery.success && rtoCompliant,
      backupId: manifest.id,
      verification,
      recovery,
      rtoCompliant,
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async _updateIndex(manifest: BackupManifest): Promise<void> {
    const index = await this.listBackups();
    index.unshift(manifest);
    await AsyncStorage.setItem(BACKUP_INDEX_KEY, JSON.stringify(index));
    await this.pruneOldBackups();
  }
}

export const disasterRecoveryService = new DisasterRecoveryService();
