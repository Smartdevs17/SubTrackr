/**
 * backend/src/lib/tamperChain.ts
 *
 * Tamper-evident hash chaining for append-only audit records. This module is
 * a zero-I/O, side-effect-free primitive: it knows nothing about stores,
 * clocks, or networks. Callers feed it canonicalisable entries; it returns
 * SHA-256 sealed entries whose `hash` binds both the entry content and the
 * hash of its predecessor, forming an append-only chain.
 *
 * Design rules (issue #2273):
 *  - Pure functions only: no I/O, no clock reads, no random values.
 *  - Every rejection is a typed `TamperChainError` with a stable `code`.
 *  - Canonical serialisation is deterministic (sorted keys) so the same
 *    logical entry always produces the same hash across processes.
 *  - A sealed chain can be verified in full, detecting deletion, reordering,
 *    and content modification of any record.
 *  - Observability hooks for metrics and audit logging.
 *
 * Usage:
 *   import { createTamperChain, verifyChain } from '../lib/tamperChain';
 *   const chain = createTamperChain();
 *   const e1 = chain.append({ actor: 'admin:1', action: 'role.grant' });
 *   const e2 = chain.append({ actor: 'admin:2', action: 'key.rotate' });
 *   const report = chain.verify();
 *   if (!report.valid) throw new Error('audit log tampered');
 */

import { createHash } from 'crypto';

// ?? Types ???????????????????????????????????????????????????????????????

export type TamperChainErrorCode =
  | 'INVALID_SEQUENCE'
  | 'INVALID_HASH'
  | 'HASH_MISMATCH'
  | 'BROKEN_LINK'
  | 'EMPTY_CHAIN'
  | 'INVALID_GENESIS'
  | 'INVALID_CONFIG';

export class TamperChainError extends Error {
  readonly code: TamperChainErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: TamperChainErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'TamperChainError';
    this.code = code;
    this.details = details;
  }
}

/** Payload supplied by the caller for a single audit event. */
export interface AuditEventInput {
  /** Stable actor identifier, e.g. `user:42` or `service:billing`. */
  actor: string;
  /** Machine-readable action, e.g. `role.grant` or `key.rotate`. */
  action: string;
  /** Optional resource the action was performed on. */
  resource?: string;
  /** ISO-8601 timestamp. Callers supply it to keep this module clock-free. */
  timestamp: string;
  /** Arbitrary structured metadata; must be JSON-serialisable. */
  metadata?: Readonly<Record<string, unknown>>;
}

/** A sealed audit entry: the input plus chaining fields. */
export interface SealedAuditEntry extends AuditEventInput {
  /** Monotonic 1-based sequence number. */
  seq: number;
  /** SHA-256 hash of the previous sealed entry (`GENESIS_HASH` for the first). */
  prevHash: string;
  /** SHA-256 hash binding this entry's content and `prevHash`. */
  hash: string;
}

export interface TamperChainConfig {
  /** Expected hash of the chain genesis. Defaults to 64 zero characters. */
  genesisHash?: string;
}

export interface ChainVerificationIssue {
  seq: number;
  code: TamperChainErrorCode;
  message: string;
}

export interface ChainVerificationReport {
  valid: boolean;
  entriesChecked: number;
  issues: readonly ChainVerificationIssue[];
  /** Hash of the final entry, usable as the chain head / checkpoint anchor. */
  headHash: string | null;
}

export interface ChainMetrics {
  increment?(name: string, labels?: Record<string, string>): void;
  observe?(name: string, value: number, labels?: Record<string, string>): void;
}

export interface ChainLogger {
  info?(message: string, fields?: Record<string, unknown>): void;
  warn?(message: string, fields?: Record<string, unknown>): void;
}

// ?? Configuration ?????????????????????????????????????????????????????????

/** Sentinel used as the predecessor of the very first chain entry. */
export const GENESIS_HASH = '0'.repeat(64);
const HEX_SHA256 = /^[0-9a-f]{64}$/;

function resolveGenesis(config?: TamperChainConfig): string {
  const g = config?.genesisHash ?? GENESIS_HASH;
  if (!HEX_SHA256.test(g)) {
    throw new TamperChainError('INVALID_GENESIS', 'genesisHash must be 64 lowercase hex chars');
  }
  return g;
}

