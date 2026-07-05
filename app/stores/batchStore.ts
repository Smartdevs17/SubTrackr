// ════════════════════════════════════════════════════════════════
// BATCH STORE - Full client state for bulk subscription operations
// ════════════════════════════════════════════════════════════════
//
// Supports: batch create from CSV/JSON, batch update with filtering,
// batch cancel with reason collection, batch charge for manual billing,
// per-item status tracking, idempotent retry, result export, and
// audit history of past batches.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../../src/utils/storage';
import {
  BatchTransactionService,
  BatchOperationType,
  BatchState,
  BatchExecutionResult,
  PerItemResult,
  CancelReason,
  UpdateFilter,
  BatchUpdateParams,
  BatchCreateInput,
  PerItemStatus,
  BatchProgress,
  BatchHistoryEntry,
  parseBatchCreateCsv,
  parseBatchCancelCsv,
  parseBatchChargeCsv,
  exportBatchResultToJson,
  exportBatchResultToCsv,
  getBatchHistory,
  saveBatchHistory,
  clearBatchHistory,
} from '../services/batchTransactionService';

const HISTORY_STORE_KEY = 'subtrackr-batch-store-history';
const MAX_STORE_HISTORY = 100;

// ════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════

export type { BatchOperationType, BatchState, PerItemStatus, CancelReason, UpdateFilter, BatchUpdateParams, BatchCreateInput, PerItemResult, BatchProgress, BatchHistoryEntry };
export { exportBatchResultToJson, exportBatchResultToCsv, getBatchHistory, saveBatchHistory, clearBatchHistory };

export interface BatchDraft {
  operationType: BatchOperationType;
  atomic: boolean;
  createInputs: BatchCreateInput[];
  updateIds: string[];
  updateParams: BatchUpdateParams;
  updateFilter?: UpdateFilter;
  cancelIds: string[];
  cancelReasons: CancelReason[];
  chargeItems: Array<{ subscriptionId: string; amount: number }>;
  csvContent: string;
  chunkSize: number;
}

export type ItemExecutor = (
  operationType: BatchOperationType,
  subscriptionId: string,
  param: number | string,
  reason?: CancelReason,
) => Promise<{ success: boolean; id?: string; error?: string }>;

const MAX_BATCH_SIZE = 500;
const DEFAULT_CHUNK_SIZE = 50;

export const estimateBatchGas = (count: number): number => 50_000 + count * 100_000;

export const validateBatchSize = (count: number): boolean =>
  count > 0 && count <= MAX_BATCH_SIZE;

// ════════════════════════════════════════════════════════════════
// Store
// ════════════════════════════════════════════════════════════════

interface BatchStoreState {
  draft: BatchDraft;
  currentResult: BatchExecutionResult | null;
  history: BatchHistoryEntry[];
  service: BatchTransactionService | null;
  executor: ItemExecutor;
  isRunning: boolean;
  progress: BatchProgress | null;

  // Actions
  setExecutor: (executor: ItemExecutor) => void;
  setDraft: (patch: Partial<BatchDraft>) => void;
  setOperationType: (op: BatchOperationType) => void;
  toggleAtomic: () => void;
  setChunkSize: (size: number) => void;

  // CSV loading
  loadCreateCsv: (csv: string) => void;
  loadCancelCsv: (csv: string) => void;
  loadChargeCsv: (csv: string) => void;
  loadUpdateCsv: (csv: string) => void;
  setCsvContent: (csv: string) => void;

  // Execute
  executeBatch: () => Promise<BatchExecutionResult | null>;
  retryFailed: () => Promise<BatchExecutionResult | null>;

  // Export
  exportResultJson: () => string | null;
  exportResultCsv: () => string | null;

  // History
  loadHistory: () => Promise<void>;
  addHistoryEntry: (entry: BatchHistoryEntry) => Promise<void>;

  // Helpers
  gasEstimate: () => number;
  resetDraft: () => void;
  clearResult: () => void;
}

const emptyDraft = (): BatchDraft => ({
  operationType: 'create',
  atomic: false,
  createInputs: [],
  updateIds: [],
  updateParams: {},
  updateFilter: undefined,
  cancelIds: [],
  cancelReasons: [],
  chargeItems: [],
  csvContent: '',
  chunkSize: DEFAULT_CHUNK_SIZE,
});

const defaultExecutor: ItemExecutor = async (_op, subscriptionId) => ({
  subscriptionId,
  success: true,
});

