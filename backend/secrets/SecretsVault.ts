import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Environment = 'development' | 'staging' | 'production';

export interface SecretMetadata {
  key: string;
  env: Environment;
  version: number;
  createdAt: number;
  rotatedAt: number | null;
  rotationIntervalMs: number | null;
  deleted: boolean;
}

export interface SecretEntry {
  meta: SecretMetadata;
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: 'aes-256-gcm';
}

export interface AuditEvent {
  action: 'set' | 'get' | 'rotate' | 'delete' | 'recover' | 'inject';
  key: string;
  env: Environment;
  timestamp: number;
  success: boolean;
  reason?: string;
}

export interface InjectedSecrets {
  STELLAR_NETWORK: string;
  CONTRACT_ID: string;
  WEB3AUTH_CLIENT_ID: string;
  [key: string]: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VAULT_PREFIX = '@subtrackr:secrets:';
const AUDIT_KEY = '@subtrackr:secrets:audit';
const INDEX_KEY = '@subtrackr:secrets:index';
const MAX_AUDIT_EVENTS = 1000;
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const VAULT_MASTER_KEY_KEY = '@subtrackr:secrets:vault_key';
const HMAC_ALGORITHM = 'sha256';

// ---------------------------------------------------------------------------
// AES-256-GCM encryption for secrets at rest
// ---------------------------------------------------------------------------

async function getOrCreateMasterKey(): Promise<Buffer> {
  const existing = await AsyncStorage.getItem(VAULT_MASTER_KEY_KEY);
  if (existing) return Buffer.from(existing, 'base64');
  const key = randomBytes(32);
  await AsyncStorage.setItem(VAULT_MASTER_KEY_KEY, key.toString('base64'));
  return key;
}

function deriveVaultKey(masterKey: Buffer): { encKey: Buffer; hmacKey: Buffer } {
  const hmac1 = createHmac(HMAC_ALGORITHM, masterKey);
  hmac1.update('vault-encryption');
  const encKey = hmac1.digest();

  const hmac2 = createHmac(HMAC_ALGORITHM, masterKey);
  hmac2.update('vault-integrity');
  const hmacKey = hmac2.digest();

  return { encKey, hmacKey };
}

async function encrypt(value: string): Promise<{ ciphertext: string; iv: string; authTag: string }> {
  const masterKey = await getOrCreateMasterKey();
  const { encKey } = deriveVaultKey(masterKey);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, encKey, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

async function decrypt(
  ciphertext: string,
  iv: string,
  authTag: string
): Promise<string> {
  const masterKey = await getOrCreateMasterKey();
  const { encKey } = deriveVaultKey(masterKey);

  const ivBuf = Buffer.from(iv, 'base64');
  const authTagBuf = Buffer.from(authTag, 'base64');
  const ciphertextBuf = Buffer.from(ciphertext, 'base64');

  const decipher = createDecipheriv(ALGORITHM, encKey, ivBuf, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTagBuf);
  const decrypted = Buffer.concat([decipher.update(ciphertextBuf), decipher.final()]);

  return decrypted.toString('utf8');
}

function storageKey(key: string, env: Environment): string {
  return `${VAULT_PREFIX}${env}:${key}`;
}

// ---------------------------------------------------------------------------
// SecretsVault
// ---------------------------------------------------------------------------

export class SecretsVault {
  private readonly currentEnv: Environment;

  constructor(env: Environment = 'development') {
    this.currentEnv = env;
  }

  // ── Set / Get ─────────────────────────────────────────────────────────────

  async set(
    key: string,
    value: string,
    options: { env?: Environment; rotationIntervalMs?: number } = {}
  ): Promise<SecretMetadata> {
    const env = options.env ?? this.currentEnv;
    const existing = await this._load(key, env);
    const version = existing ? existing.meta.version + 1 : 1;

    const meta: SecretMetadata = {
      key,
      env,
      version,
      createdAt: existing?.meta.createdAt ?? Date.now(),
      rotatedAt: version > 1 ? Date.now() : null,
      rotationIntervalMs: options.rotationIntervalMs ?? existing?.meta.rotationIntervalMs ?? null,
      deleted: false,
    };

    const { ciphertext, iv, authTag } = await encrypt(value);
    const entry: SecretEntry = {
      meta,
      ciphertext,
      iv,
      authTag,
      algorithm: ALGORITHM,
    };
    await AsyncStorage.setItem(storageKey(key, env), JSON.stringify(entry));
    await this._updateIndex(meta);
    await this._audit({ action: version > 1 ? 'rotate' : 'set', key, env, success: true });
    return meta;
  }

  async get(key: string, env?: Environment): Promise<string | null> {
    const resolvedEnv = env ?? this.currentEnv;
    const entry = await this._load(key, resolvedEnv);
    if (!entry || entry.meta.deleted) {
      await this._audit({
        action: 'get',
        key,
        env: resolvedEnv,
        success: false,
        reason: 'not found or deleted',
      });
      return null;
    }
    await this._audit({ action: 'get', key, env: resolvedEnv, success: true });
    return decrypt(entry.ciphertext, entry.iv, entry.authTag);
  }

  // ── Rotation ──────────────────────────────────────────────────────────────

  /** Rotate a secret to a new value, incrementing its version */
  async rotate(key: string, newValue: string, env?: Environment): Promise<SecretMetadata> {
    const resolvedEnv = env ?? this.currentEnv;
    const existing = await this._load(key, resolvedEnv);
    if (!existing || existing.meta.deleted) {
      await this._audit({
        action: 'rotate',
        key,
        env: resolvedEnv,
        success: false,
        reason: 'secret not found',
      });
      throw new Error(`Secret "${key}" not found in ${resolvedEnv}`);
    }
    return this.set(key, newValue, {
      env: resolvedEnv,
      rotationIntervalMs: existing.meta.rotationIntervalMs ?? undefined,
    });
  }

  /** Returns secrets whose rotation interval has elapsed */
  async getDueForRotation(env?: Environment): Promise<SecretMetadata[]> {
    const resolvedEnv = env ?? this.currentEnv;
    const index = await this._getIndex();
    const now = Date.now();
    return index.filter(
      (m) =>
        m.env === resolvedEnv &&
        !m.deleted &&
        m.rotationIntervalMs !== null &&
        now - (m.rotatedAt ?? m.createdAt) >= m.rotationIntervalMs
    );
  }

  // ── Environment-specific secrets ──────────────────────────────────────────

  /** List all non-deleted secrets for a given environment */
  async listByEnv(env?: Environment): Promise<SecretMetadata[]> {
    const resolvedEnv = env ?? this.currentEnv;
    const index = await this._getIndex();
    return index.filter((m) => m.env === resolvedEnv && !m.deleted);
  }

  // ── Secrets injection ─────────────────────────────────────────────────────

  /**
   * Inject all secrets for the current environment into a flat object.
   * Use this to populate app config at startup.
   */
  async inject(env?: Environment): Promise<Partial<InjectedSecrets>> {
    const resolvedEnv = env ?? this.currentEnv;
    const metas = await this.listByEnv(resolvedEnv);
    const result: Partial<InjectedSecrets> = {};
    for (const meta of metas) {
      const value = await this.get(meta.key, resolvedEnv);
      if (value !== null) result[meta.key] = value;
    }
    await this._audit({ action: 'inject', key: '*', env: resolvedEnv, success: true });
    return result;
  }

  // ── Soft delete ───────────────────────────────────────────────────────────

  async delete(key: string, env?: Environment): Promise<void> {
    const resolvedEnv = env ?? this.currentEnv;
    const entry = await this._load(key, resolvedEnv);
    if (!entry) return;
    entry.meta.deleted = true;
    await AsyncStorage.setItem(storageKey(key, resolvedEnv), JSON.stringify(entry));
    await this._updateIndex(entry.meta);
    await this._audit({ action: 'delete', key, env: resolvedEnv, success: true });
  }

  // ── Recovery ──────────────────────────────────────────────────────────────

  /** Recover a soft-deleted secret */
  async recover(key: string, env?: Environment): Promise<SecretMetadata> {
    const resolvedEnv = env ?? this.currentEnv;
    const entry = await this._load(key, resolvedEnv);
    if (!entry) {
      await this._audit({
        action: 'recover',
        key,
        env: resolvedEnv,
        success: false,
        reason: 'not found',
      });
      throw new Error(`Secret "${key}" not found in ${resolvedEnv}`);
    }
    entry.meta.deleted = false;
    await AsyncStorage.setItem(storageKey(key, resolvedEnv), JSON.stringify(entry));
    await this._updateIndex(entry.meta);
    await this._audit({ action: 'recover', key, env: resolvedEnv, success: true });
    return entry.meta;
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  async getAuditLog(limit = 100): Promise<AuditEvent[]> {
    const raw = await AsyncStorage.getItem(AUDIT_KEY);
    const events: AuditEvent[] = raw ? JSON.parse(raw) : [];
    return events.slice(-limit);
  }

  async clearAuditLog(): Promise<void> {
    await AsyncStorage.removeItem(AUDIT_KEY);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async _load(key: string, env: Environment): Promise<SecretEntry | null> {
    const raw = await AsyncStorage.getItem(storageKey(key, env));
    return raw ? (JSON.parse(raw) as SecretEntry) : null;
  }

  private async _getIndex(): Promise<SecretMetadata[]> {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as SecretMetadata[]) : [];
  }

  private async _updateIndex(meta: SecretMetadata): Promise<void> {
    const index = await this._getIndex();
    const idx = index.findIndex((m) => m.key === meta.key && m.env === meta.env);
    if (idx >= 0) index[idx] = meta;
    else index.push(meta);
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
  }

  private async _audit(event: Omit<AuditEvent, 'timestamp'>): Promise<void> {
    const raw = await AsyncStorage.getItem(AUDIT_KEY);
    const events: AuditEvent[] = raw ? JSON.parse(raw) : [];
    events.push({ ...event, timestamp: Date.now() });
    if (events.length > MAX_AUDIT_EVENTS) events.splice(0, events.length - MAX_AUDIT_EVENTS);
    await AsyncStorage.setItem(AUDIT_KEY, JSON.stringify(events));
  }
}

export const secretsVault = new SecretsVault(
  (process.env['APP_ENV'] as Environment | undefined) ?? 'development'
);
