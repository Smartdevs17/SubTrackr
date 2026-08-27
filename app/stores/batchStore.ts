// ════════════════════════════════════════════════════════════════
// BATCH STORE - Full client state for bulk subscription operations
// ════════════════════════════════════════════════════════════════
//
// Supports: batch create from CSV/JSON, batch update with filtering,
// batch cancel with reason collection, batch charge for manual billing,
// per-item status tracking, atomic execution, post-commit rollback,
// idempotent retry, per-operation-type configuration, success/timing
// analytics, result export, and audit history of past batches.

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
  BatchOperationConfig,
  BatchAnalytics,
  BatchAnalyticsSummary,
  BatchRollbackResult,
  BatchSizeValidation,
  RollbackHandler,
  DEFAULT_BATCH_CONFIGS,
  computeBatchAnalytics,
  getDefaultBatchConfig,
  validateBatchSizeFor,
  toHistoryEntry,
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

export type {
  BatchOperationType,
  BatchState,
  PerItemStatus,
  CancelReason,
  UpdateFilter,
  BatchUpdateParams,
  BatchCreateInput,
  PerItemResult,
  BatchProgress,
  BatchHistoryEntry,
  BatchOperationConfig,
  BatchAnalytics,
  BatchAnalyticsSummary,
  BatchRollbackResult,
  BatchSizeValidation,
  RollbackHandler,
};
export {
  exportBatchResultToJson,
  exportBatchResultToCsv,
  getBatchHistory,
  saveBatchHistory,
  clearBatchHistory,
  computeBatchAnalytics,
  getDefaultBatchConfig,
  validateBatchSizeFor,
  DEFAULT_BATCH_CONFIGS,
};

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

export const validateBatchSize = (count: number): boolean => count > 0 && count <= MAX_BATCH_SIZE;

// ════════════════════════════════════════════════════════════════
// Store
// ════════════════════════════════════════════════════════════════

interface BatchStoreState {
  draft: BatchDraft;
  currentResult: BatchExecutionResult | null;
  history: BatchHistoryEntry[];
  configs: Record<BatchOperationType, BatchOperationConfig>;
  service: BatchTransactionService | null;
  executor: ItemExecutor;
  rollbackHandler: RollbackHandler | null;
  isRunning: boolean;
  progress: BatchProgress | null;

  // Actions
  setExecutor: (executor: ItemExecutor) => void;
  setRollbackHandler: (handler: RollbackHandler | null) => void;
  setDraft: (patch: Partial<BatchDraft>) => void;
  setOperationType: (op: BatchOperationType) => void;
  toggleAtomic: () => void;
  setChunkSize: (size: number) => void;

  // Configuration
  setOperationConfig: (op: BatchOperationType, patch: Partial<BatchOperationConfig>) => void;
  resetOperationConfig: (op: BatchOperationType) => void;
  activeConfig: () => BatchOperationConfig;

  // CSV loading
  loadCreateCsv: (csv: string) => void;
  loadCancelCsv: (csv: string) => void;
  loadChargeCsv: (csv: string) => void;
  loadUpdateCsv: (csv: string) => void;
  setCsvContent: (csv: string) => void;

  // Execute
  executeBatch: () => Promise<BatchExecutionResult | null>;
  retryFailed: () => Promise<BatchExecutionResult | null>;
  rollbackBatch: () => Promise<BatchRollbackResult | null>;
  canRollback: () => boolean;

  // Export
  exportResultJson: () => string | null;
  exportResultCsv: () => string | null;

  // History & analytics
  loadHistory: () => Promise<void>;
  addHistoryEntry: (entry: BatchHistoryEntry) => Promise<void>;
  clearHistory: () => Promise<void>;
  analytics: () => BatchAnalytics;