export const useBatchStore = create<BatchStoreState>()(
  persist(
    (set, get) => ({
      draft: emptyDraft(),
      currentResult: null,
      history: [],
      service: null,
      executor: defaultExecutor,
      isRunning: false,
      progress: null,

  setExecutor: (executor) => set({ executor }),

  setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),

  setOperationType: (op) =>
    set((s) => ({
      draft: { ...s.draft, operationType: op, csvContent: '' },
    })),

  toggleAtomic: () =>
    set((s) => ({ draft: { ...s.draft, atomic: !s.draft.atomic } })),

  setChunkSize: (size) =>
    set((s) => ({
      draft: { ...s.draft, chunkSize: Math.min(size, MAX_BATCH_SIZE) },
    })),

  // ── CSV Loading ──────────────────────────────────────────────

  setCsvContent: (csv) => set((s) => ({ draft: { ...s.draft, csvContent: csv } })),

  loadCreateCsv: (csv) => {
    const inputs = parseBatchCreateCsv(csv);
    set((s) => ({
      draft: {
        ...s.draft,
        csvContent: csv,
        operationType: 'create',
        createInputs: inputs,
      },
    }));
  },

  loadCancelCsv: (csv) => {
    const parsed = parseBatchCancelCsv(csv);
    const ids = parsed.map((r) => r.subscriptionId);
    const reasons: CancelReason[] = parsed.map((r) => ({
      subscriptionId: r.subscriptionId,
      reason: (['too_expensive', 'no_longer_needed', 'found_alternative', 'poor_service', 'other'].includes(r.reason)
        ? r.reason
        : 'other') as CancelReason['reason'],
      notes: r.notes,
    }));
    set((s) => ({
      draft: {
        ...s.draft,
        csvContent: csv,
        operationType: 'cancel',
        cancelIds: ids,
        cancelReasons: reasons,
      },
    }));
  },

  loadChargeCsv: (csv) => {
    const items = parseBatchChargeCsv(csv);
    set((s) => ({
      draft: {
        ...s.draft,
        csvContent: csv,
        operationType: 'charge',
        chargeItems: items,
      },
    }));
  },

  loadUpdateCsv: (csv) => {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return;
    const ids: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const id = lines[i].split(',')[0]?.trim();
      if (id) ids.push(id);
    }
    set((s) => ({
      draft: {
        ...s.draft,
        csvContent: csv,
        operationType: 'update',
        updateIds: ids,
      },
    }));
  },

  // ── Execute ──────────────────────────────────────────────────

  executeBatch: async () => {
    const { draft, executor } = get();
    const service = new BatchTransactionService(draft.chunkSize);
    set({ isRunning: true, currentResult: null, progress: null });

    let result: BatchExecutionResult | null = null;

    try {
      switch (draft.operationType) {
        case 'create': {
          if (draft.createInputs.length === 0) break;
          result = await service.executeBatchCreate(
            draft.createInputs,
            async (input) => {
              const r = await executor('create', input.name, input.price);
              return r;
            },
            { atomic: draft.atomic },
          );
          break;
        }

        case 'update': {
          if (draft.updateIds.length === 0) break;
          result = await service.executeBatchUpdate(
            draft.updateIds,
            draft.updateParams,
            async (id, updates) => {
              const r = await executor('update', id, JSON.stringify(updates));
              return r;
            },
            { atomic: draft.atomic, filter: draft.updateFilter },
          );
          break;
        }

        case 'cancel': {
          if (draft.cancelIds.length === 0) break;
          result = await service.executeBatchCancel(
            draft.cancelIds,
            draft.cancelReasons,
            async (id, reason) => {
              const r = await executor('cancel', id, reason.reason, reason);
              return r;
            },
            { atomic: draft.atomic },
          );
          break;
        }

        case 'charge': {
          if (draft.chargeItems.length === 0) break;
          result = await service.executeBatchCharge(
            draft.chargeItems,
            async (id, amount) => {
              const r = await executor('charge', id, amount);
              return r;
            },
            { atomic: draft.atomic },
          );
          break;
        }
      }
    } catch (err) {
      console.error('Batch execution error:', err);
    }

    set((s) => ({
      currentResult: result,
      isRunning: false,
      progress: service.getProgress(),
      service,
    }));

    if (result) {
      const entry: BatchHistoryEntry = {
        batchId: result.batchId,
        operationType: result.operationType,
        state: result.state,
        totalItems: result.totalItems,
        successfulItems: result.successfulItems,
        failedItems: result.failedItems,
        timestamp: new Date().toISOString(),
        summary: `${result.operationType}: ${result.successfulItems}/${result.totalItems} succeeded`,
      };
      await get().addHistoryEntry(entry);
    }

    return result;
  },

  // ── Retry ────────────────────────────────────────────────────

  retryFailed: async () => {
    const { service, currentResult, executor } = get();
    if (!service || !currentResult) return null;

    set({ isRunning: true });

    const result = await service.retryFailedItems(async (item) => {
      const r = await executor(
        currentResult.operationType,
        item.subscriptionId,
        0,
        item.cancelReason,
      );
      return r;
    });

    set((s) => ({
      currentResult: result,
      isRunning: false,
      progress: service.getProgress(),
    }));

    return result;
  },

  // ── Export ───────────────────────────────────────────────────

  exportResultJson: () => {
    const { currentResult } = get();
    if (!currentResult) return null;
    return exportBatchResultToJson(currentResult);
  },

  exportResultCsv: () => {
    const { currentResult } = get();
    if (!currentResult) return null;
    return exportBatchResultToCsv(currentResult);
  },

  // ── History ──────────────────────────────────────────────────

  loadHistory: async () => {
    // Automatically handled by persist middleware
  },

  addHistoryEntry: async (entry) => {
    set((s) => {
      const next = [entry, ...s.history].slice(0, MAX_STORE_HISTORY);
      return { history: next };
    });
  },

  // ── Helpers ─────────────────────────────────────────────────

  gasEstimate: () => {
    const { draft } = get();
    const count =
      draft.createInputs.length ||
      draft.updateIds.length ||
      draft.cancelIds.length ||
      draft.chargeItems.length ||
      0;
    return estimateBatchGas(count);
  },

  resetDraft: () =>
    set({
      draft: emptyDraft(),
      currentResult: null,
      progress: null,
    }),

  clearResult: () =>
    set({
      currentResult: null,
      progress: null,
    }),
    }),
    {
      name: HISTORY_STORE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        history: state.history,
      }),
      merge: (persistedState: any, currentState) => {
        if (Array.isArray(persistedState)) {
          return {
            ...currentState,
            history: persistedState.slice(0, MAX_STORE_HISTORY),
          };
        }
        if (persistedState && typeof persistedState === 'object') {
          return {
            ...currentState,
            ...persistedState,
          };
        }
        return currentState;
      },
    }
  )
);
