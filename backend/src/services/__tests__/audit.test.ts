import {
  createAuditLogService,
  createInMemoryAuditStore,
  type AuditStore,
} from '../audit';
import type { SealedAuditEntry } from '../../lib/tamperChain';

const EV = (over: Record<string, unknown> = {}) => ({
  actor: 'admin:1',
  action: 'role.grant',
  resource: 'user:7',
  timestamp: '2026-11-24T00:00:00.000Z',
  metadata: { reason: 'onboarding' },
  ...over,
});

describe('audit - createAuditLogService', () => {
  it('records entries and verifies an intact log', async () => {
    const store = createInMemoryAuditStore();
    const audit = createAuditLogService({ store });
    const r1 = await audit.record(EV());
    const r2 = await audit.record(EV({ action: 'key.rotate', actor: 'admin:2' }));
    expect(r1.persisted).toBe(true);
    expect(r1.entry.seq).toBe(1);
    expect(r2.entry.prevHash).toBe(r1.entry.hash);
    const report = await audit.verifyIntegrity();
    expect(report.valid).toBe(true);
    expect(report.entriesChecked).toBe(2);
    expect(audit.sealedCount()).toBe(2);
    expect(audit.head()).toBe(r2.entry.hash);
  });

  it('uses the typed kind when provided', async () => {
    const store = createInMemoryAuditStore();
    const audit = createAuditLogService({ store });
    const r = await audit.record(EV({ kind: 'billing.override', action: 'free-form' }));
    expect(r.entry.action).toBe('billing.override');
  });

  it('rehydrates the head from persisted entries across restarts', async () => {
    const store = createInMemoryAuditStore();
    const a1 = createAuditLogService({ store });
    const r = await a1.record(EV());
    const a2 = createAuditLogService({ store });
    await a2.record(EV({ action: 'user.suspend' }));
    expect(a2.head()).not.toBe(r.entry.hash);
    expect((await a2.verifyIntegrity()).valid).toBe(true);
  });

  it('detects tampering in the backing store', async () => {
    const store = createInMemoryAuditStore();
    const audit = createAuditLogService({ store });
    await audit.record(EV());
    await audit.record(EV({ action: 'key.rotate' }));
    // Mutate the stored copy directly (simulates an attacker with DB access).
    const all = (await store.loadAll()) as SealedAuditEntry[];
    all[0] = { ...all[0], action: 'role.revoke' };
    const custom: AuditStore = {
      append: (e) => store.append(e),
      loadAll: async () => all,
    };
    const audit2 = createAuditLogService({ store: custom });
    const report = await audit2.verifyIntegrity();
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === 'HASH_MISMATCH')).toBe(true);
  });

  it('throws in strict mode on violation', async () => {
    const store = createInMemoryAuditStore();
    const audit = createAuditLogService({ store });
    await audit.record(EV());
    const all = (await store.loadAll()) as SealedAuditEntry[];
    all[0] = { ...all[0], actor: 'attacker' };
    const custom: AuditStore = {
      append: (e) => store.append(e),
      loadAll: async () => all,
    };
    const strict = createAuditLogService({ store: custom, strict: true });
    await expect(strict.verifyIntegrity()).rejects.toThrow(/tampering detected/);
  });

  it('emits metrics and logger hooks on record + verify', async () => {
    const increments: string[] = [];
    const logs: string[] = [];
    const audit = createAuditLogService({
      store: createInMemoryAuditStore(),
      metrics: { increment: (n) => increments.push(n) },
      logger: {
        info: (m) => logs.push(m),
        warn: (m) => logs.push(m),
      },
    });
    await audit.record(EV());
    await audit.verifyIntegrity();
    expect(increments).toContain('audit.record.total');
    expect(increments).toContain('audit.chain.verify.valid');
    expect(logs).toContain('audit.record.sealed');
    expect(logs).toContain('audit.integrity.ok');
  });
});
