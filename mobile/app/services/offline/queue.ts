/**
 * CRDT Offline Mutation Queue
 *
 * Replaces the raw FIFO transaction queue with CRDT-wrapped operations.
 * Each mutation is wrapped in a CRDTOperation so that concurrent edits
 * to the same entity field converge correctly on sync, regardless of
 * replay order.
 *
 * Backward compatibility:
 *   Legacy `QueuedTransaction` entries found in AsyncStorage during
 *   `migrateFromLegacyQueue()` are converted to CRDT operations using
 *   the 'lww_set' type so they are not lost on the first sync.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CRDTOperation, CRDTConflict, EntityCRDTState } from '../../../../shared/types/crdt';
import CRDTService from './crdtService';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MutationStatus =
  | 'pending'      // waiting to sync
  | 'syncing'      // in-flight to server
  | 'synced'       // successfully applied on server
  | 'conflict';    // needs user resolution

export interface OfflineMutation {
  id: string;
  entityId: string;
  entityType: string;
  /** Human-readable label for conflict UI. */
  label: string;
  status: MutationStatus;
  crdtOperationId: string;
  createdAt: number;
  syncedAt?: number;
  conflictInfo?: CRDTConflict;
}

export interface QueueStats {
  pending: number;
  syncing: number;
  conflicted: number;
  total: number;
}

// ── Legacy migration ──────────────────────────────────────────────────────────

const LEGACY_QUEUE_KEY = 'subtrackr-transaction-queue';
const MUTATION_QUEUE_KEY = 'subtrackr-offline-mutations';

interface LegacyQueuedTransaction {
  id: string;
  conflictKey: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export class OfflineMutationQueue {
  private static instance: OfflineMutationQueue | null = null;

  private mutations: Map<string, OfflineMutation> = new Map();
  private crdtService: CRDTService;
  private listeners: Set<() => void> = new Set();
  private initialized = false;

  private constructor(nodeId: string) {
    this.crdtService = CRDTService.getInstance(nodeId);
  }

  static getInstance(nodeId?: string): OfflineMutationQueue {
    if (!OfflineMutationQueue.instance) {
      if (!nodeId) throw new Error('nodeId required on first call');
      OfflineMutationQueue.instance = new OfflineMutationQueue(nodeId);
    }
    return OfflineMutationQueue.instance;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.crdtService.initialize();
    await this.loadPersistedMutations();
    await this.migrateFromLegacyQueue();
    this.initialized = true;
  }

  private async loadPersistedMutations(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(MUTATION_QUEUE_KEY);
      if (raw) {
        const items = JSON.parse(raw) as OfflineMutation[];
        for (const item of items) {
          this.mutations.set(item.id, item);
        }
      }
    } catch {
      // Start fresh on parse failure
    }
  }

  private async persistMutations(): Promise<void> {
    try {
      const items = Array.from(this.mutations.values());
      await AsyncStorage.setItem(MUTATION_QUEUE_KEY, JSON.stringify(items));
    } catch {
      // Non-fatal
    }
  }

  /**
   * Migrate legacy FIFO transactions to CRDT operations.
   * Runs once on first launch after upgrade; clears the old queue key.
   */
  async migrateFromLegacyQueue(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(LEGACY_QUEUE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as { queuedTransactions?: LegacyQueuedTransaction[] };
      const legacy = parsed.queuedTransactions ?? [];

      for (const tx of legacy) {
        const entityId = tx.conflictKey ?? tx.id;
        // Migrate each payload field as a separate LWW operation
        for (const [field, value] of Object.entries(tx.payload)) {
          this.enqueue({
            entityId,
            entityType: 'transaction',
            field,
            type: 'lww_set',
            value,
            label: `Migrated transaction field: ${field}`,
          });
        }
      }

      // Remove the old queue so migration only runs once
      await AsyncStorage.removeItem(LEGACY_QUEUE_KEY);
    } catch {
      // Legacy migration is best-effort
    }
  }

  // ── Enqueueing ────────────────────────────────────────────────────────────