  // Helpers
  gasEstimate: () => number;
  itemCount: () => number;
  validateDraft: () => BatchSizeValidation;
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

const defaultConfigs = (): Record<BatchOperationType, BatchOperationConfig> => ({
  create: getDefaultBatchConfig('create'),
  update: getDefaultBatchConfig('update'),
  charge: getDefaultBatchConfig('charge'),
  cancel: getDefaultBatchConfig('cancel'),
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
      configs: defaultConfigs(),
      service: null,
      executor: defaultExecutor,
      rollbackHandler: null,
      isRunning: false,
      progress: null,

      setExecutor: (executor) => set({ executor }),

      setRollbackHandler: (rollbackHandler) => set({ rollbackHandler }),

      setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),

      setOperationType: (op) =>
        set((s) => ({
          draft: { ...s.draft, operationType: op, csvContent: '' },
        })),

      toggleAtomic: () => set((s) => ({ draft: { ...s.draft, atomic: !s.draft.atomic } })),

      setChunkSize: (size) =>
        set((s) => ({
          draft: { ...s.draft, chunkSize: Math.min(size, MAX_BATCH_SIZE) },
        })),

      // ── Configuration ────────────────────────────────────────────

      setOperationConfig: (op, patch) =>
        set((s) => ({
          configs: { ...s.configs, [op]: { ...s.configs[op], ...patch } },
        })),

      resetOperationConfig: (op) =>
        set((s) => ({
          configs: { ...s.configs, [op]: getDefaultBatchConfig(op) },
        })),

      activeConfig: () => {
        const { draft, configs } = get();
        return configs[draft.operationType] ?? getDefaultBatchConfig(draft.operationType);
      },

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
          reason: ([
            'too_expensive',
            'no_longer_needed',
            'found_alternative',
            'poor_service',
            'other',
          ].includes(r.reason)
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
        const { draft, executor, configs } = get();
        const service = new BatchTransactionService();
        // The draft's chunk size is the operator's live choice, so it wins over
        // the stored per-operation default.
        service.setOperationConfig(draft.operationType, {
          ...(configs[draft.operationType] ?? {}),
          chunkSize: draft.chunkSize,
        });
        set({ isRunning: true, currentResult: null, progress: null });

        let result: BatchExecutionResult | null = null;

        try {
          switch (draft.operationType) {
            case 'create': {
              if (draft.createInputs.length === 0) break;
              result = await service.executeBatchCreate(
                draft.createInputs,
                (input) => executor('create', input.name, input.price),
                { atomic: draft.atomic },
              );
              break;
            }

            case 'update': {
              if (draft.updateIds.length === 0) break;
              result = await service.executeBatchUpdate(
                draft.updateIds,
                draft.updateParams,
                (id, updates) => executor('update', id, JSON.stringify(updates)),
                { atomic: draft.atomic, filter: draft.updateFilter },
              );
              break;
            }

            case 'cancel': {
              if (draft.cancelIds.length === 0) break;
              result = await service.executeBatchCancel(
                draft.cancelIds,
                draft.cancelReasons,
                (id, reason) => executor('cancel', id, reason.reason, reason),
                { atomic: draft.atomic },
              );
              break;
            }

            case 'charge': {
              if (draft.chargeItems.length === 0) break;
              result = await service.executeBatchCharge(
                draft.chargeItems,
                (id, amount) => executor('charge', id, amount),
                { atomic: draft.atomic },
              );
              break;
            }
          }
        } catch (err) {
          console.error('Batch execution error:', err);
        }

        set({
          currentResult: result,
          isRunning: false,
          progress: service.getProgress(),
          service,
        });

        if (result) {
          await get().addHistoryEntry(toHistoryEntry(result));
        }

        return result;
      },

      // ── Retry ────────────────────────────────────────────────────

      retryFailed: async () => {
        const { service, currentResult, executor } = get();
        if (!service || !currentResult) return null;

        set({ isRunning: true });

        const result = await service.retryFailedItems((item) =>
          executor(currentResult.operationType, item.subscriptionId, 0, item.cancelReason),
        );

        set({
          currentResult: result,
          isRunning: false,
          progress: service.getProgress(),
        });

        return result;
      },

      // ── Rollback ─────────────────────────────────────────────────

      canRollback: () => {
        const { service } = get();
        return service?.canRollback() ?? false;
      },

      rollbackBatch: async () => {
        const { service, rollbackHandler } = get();
        if (!service || !rollbackHandler) return null;

        set({ isRunning: true });
        const rollback = await service.rollbackBatch(rollbackHandler);
        const result = service.getLastResult();

        set({
          currentResult: result,
          isRunning: false,
          progress: service.getProgress(),
        });

        if (rollback && result) {
          await get().addHistoryEntry(toHistoryEntry(result));
        }

        return rollback;
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

      // ── History & analytics ──────────────────────────────────────

      loadHistory: async () => {
        // Automatically handled by persist middleware
      },

      addHistoryEntry: async (entry) => {
        set((s) => {
          // Rollback re-records the same batch, so replace rather than duplicate.
          const withoutBatch = s.history.filter((e) => e.batchId !== entry.batchId);
          return { history: [entry, ...withoutBatch].slice(0, MAX_STORE_HISTORY) };
        });
      },

      clearHistory: async () => {
        set({ history: [] });
        await clearBatchHistory();
      },

      analytics: () => computeBatchAnalytics(get().history),

      // ── Helpers ─────────────────────────────────────────────────

      itemCount: () => {
        const { draft } = get();
        switch (draft.operationType) {
          case 'create':
            return draft.createInputs.length;
          case 'update':
            return draft.updateIds.length;
          case 'cancel':
            return draft.cancelIds.length;
          case 'charge':
            return draft.chargeItems.length;
          default:
            return 0;
        }
      },

      validateDraft: () => {
        const { draft } = get();
        return validateBatchSizeFor(draft.operationType, get().itemCount(), get().activeConfig());
      },

      gasEstimate: () => estimateBatchGas(get().itemCount()),

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
        configs: state.configs,
      }),
      merge: (persistedState: unknown, currentState) => {
        if (Array.isArray(persistedState)) {
          return {
            ...currentState,
            history: persistedState.slice(0, MAX_STORE_HISTORY),
          };
        }
        if (persistedState && typeof persistedState === 'object') {
          const persisted = persistedState as Partial<BatchStoreState>;
          return {
            ...currentState,
            ...persisted,
            // Persisted configs may predate a new field, so merge over defaults.
            configs: {
              ...currentState.configs,
              ...(persisted.configs ?? {}),
            },
          };
        }
        return currentState;
      },
    },
  ),
);
