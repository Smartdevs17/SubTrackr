import { createHash } from 'crypto';

export interface AuditChainEntry {
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  oldState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  timestamp: number;
  prevHash: string;
  hash: string;
  metadata: Record<string, unknown>;
}

const GENESIS_HASH = '0'.repeat(64);

export class HashChainService {
  private chain: AuditChainEntry[] = [];

  constructor() {}

  getGenesisHash(): string {
    return GENESIS_HASH;
  }

  getChain(): readonly AuditChainEntry[] {
    return this.chain;
  }

  getChainHead(): AuditChainEntry | null {
    return this.chain.length > 0 ? this.chain[this.chain.length - 1] : null;
  }

  append(entry: Omit<AuditChainEntry, 'prevHash' | 'hash'>): AuditChainEntry {
    const prevHash = this.getChainHead()?.hash ?? GENESIS_HASH;
    const hash = this.computeHash({ ...entry, prevHash });
    const chainEntry: AuditChainEntry = { ...entry, prevHash, hash };
    this.chain.push(chainEntry);
    return chainEntry;
  }

  computeHash(data: { id: string; actorId: string; action: string; resourceType: string; resourceId: string; timestamp: number; prevHash: string }): string {
    return createHash('sha256')
      .update(prevHash)
      .update(data.id)
      .update(data.actorId)
      .update(data.action)
      .update(data.resourceType)
      .update(data.resourceId)
      .update(String(data.timestamp))
      .digest('hex');
  }

  verify(): { valid: boolean; firstInvalidIndex: number | null } {
    let prev = GENESIS_HASH;
    for (let i = 0; i < this.chain.length; i++) {
      const e = this.chain[i];
      if (e.prevHash !== prev) {
        return { valid: false, firstInvalidIndex: i };
      }
      const expected = this.computeHash({
        id: e.id,
        actorId: e.actorId,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        timestamp: e.timestamp,
        prevHash: e.prevHash,
      });
      if (expected !== e.hash) {
        return { valid: false, firstInvalidIndex: i };
      }
      prev = e.hash;
    }
    return { valid: true, firstInvalidIndex: null };
  }

  getChainSegment(fromIndex: number, toIndex: number): AuditChainEntry[] {
    return this.chain.slice(fromIndex, toIndex + 1);
  }

  getChainLength(): number {
    return this.chain.length;
  }
}