  enqueue(params: {
    entityId: string;
    entityType: string;
    field: string;
    type: CRDTOperation['type'];
    value: unknown;
    label: string;
    tag?: string;
  }): OfflineMutation {
    const state = this.crdtService.applyOperation({
      entityId: params.entityId,
      field: params.field,
      type: params.type,
      payload: params.value,
      tag: params.tag,
    });

    const pending = this.crdtService.getPendingOperations();
    const op = pending[pending.length - 1];

    const mutation: OfflineMutation = {
      id: op.id,
      entityId: params.entityId,
      entityType: params.entityType,
      label: params.label,
      status: 'pending',
      crdtOperationId: op.id,
      createdAt: Date.now(),
    };

    this.mutations.set(mutation.id, mutation);
    void this.persistMutations();
    this.notify();
    return mutation;
  }

  // ── Syncing ───────────────────────────────────────────────────────────────

  /**
   * Flush all pending mutations to the server sync endpoint.
   * Conflict results are stored in the mutation for UI display.
   */
  async flush(syncEndpoint: string): Promise<CRDTConflict[]> {
    await this.initialize();

    // Mark all pending as syncing
    for (const [id, mutation] of this.mutations) {
      if (mutation.status === 'pending') {
        this.mutations.set(id, { ...mutation, status: 'syncing' });
      }
    }
    this.notify();

    let conflicts: CRDTConflict[] = [];
    try {
      conflicts = await this.crdtService.sync(syncEndpoint);

      // Mark synced
      const now = Date.now();
      for (const [id, mutation] of this.mutations) {
        if (mutation.status === 'syncing') {
          this.mutations.set(id, { ...mutation, status: 'synced', syncedAt: now });
        }
      }

      // Attach conflict info to relevant mutations
      for (const conflict of conflicts) {
        for (const [id, mutation] of this.mutations) {
          if (mutation.entityId === conflict.entityId) {
            this.mutations.set(id, { ...mutation, status: 'conflict', conflictInfo: conflict });
          }
        }
      }
    } catch (err) {
      // Revert syncing → pending
      for (const [id, mutation] of this.mutations) {
        if (mutation.status === 'syncing') {
          this.mutations.set(id, { ...mutation, status: 'pending' });
        }
      }
      throw err;
    } finally {
      await this.persistMutations();
      this.notify();
    }

    return conflicts;
  }

  // ── Querying ──────────────────────────────────────────────────────────────

  getAll(): OfflineMutation[] {
    return Array.from(this.mutations.values());
  }

  getPending(): OfflineMutation[] {
    return this.getAll().filter((m) => m.status === 'pending');
  }

  getConflicts(): OfflineMutation[] {
    return this.getAll().filter((m) => m.status === 'conflict');
  }

  getStats(): QueueStats {
    const all = this.getAll();
    return {
      pending: all.filter((m) => m.status === 'pending').length,
      syncing: all.filter((m) => m.status === 'syncing').length,
      conflicted: all.filter((m) => m.status === 'conflict').length,
      total: all.length,
    };
  }

  getEntityState(entityId: string): EntityCRDTState | undefined {
    return this.crdtService.getEntity(entityId);
  }

  // ── Conflict resolution ───────────────────────────────────────────────────

  resolveConflict(mutationId: string, resolvedValue: unknown): void {
    const mutation = this.mutations.get(mutationId);
    if (!mutation || mutation.status !== 'conflict' || !mutation.conflictInfo) return;

    const { entityId, field } = mutation.conflictInfo;
    this.crdtService.setField(entityId, field, resolvedValue);

    this.mutations.set(mutationId, {
      ...mutation,
      status: 'pending',
      conflictInfo: undefined,
    });

    void this.persistMutations();
    this.notify();
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  clearSynced(): void {
    for (const [id, mutation] of this.mutations) {
      if (mutation.status === 'synced') {
        this.mutations.delete(id);
      }
    }
    void this.persistMutations();
    this.notify();
  }
}
