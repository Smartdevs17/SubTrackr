import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomBytes, createHmac } from 'crypto';
import {
  generateEncryptionKey,
  generateKey,
  type EncryptionKey,
  type Environment,
} from './encryption';

export interface KeyStoreEntry {
  masterKey: string;
  encryptionKeys: {
    id: string;
    version: number;
    key: string;
    createdAt: number;
    expiresAt: number;
  }[];
  activeEncryptionKeyId: string;
  indexKey: string;
  activeIndexKeyId: string;
  lastRotation: number;
  rotationIntervalMs: number;
}

export interface KeyRotationResult {
  rotated: boolean;
  previousKeyId: string | null;
  newKeyId: string;
  version: number;
  reEncryptionNeeded: boolean;
}

export interface KeyRotationInfo {
  lastRotation: number;
  nextRotation: number;
  intervalDays: number;
  activeKeys: number;
  isDue: boolean;
}

const DEFAULT_ROTATION_INTERVAL = 90 * 24 * 60 * 60 * 1000;
const KEY_STORE_KEY = '@subtrackr:pii:keystore';
const MASTER_KEY_KEY = '@subtrackr:pii:masterkey';
const MAX_ACTIVE_KEYS = 3;

const HMAC_ALGORITHM = 'sha256';

function bufferToBase64(buf: Buffer): string {
  return buf.toString('base64');
}

function base64ToBuffer(str: string): Buffer {
  return Buffer.from(str, 'base64');
}

export class KeyManager {
  private store: KeyStoreEntry | null = null;

  async initialize(masterKey?: Buffer): Promise<void> {
    const existing = await this.loadStore();
    if (existing) {
      this.store = existing;
      return;
    }

    const mk = masterKey ?? generateKey();
    const mkBase64 = bufferToBase64(mk);

    const encKey1 = generateEncryptionKey(mk, 1);
    const indexKey = this.deriveIndexKey(mk, 1);

    this.store = {
      masterKey: mkBase64,
      encryptionKeys: [
        {
          id: encKey1.id,
          version: encKey1.version,
          key: bufferToBase64(encKey1.key),
          createdAt: encKey1.createdAt,
          expiresAt: encKey1.expiresAt,
        },
      ],
      activeEncryptionKeyId: encKey1.id,
      indexKey: bufferToBase64(indexKey),
      activeIndexKeyId: 'index-v1',
      lastRotation: Date.now(),
      rotationIntervalMs: DEFAULT_ROTATION_INTERVAL,
    };

    await this.persistStore();
  }

  getActiveEncryptionKey(): EncryptionKey | null {
    if (!this.store) return null;
    const entry = this.store.encryptionKeys.find(
      (k) => k.id === this.store!.activeEncryptionKeyId
    );
    if (!entry) return null;
    return {
      id: entry.id,
      version: entry.version,
      key: base64ToBuffer(entry.key),
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
    };
  }

  getEncryptionKeyById(keyId: string): EncryptionKey | null {
    if (!this.store) return null;
    const entry = this.store.encryptionKeys.find((k) => k.id === keyId);
    if (!entry) return null;
    return {
      id: entry.id,
      version: entry.version,
      key: base64ToBuffer(entry.key),
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
    };
  }

  getIndexKey(): Buffer | null {
    if (!this.store) return null;
    return base64ToBuffer(this.store.indexKey);
  }

  getAllEncryptionKeys(): EncryptionKey[] {
    if (!this.store) return [];
    return this.store.encryptionKeys.map((e) => ({
      id: e.id,
      version: e.version,
      key: base64ToBuffer(e.key),
      createdAt: e.createdAt,
      expiresAt: e.expiresAt,
    }));
  }

  isRotationDue(): boolean {
    if (!this.store) return false;
    return Date.now() - this.store.lastRotation >= this.store.rotationIntervalMs;
  }

  async rotateKeys(): Promise<KeyRotationResult> {
    if (!this.store) throw new Error('KeyManager not initialized');

    const mk = base64ToBuffer(this.store.masterKey);
    const previousKeyId = this.store.activeEncryptionKeyId;

    const nextVersion =
      Math.max(...this.store.encryptionKeys.map((k) => k.version), 0) + 1;
    const newKey = generateEncryptionKey(mk, nextVersion);
    const newIndexKey = this.deriveIndexKey(mk, nextVersion);

    this.store.encryptionKeys.push({
      id: newKey.id,
      version: newKey.version,
      key: bufferToBase64(newKey.key),
      createdAt: newKey.createdAt,
      expiresAt: newKey.expiresAt,
    });

    this.store.activeEncryptionKeyId = newKey.id;
    this.store.indexKey = bufferToBase64(newIndexKey);
    this.store.activeIndexKeyId = `index-v${nextVersion}`;
    this.store.lastRotation = Date.now();

    while (this.store.encryptionKeys.length > MAX_ACTIVE_KEYS) {
      this.store.encryptionKeys.shift();
    }

    await this.persistStore();

    return {
      rotated: true,
      previousKeyId,
      newKeyId: newKey.id,
      version: nextVersion,
      reEncryptionNeeded: true,
    };
  }

  getRotationInfo(): KeyRotationInfo {
    if (!this.store) {
      return {
        lastRotation: 0,
        nextRotation: 0,
        intervalDays: 90,
        activeKeys: 0,
        isDue: false,
      };
    }

    const intervalDays = Math.round(
      this.store.rotationIntervalMs / (24 * 60 * 60 * 1000)
    );

    return {
      lastRotation: this.store.lastRotation,
      nextRotation: this.store.lastRotation + this.store.rotationIntervalMs,
      intervalDays,
      activeKeys: this.store.encryptionKeys.length,
      isDue: this.isRotationDue(),
    };
  }

  private deriveIndexKey(masterKey: Buffer, version: number): Buffer {
    const hmac = createHmac(HMAC_ALGORITHM, masterKey);
    hmac.update('pii-blind-index');
    hmac.update(String(version));
    return hmac.digest().subarray(0, 32);
  }

  private async loadStore(): Promise<KeyStoreEntry | null> {
    try {
      const raw = await AsyncStorage.getItem(KEY_STORE_KEY);
      return raw ? (JSON.parse(raw) as KeyStoreEntry) : null;
    } catch {
      return null;
    }
  }

  private async persistStore(): Promise<void> {
    if (!this.store) return;
    await AsyncStorage.setItem(KEY_STORE_KEY, JSON.stringify(this.store));
  }
}

export const keyManager = new KeyManager();
