import { SecretsVault } from '../SecretsVault';

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

beforeEach(() => Object.keys(store).forEach((k) => delete store[k]));

describe('SecretsVault', () => {
  let vault: SecretsVault;

  beforeEach(() => {
    vault = new SecretsVault('development');
  });

  // ── Vault set / get ───────────────────────────────────────────────────────

  it('stores and retrieves a secret', async () => {
    await vault.set('WEB3AUTH_CLIENT_ID', 'abc123');
    expect(await vault.get('WEB3AUTH_CLIENT_ID')).toBe('abc123');
  });

  it('returns null for unknown secret', async () => {
    expect(await vault.get('MISSING_KEY')).toBeNull();
  });

  it('value is not stored as plain text', async () => {
    await vault.set('CONTRACT_ID', 'CB64SECRET');
    const raw = store['@subtrackr:secrets:development:CONTRACT_ID'];
    expect(raw).not.toContain('CB64SECRET');
  });

  it('increments version on overwrite', async () => {
    await vault.set('KEY', 'v1');
    const meta = await vault.set('KEY', 'v2');
    expect(meta.version).toBe(2);
    expect(await vault.get('KEY')).toBe('v2');
  });

  // ── Secrets rotation ──────────────────────────────────────────────────────

  it('rotates a secret to a new value', async () => {
    await vault.set('API_KEY', 'old-value');
    const meta = await vault.rotate('API_KEY', 'new-value');
    expect(meta.version).toBe(2);
    expect(meta.rotatedAt).not.toBeNull();
    expect(await vault.get('API_KEY')).toBe('new-value');
  });

  it('throws when rotating a non-existent secret', async () => {
    await expect(vault.rotate('GHOST', 'value')).rejects.toThrow(/not found/i);
  });

  it('identifies secrets due for rotation', async () => {
    await vault.set('ROTATING_KEY', 'val', { rotationIntervalMs: 1 }); // 1ms interval
    await new Promise((r) => setTimeout(r, 5));
    const due = await vault.getDueForRotation();
    expect(due.some((m) => m.key === 'ROTATING_KEY')).toBe(true);
  });

  it('does not flag secrets not yet due', async () => {
    await vault.set('FRESH_KEY', 'val', { rotationIntervalMs: 999_999 });
    const due = await vault.getDueForRotation();
    expect(due.some((m) => m.key === 'FRESH_KEY')).toBe(false);
  });

  // ── Environment-specific secrets ──────────────────────────────────────────

  it('isolates secrets by environment', async () => {
    await vault.set('STELLAR_NETWORK', 'testnet', { env: 'development' });
    await vault.set('STELLAR_NETWORK', 'mainnet', { env: 'production' });
    expect(await vault.get('STELLAR_NETWORK', 'development')).toBe('testnet');
    expect(await vault.get('STELLAR_NETWORK', 'production')).toBe('mainnet');
  });

  it('lists secrets for a specific environment only', async () => {
    await vault.set('KEY_A', 'a', { env: 'staging' });
    await vault.set('KEY_B', 'b', { env: 'production' });
    const stagingSecrets = await vault.listByEnv('staging');
    expect(stagingSecrets.every((m) => m.env === 'staging')).toBe(true);
    expect(stagingSecrets.some((m) => m.key === 'KEY_A')).toBe(true);
    expect(stagingSecrets.some((m) => m.key === 'KEY_B')).toBe(false);
  });

  // ── Secrets injection ─────────────────────────────────────────────────────

  it('injects all env secrets into a flat object', async () => {
    await vault.set('STELLAR_NETWORK', 'testnet');
    await vault.set('CONTRACT_ID', 'CB64XYZ');
    const injected = await vault.inject();
    expect(injected['STELLAR_NETWORK']).toBe('testnet');
    expect(injected['CONTRACT_ID']).toBe('CB64XYZ');
  });

  it('inject does not include deleted secrets', async () => {
    await vault.set('OLD_KEY', 'value');
    await vault.delete('OLD_KEY');
    const injected = await vault.inject();
    expect(injected['OLD_KEY']).toBeUndefined();
  });

  // ── Soft delete ───────────────────────────────────────────────────────────

  it('soft-deletes a secret (get returns null)', async () => {
    await vault.set('TEMP_KEY', 'value');
    await vault.delete('TEMP_KEY');
    expect(await vault.get('TEMP_KEY')).toBeNull();
  });

  it('deleted secret excluded from listByEnv', async () => {
    await vault.set('DEL_KEY', 'value');
    await vault.delete('DEL_KEY');
    const list = await vault.listByEnv();
    expect(list.some((m) => m.key === 'DEL_KEY')).toBe(false);
  });

  // ── Secrets recovery ──────────────────────────────────────────────────────

  it('recovers a soft-deleted secret', async () => {
    await vault.set('RECOVER_KEY', 'secret-value');
    await vault.delete('RECOVER_KEY');
    await vault.recover('RECOVER_KEY');
    expect(await vault.get('RECOVER_KEY')).toBe('secret-value');
  });

  it('throws when recovering a non-existent secret', async () => {
    await expect(vault.recover('GHOST_KEY')).rejects.toThrow(/not found/i);
  });

  // ── Audit logging ─────────────────────────────────────────────────────────

  it('logs set action', async () => {
    await vault.set('AUDIT_KEY', 'val');
    const log = await vault.getAuditLog();
    expect(log.some((e) => e.action === 'set' && e.key === 'AUDIT_KEY')).toBe(true);
  });

  it('logs get action', async () => {
    await vault.set('AUDIT_KEY', 'val');
    await vault.get('AUDIT_KEY');
    const log = await vault.getAuditLog();
    expect(log.some((e) => e.action === 'get' && e.key === 'AUDIT_KEY' && e.success)).toBe(true);
  });

  it('logs failed get for missing secret', async () => {
    await vault.get('MISSING');
    const log = await vault.getAuditLog();
    expect(log.some((e) => e.action === 'get' && e.key === 'MISSING' && !e.success)).toBe(true);
  });

  it('logs rotate action', async () => {
    await vault.set('ROT_KEY', 'v1');
    await vault.rotate('ROT_KEY', 'v2');
    const log = await vault.getAuditLog();
    expect(log.some((e) => e.action === 'rotate' && e.key === 'ROT_KEY')).toBe(true);
  });

  it('logs delete action', async () => {
    await vault.set('DEL_KEY', 'val');
    await vault.delete('DEL_KEY');
    const log = await vault.getAuditLog();
    expect(log.some((e) => e.action === 'delete' && e.key === 'DEL_KEY')).toBe(true);
  });

  it('logs recover action', async () => {
    await vault.set('REC_KEY', 'val');
    await vault.delete('REC_KEY');
    await vault.recover('REC_KEY');
    const log = await vault.getAuditLog();
    expect(log.some((e) => e.action === 'recover' && e.key === 'REC_KEY')).toBe(true);
  });

  it('logs inject action', async () => {
    await vault.inject();
    const log = await vault.getAuditLog();
    expect(log.some((e) => e.action === 'inject')).toBe(true);
  });

  it('clears audit log', async () => {
    await vault.set('K', 'v');
    await vault.clearAuditLog();
    expect(await vault.getAuditLog()).toHaveLength(0);
  });

  it('audit log includes timestamp and env', async () => {
    await vault.set('TS_KEY', 'val');
    const log = await vault.getAuditLog();
    const event = log.find((e) => e.key === 'TS_KEY');
    expect(event?.timestamp).toBeGreaterThan(0);
    expect(event?.env).toBe('development');
  });
});