/**
 * Deterministic canonical JSON: object keys are sorted recursively so that
 * logically identical entries hash identically regardless of key insertion
 * order. `undefined` values are omitted; arrays preserve order.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',')}}`;
}

/** Compute the SHA-256 hash binding an entry's content to its predecessor. */
export function computeEntryHash(input: AuditEventInput, seq: number, prevHash: string): string {
  const canonical = canonicalStringify({
    seq,
    prevHash,
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    timestamp: input.timestamp,
    metadata: input.metadata ?? {},
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Validate an input before sealing. */
export function validateInput(input: AuditEventInput): void {
  if (!input || typeof input.actor !== 'string' || input.actor.length === 0) {
    throw new TamperChainError('INVALID_CONFIG', 'actor must be a non-empty string');
  }
  if (typeof input.action !== 'string' || input.action.length === 0) {
    throw new TamperChainError('INVALID_CONFIG', 'action must be a non-empty string');
  }
  if (typeof input.timestamp !== 'string' || input.timestamp.length === 0) {
    throw new TamperChainError('INVALID_CONFIG', 'timestamp must be a non-empty string');
  }
}

// ?? Chain ?????????????????????????????????????????????????????????????????

export interface TamperChain {
  readonly genesisHash: string;
  /** Append an input and return the sealed entry. Mutates chain head. */
  append(input: AuditEventInput): SealedAuditEntry;
  /** Current head hash (genesis if empty). */
  head(): string;
  /** Number of sealed entries. */
  length(): number;
  /** Snapshot of all sealed entries (defensive copy). */
  entries(): readonly SealedAuditEntry[];
  /** Verify the whole in-memory chain. */
  verify(): ChainVerificationReport;
}

/**
 * Create an in-memory tamper-evident chain. A fresh chain starts at the
 * genesis hash; each `append` seals a new entry onto the current head.
 */
export function createTamperChain(
  config?: TamperChainConfig,
  hooks?: { metrics?: ChainMetrics; logger?: ChainLogger }
): TamperChain {
  const genesisHash = resolveGenesis(config);
  const sealed: SealedAuditEntry[] = [];
  const metrics = hooks?.metrics;
  const logger = hooks?.logger;

  return {
    genesisHash,
    append(input: AuditEventInput): SealedAuditEntry {
      validateInput(input);
      const seq = sealed.length + 1;
      const prevHash = sealed.length === 0 ? genesisHash : sealed[sealed.length - 1].hash;
      const hash = computeEntryHash(input, seq, prevHash);
      const entry: SealedAuditEntry = { ...input, seq, prevHash, hash };
      sealed.push(entry);
      metrics?.increment?.('audit.chain.append.total');
      logger?.info?.('audit.chain.appended', { seq, actor: input.actor, action: input.action });
      return entry;
    },
    head(): string {
      return sealed.length === 0 ? genesisHash : sealed[sealed.length - 1].hash;
    },
    length(): number {
      return sealed.length;
    },
    entries(): readonly SealedAuditEntry[] {
      return sealed.map((e) => ({ ...e }));
    },
    verify(): ChainVerificationReport {
      return verifyChain(sealed, config, hooks);
    },
  };
}

/**
 * Verify an arbitrary list of sealed entries. Detects: empty chain, sequence
 * gaps/duplicates, broken links, and content hashes that no longer match.
 * Verification is pure and does not mutate `entries`.
 */
export function verifyChain(
  entries: readonly SealedAuditEntry[],
  config?: TamperChainConfig,
  hooks?: { metrics?: ChainMetrics; logger?: ChainLogger }
): ChainVerificationReport {
  const genesisHash = resolveGenesis(config);
  const metrics = hooks?.metrics;
  const logger = hooks?.logger;
  const issues: ChainVerificationIssue[] = [];

  if (entries.length === 0) {
    metrics?.increment?.('audit.chain.verify.empty');
    return { valid: false, entriesChecked: 0, issues: [
      { seq: 0, code: 'EMPTY_CHAIN', message: 'cannot verify an empty chain' },
    ], headHash: null };
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const expectedSeq = i + 1;

    if (!Number.isInteger(e.seq) || e.seq !== expectedSeq) {
      issues.push({ seq: e.seq, code: 'INVALID_SEQUENCE',
        message: `expected seq ${expectedSeq}, got ${e.seq}` });
    }

    const expectedPrev = i === 0 ? genesisHash : entries[i - 1].hash;
    if (typeof e.prevHash !== 'string' || e.prevHash !== expectedPrev) {
      issues.push({ seq: e.seq, code: 'BROKEN_LINK',
        message: `entry ${e.seq} does not link to predecessor` });
    }

    if (typeof e.hash !== 'string' || !HEX_SHA256.test(e.hash)) {
      issues.push({ seq: e.seq, code: 'INVALID_HASH',
        message: `entry ${e.seq} has a malformed hash` });
      continue;
    }

    const expectedHash = computeEntryHash(e, e.seq, e.prevHash);
    if (e.hash !== expectedHash) {
      issues.push({ seq: e.seq, code: 'HASH_MISMATCH',
        message: `entry ${e.seq} content was modified (hash mismatch)` });
    }
  }

  const valid = issues.length === 0;
  const headHash = entries[entries.length - 1].hash;
  metrics?.increment?.(valid ? 'audit.chain.verify.valid' : 'audit.chain.verify.tampered');
  metrics?.observe?.('audit.chain.length', entries.length);
  if (!valid) {
    logger?.warn?.('audit.chain.tamper_detected', { issues: issues.length, headHash });
  }
  return { valid, entriesChecked: entries.length, issues, headHash };
}

/**
 * Recompute and re-seal a tampered chain from its payloads, preserving the
 * original sequence. Useful for reconstructing a canonical chain after an
 * operator repair; returns a brand-new sealed list without mutating input.
 */
export function resealChain(
  entries: readonly SealedAuditEntry[],
  config?: TamperChainConfig
): readonly SealedAuditEntry[] {
  const chain = createTamperChain(config);
  for (const e of entries) {
    chain.append({
      actor: e.actor,
      action: e.action,
      resource: e.resource,
      timestamp: e.timestamp,
      metadata: e.metadata,
    });
  }
  return chain.entries();
}
