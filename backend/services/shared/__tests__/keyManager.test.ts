import { KeyManager } from '../keyManager';
import { generateKey } from '../encryption';

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

describe('KeyManager', () => {
  let manager: KeyManager;

  beforeEach(async () => {
    manager = new KeyManager();
    await manager.initialize(generateKey());
  });

  it('initializes with an active encryption key', () => {
    const key = manager.getActiveEncryptionKey();
    expect(key).not.toBeNull();
    expect(key!.version).toBe(1);
    expect(key!.key.length).toBe(32);
  });

  it('returns a usable index key', () => {
    const idxKey = manager.getIndexKey();
    expect(idxKey).not.toBeNull();
    expect(idxKey!.length).toBe(32);
  });

  it('returns null when not initialized', () => {
    const fresh = new KeyManager();
    expect(fresh.getActiveEncryptionKey()).toBeNull();
  });

  it('tracks rotation info', () => {
    const info = manager.getRotationInfo();
    expect(info.activeKeys).toBeGreaterThanOrEqual(1);
    expect(info.intervalDays).toBeGreaterThan(0);
    expect(info.isDue).toBe(false);
  });

  it('rotation is not immediately due', () => {
    expect(manager.isRotationDue()).toBe(false);
  });

  it('supports key lookup by id', async () => {
    const activeKey = manager.getActiveEncryptionKey()!;
    const found = manager.getEncryptionKeyById(activeKey.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(activeKey.id);
  });

  it('returns null for unknown key id', () => {
    expect(manager.getEncryptionKeyById('nonexistent')).toBeNull();
  });

  it('lists all encryption keys', () => {
    const keys = manager.getAllEncryptionKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0].version).toBe(1);
  });

  it('performs key rotation', async () => {
    const oldKey = manager.getActiveEncryptionKey()!;
    const result = await manager.rotateKeys();

    expect(result.rotated).toBe(true);
    expect(result.previousKeyId).toBe(oldKey.id);
    expect(result.version).toBeGreaterThan(oldKey.version);
    expect(result.reEncryptionNeeded).toBe(true);

    const newKey = manager.getActiveEncryptionKey()!;
    expect(newKey.id).toBe(result.newKeyId);
    expect(newKey.version).toBe(result.version);
  });

  it('keeps only MAX_ACTIVE_KEYS keys after multiple rotations', async () => {
    for (let i = 0; i < 5; i++) {
      await manager.rotateKeys();
    }
    const keys = manager.getAllEncryptionKeys();
    expect(keys.length).toBeLessThanOrEqual(3);
  });

  it('can retrieve older key by id after rotation', async () => {
    const oldKey = manager.getActiveEncryptionKey()!;
    await manager.rotateKeys();
    const found = manager.getEncryptionKeyById(oldKey.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(oldKey.id);
  });
});
