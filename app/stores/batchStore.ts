/**
 * batchStore.ts — Legacy adapter for the batch slice.
 *
 * Batch state and actions now live in the slices-pattern root store
 * (src/store/slices/batchSlice.ts, Issue #944) and are exposed through
 * the combined `useAppStore`. This adapter keeps existing consumers
 * (`useBatchStore`) working without changes.
 *
 * The combined store keeps the transaction slice's `clearHistory` action and
 * exposes the batch one as `clearBatchHistory`. This module re-exposes it
 * under the legacy `clearHistory` name on the combined handle so the batch
 * tests keep working.
 */
import { useAppStore } from '../../src/store/slices';
import type { AppState } from '../../src/store/slices';

useAppStore.setState({
  clearHistory: () => useAppStore.getState().clearBatchHistory(),
} as Partial<AppState>);

export { useAppStore as useBatchStore } from '../../src/store/slices';

export type {
  BatchSlice,
  BatchStoreState,
  BatchDraft,
  ItemExecutor,
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
} from '../../src/store/slices';

export {
  estimateBatchGas,
  validateBatchSize,
  exportBatchResultToJson,
  exportBatchResultToCsv,
  getBatchHistory,
  saveBatchHistory,
  clearPersistedBatchHistory as clearBatchHistory,
  computeBatchAnalytics,
  getDefaultBatchConfig,
  validateBatchSizeFor,
  DEFAULT_BATCH_CONFIGS,
} from '../../src/store/slices';