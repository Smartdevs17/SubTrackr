import { HashChainService } from '../domain/HashChainService';
import { AuditWriter, AuditEventInput } from '../domain/AuditWriter';
import { BlockchainAnchor } from '../domain/BlockchainAnchor';

export interface AuditQueryFilter {
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  from?: number;
  to?: number;
  page?: number;
  limit?: number;
}

export interface AuditQueryResult {
  data: unknown[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface AuditVerificationResult {
  valid: boolean;
  firstInvalidIndex: number | null;
  checkedEntries: number;
  anchoredEntries: number;
  lastAnchoredAt: number | null;
}

export class AuditController {
  constructor(
    private chain: HashChainService,
    private writer: AuditWriter,
    private anchor: BlockchainAnchor,
  ) {}

  async record(input: AuditEventInput): Promise<unknown> {
    return this.writer.write(input);
  }

  async query(filter: AuditQueryFilter): Promise<AuditQueryResult> {
    let events = [...this.chain.getChain()];
    if (filter.actorId) {
      events = events.filter((e) => e.actorId === filter.actorId);
    }
    if (filter.action) {
      events = events.filter((e) => e.action === filter.action);
    }
    if (filter.resourceType) {
      events = events.filter((e) => e.resourceType === filter.resourceType);
    }
    if (filter.resourceId) {
      events = events.filter((e) => e.resourceId === filter.resourceId);
    }
    if (filter.from) {
      events = events.filter((e) => e.timestamp >= filter.from!);
    }
    if (filter.to) {
      events = events.filter((e) => e.timestamp <= filter.to!);
    }
    events.sort((a, b) => b.timestamp - a.timestamp);

    const page = filter.page ?? 1;
    const limit = filter.limit ?? 50;
    const total = events.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const data = events.slice(start, start + limit);

    return { data, meta: { page, limit, total, totalPages } };
  }

  async verify(): Promise<AuditVerificationResult> {
    const result = this.chain.verify();
    const lastAnchor = this.anchor.getLastAnchor();
    return {
      valid: result.valid,
      firstInvalidIndex: result.firstInvalidIndex,
      checkedEntries: this.chain.getChainLength(),
      anchoredEntries: this.anchor.getAnchorCount(),
      lastAnchoredAt: lastAnchor?.anchoredAt ?? null,
    };
  }
}
