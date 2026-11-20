/**
 * Append-only sync event log. It is the source of truth for server-side CRDT
 * state: entity states are projections folded from these events (see
 * `projection.ts`), so any state can be rebuilt by replaying the log.
 */

import type { CRDTOperation, EntityCRDTState } from '../../shared/types/crdt';

export type SyncEvent =
  | { seq: number; kind: 'op'; entityId: string; nodeId: string; recordedAt: string; op: CRDTOperation }
  | {
      seq: number;
      kind: 'snapshot';
      entityId: string;
      nodeId: string;
      recordedAt: string;
      state: EntityCRDTState;
    };

export type NewSyncEvent =
  | { kind: 'op'; op: CRDTOperation }
  | { kind: 'snapshot'; nodeId: string; state: EntityCRDTState };

export interface AppendResult {
  event: SyncEvent;
  /** True when an op with the same id was already in the log; nothing was appended. */
  duplicate: boolean;
}

export interface SyncEventLog {
  /** Append an event. Ops are idempotent on `op.id`. */
  append(event: NewSyncEvent): AppendResult;
  /** Events with `seq > afterSeq`, in order. */
  readSince(afterSeq: number): SyncEvent[];
  /** Events for one entity with `seq > afterSeq`, in order. */
  readEntity(entityId: string, afterSeq?: number): SyncEvent[];
  /** Sequence number of the latest event (0 when empty). */
  head(): number;
}

/** In-process implementation. A database-backed log implements the same interface. */
export class InMemorySyncEventLog implements SyncEventLog {
  private readonly events: SyncEvent[] = [];
  private readonly byEntity = new Map<string, SyncEvent[]>();
  private readonly byOpId = new Map<string, SyncEvent>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  append(input: NewSyncEvent): AppendResult {
    if (input.kind === 'op') {
      const existing = this.byOpId.get(input.op.id);
      if (existing) return { event: existing, duplicate: true };
    }

    const base = { seq: this.events.length + 1, recordedAt: this.now().toISOString() };
    const event: SyncEvent =
      input.kind === 'op'
        ? { ...base, kind: 'op', entityId: input.op.entityId, nodeId: input.op.nodeId, op: structuredClone(input.op) }
        : {
            ...base,
            kind: 'snapshot',
            entityId: input.state.entityId,
            nodeId: input.nodeId,
            state: structuredClone(input.state),
          };

    this.events.push(event);
    const forEntity = this.byEntity.get(event.entityId) ?? [];
    forEntity.push(event);
    this.byEntity.set(event.entityId, forEntity);
    if (event.kind === 'op') this.byOpId.set(event.op.id, event);
    return { event, duplicate: false };
  }

  readSince(afterSeq: number): SyncEvent[] {
    return this.events.slice(Math.max(0, afterSeq));
  }

  readEntity(entityId: string, afterSeq = 0): SyncEvent[] {
    return (this.byEntity.get(entityId) ?? []).filter((event) => event.seq > afterSeq);
  }

  head(): number {
    return this.events.length;
  }
}
