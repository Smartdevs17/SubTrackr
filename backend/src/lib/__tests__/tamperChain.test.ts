import {
  GENESIS_HASH,
  TamperChainError,
  canonicalStringify,
  computeEntryHash,
  createTamperChain,
  resealChain,
  validateInput,
  verifyChain,
  type AuditEventInput,
  type SealedAuditEntry,
} from '../tamperChain';

const EV = (over: Partial<AuditEventInput> = {}): AuditEventInput => ({
  actor: 'admin:1',
  action: 'role.grant',
  resource: 'user:7',
  timestamp: '2026-11-24T00:00:00.000Z',
  metadata: { ip: '127.0.0.1' },
  ...over,
});

describe('tamperChain - canonicalStringify', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalStringify({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it('omits undefined values but keeps arrays ordered', () => {
    expect(canonicalStringify({ x: undefined, y: [2, 1] })).toBe('{"y":[2,1]}');
  });

  it('is stable for logically identical entries regardless of key insertion order', () => {
    expect(canonicalStringify({ a: 1, b: 2 })).toBe(canonicalStringify({ b: 2, a: 1 }));
  });
});

describe('tamperChain - validateInput', () => {
  it('accepts a valid input', () => {
    expect(() => validateInput(EV())).not.toThrow();
  });

  it('rejects empty actor / action / timestamp', () => {
    expect(() => validateInput(EV({ actor: '' }))).toThrow(TamperChainError);
    expect(() => validateInput(EV({ action: '' }))).toThrow(TamperChainError);
    expect(() => validateInput(EV({ timestamp: '' }))).toThrow(TamperChainError);
  });
});

describe('tamperChain - createTamperChain', () => {
  it('starts at the genesis hash and is empty', () => {
    const c = createTamperChain();
    expect(c.head()).toBe(GENESIS_HASH);
    expect(c.length()).toBe(0);
    expect(c.entries()).toEqual([]);
  });

  it('seals entries with monotonic seq and correct links', () => {
    const c = createTamperChain();
    const e1 = c.append(EV());
    const e2 = c.append(EV({ action: 'key.rotate', actor: 'admin:2' }));
    expect(e1.seq).toBe(1);
    expect(e1.prevHash).toBe(GENESIS_HASH);
    expect(e2.seq).toBe(2);
    expect(e2.prevHash).toBe(e1.hash);
    expect(c.head()).toBe(e2.hash);
    expect(c.length()).toBe(2);
  });

  it('produces a verifiable chain', () => {
    const c = createTamperChain();
    c.append(EV());
    c.append(EV({ action: 'key.rotate' }));
    c.append(EV({ action: 'user.suspend' }));
    const report = c.verify();
    expect(report.valid).toBe(true);
    expect(report.entriesChecked).toBe(3);
    expect(report.issues).toEqual([]);
    expect(report.headHash).toBe(c.head());
  });

  it('emits metrics and logger hooks', () => {
    const increments: string[] = [];
    const logs: string[] = [];
    const c = createTamperChain(undefined, {
      metrics: { increment: (n) => increments.push(n) },
      logger: { info: (m) => logs.push(m) },
    });
    c.append(EV());
    c.verify();
    expect(increments).toContain('audit.chain.append.total');
    expect(increments).toContain('audit.chain.verify.valid');
    expect(logs).toContain('audit.chain.appended');
  });

  it('returns defensive copies from entries()', () => {
    const c = createTamperChain();
    c.append(EV());
    const snap = c.entries() as SealedAuditEntry[];
    snap[0].hash = 'tampered';
    expect(c.entries()[0].hash).not.toBe('tampered');
  });
});

describe('tamperChain - verifyChain (failure modes)', () => {
  it('rejects an empty chain', () => {
    const report = verifyChain([]);
    expect(report.valid).toBe(false);
    expect(report.issues[0].code).toBe('EMPTY_CHAIN');
  });

  it('detects content modification of a middle entry', () => {
    const c = createTamperChain();
    c.append(EV());
    c.append(EV({ action: 'key.rotate' }));
    c.append(EV({ action: 'user.suspend' }));
    const entries = c.entries() as SealedAuditEntry[];
    entries[1] = { ...entries[1], action: 'role.revoke' };
    const report = verifyChain(entries);
    // Middle entry hash mismatch breaks this entry and the next link.
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === 'HASH_MISMATCH')).toBe(true);
  });

  it('detects a broken predecessor link', () => {
    const c = createTamperChain();
    c.append(EV());
    c.append(EV({ action: 'key.rotate' }));
    const entries = c.entries() as SealedAuditEntry[];
    entries[1] = { ...entries[1], prevHash: GENESIS_HASH };
    const report = verifyChain(entries);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === 'BROKEN_LINK')).toBe(true);
  });

  it('detects a sequence gap', () => {
    const c = createTamperChain();
    c.append(EV());
    c.append(EV({ action: 'key.rotate' }));
    const entries = c.entries() as SealedAuditEntry[];
    entries[1] = { ...entries[1], seq: 5 };
    const report = verifyChain(entries);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === 'INVALID_SEQUENCE')).toBe(true);
  });

  it('detects a malformed hash', () => {
    const c = createTamperChain();
    c.append(EV());
    const entries = c.entries() as SealedAuditEntry[];
    entries[0] = { ...entries[0], hash: 'nope' };
    const report = verifyChain(entries);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === 'INVALID_HASH')).toBe(true);
  });

  it('rejects a malformed genesis config', () => {
    expect(() => createTamperChain({ genesisHash: 'xyz' })).toThrow(TamperChainError);
  });

  it('verifies a custom genesis chain', () => {
    const g = 'a'.repeat(64);
    const c = createTamperChain({ genesisHash: g });
    const e = c.append(EV());
    expect(e.prevHash).toBe(g);
    expect(verifyChain(c.entries(), { genesisHash: g }).valid).toBe(true);
  });
});

describe('tamperChain - computeEntryHash / resealChain', () => {
  it('computeEntryHash is deterministic', () => {
    const a = computeEntryHash(EV(), 1, GENESIS_HASH);
    const b = computeEntryHash(EV(), 1, GENESIS_HASH);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('resesals a tampered chain into a valid one', () => {
    const c = createTamperChain();
    c.append(EV());
    c.append(EV({ action: 'key.rotate' }));
    const entries = c.entries() as SealedAuditEntry[];
    entries[0] = { ...entries[0], action: 'tampered' };
    expect(verifyChain(entries).valid).toBe(false);
    const resealed = resealChain(entries);
    expect(verifyChain(resealed).valid).toBe(true);
  });
});
