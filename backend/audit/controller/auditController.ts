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

export interface AuditExportResult {
  format: 'csv' | 'json';
  contentType: 'text/csv' | 'application/json';
  filename: string;
  content: string;
  count: number;
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

  /** Export all events matching the audit filters in an auditor-friendly format. */
  async exportReport(
    filter: Omit<AuditQueryFilter, 'page' | 'limit'>,
    format: 'csv' | 'json',
  ): Promise<AuditExportResult> {
    const result = await this.query({ ...filter, page: 1, limit: Number.MAX_SAFE_INTEGER });
    const events = result.data as Array<{
      id: string;
      actorId: string;
      action: string;
      resourceType: string;
      resourceId: string;
      timestamp: number;
      metadata: Record<string, unknown>;
    }>;
    const date = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      const rows = events.map((event) => ({
        ...event,
        occurredAt: new Date(event.timestamp).toISOString(),
      }));
      return {
        format,
        contentType: 'application/json',
        filename: `audit-report-${date}.json`,
        content: JSON.stringify(rows, null, 2),
        count: rows.length,
      };
    }

    const escape = (value: unknown): string =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = ['id', 'actor_id', 'occurred_at', 'action', 'resource_type', 'resource_id', 'metadata'];
    const rows = events.map((event) =>
      [
        event.id,
        event.actorId,
        new Date(event.timestamp).toISOString(),
        event.action,
        event.resourceType,
        event.resourceId,
        JSON.stringify(event.metadata),
      ].map(escape).join(','),
    );
    return {
      format,
      contentType: 'text/csv',
      filename: `audit-report-${date}.csv`,
      content: [header.join(','), ...rows].join('\n'),
      count: rows.length,
    };
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
