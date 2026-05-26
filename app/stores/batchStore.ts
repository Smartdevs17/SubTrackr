// ════════════════════════════════════════════════════════════════
// BATCH STORE - client state for bulk subscription operations
// ════════════════════════════════════════════════════════════════
//
// Mirrors the `subtrackr-batch` Soroban contract: the user assembles a batch of
// one operation type applied across many subscriptions, then creates + executes
// it. The store tracks progress, partial success, rollback (atomic), and keeps
// an audit history of past batches.

import { create } from 'zustand';

export type OperationType = 'create' | 'update' | 'charge' | 'pause' | 'resume' | 'cancel';

export type BatchState = 'pending' | 'running' | 'completed' | 'partial' | 'failed';

export interface BatchOperation {
  operationType: OperationType;
  subscriptionIds: string[];
  /** Per-subscription scalar argument (e.g. charge amount); missing entries default to 0. */
  params: number[];
  atomic: boolean;
}

export interface OperationResult {
  subscriptionId: string;
  success: boolean;
  message?: string;
}

export interface BatchRecord {
  id: string;
  operation: BatchOperation;
  state: BatchState;
  total: number;
  succeeded: number;
  failed: number;
  rolledBack: boolean;
  results: OperationResult[];
  createdAt: number;
}

/** Executes a single item; resolves a result. Injected so the store can be
 * backed by the contract, an API, or a mock in tests. Defaults to a no-op
 * success so the UI is usable without a backend. */
export type ItemExecutor = (
  op: OperationType,
  subscriptionId: string,
  param: number,
) => Promise<OperationResult>;

const MAX_BATCH_SIZE = 100;
const BASE_GAS = 50_000;
const GAS_PER_OP = 100_000;

export const estimateBatchGas = (count: number): number => BASE_GAS + count * GAS_PER_OP;

export const validateBatch = (op: BatchOperation): boolean =>
  op.subscriptionIds.length > 0 && op.subscriptionIds.length <= MAX_BATCH_SIZE;

/** Builds a batch operation from a CSV template of `subscriptionId,param` rows. */
export const parseCsvTemplate = (
  csv: string,
  operationType: OperationType,
  atomic = false,
): BatchOperation => {
  const subscriptionIds: string[] = [];
  const params: number[] = [];
  csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.toLowerCase().startsWith('subscription'))
    .forEach((line) => {
      const [id, param] = line.split(',').map((c) => c.trim());
      if (!id) return;
      subscriptionIds.push(id);
      params.push(param ? Number(param) : 0);
    });
  return { operationType, subscriptionIds, params, atomic };
};

interface BatchStoreState {
  draft: BatchOperation;
  current?: BatchRecord;
  history: BatchRecord[];
  executor: ItemExecutor;

  setExecutor: (executor: ItemExecutor) => void;
  setDraft: (patch: Partial<BatchOperation>) => void;
  loadFromCsv: (csv: string, operationType: OperationType, atomic?: boolean) => void;
  resetDraft: () => void;
  gasEstimate: () => number;
  /** Validates + materializes the draft into a pending batch record. */
  createBatch: () => BatchRecord | null;
  /** Runs the current batch, applying partial-success / atomic-rollback rules. */
  executeBatch: () => Promise<BatchRecord | null>;
}

const emptyDraft = (): BatchOperation => ({
  operationType: 'charge',
  subscriptionIds: [],
  params: [],
  atomic: false,
});

const defaultExecutor: ItemExecutor = async (_op, subscriptionId) => ({
  subscriptionId,
  success: true,
});

export const useBatchStore = create<BatchStoreState>()((set, get) => ({
  draft: emptyDraft(),
  current: undefined,
  history: [],
  executor: defaultExecutor,

  setExecutor: (executor) => set({ executor }),
  setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  loadFromCsv: (csv, operationType, atomic = false) =>
    set({ draft: parseCsvTemplate(csv, operationType, atomic) }),
  resetDraft: () => set({ draft: emptyDraft() }),

  gasEstimate: () => estimateBatchGas(get().draft.subscriptionIds.length),

  createBatch: () => {
    const { draft } = get();
    if (!validateBatch(draft)) return null;
    const record: BatchRecord = {
      id: `batch_${Date.now()}`,
      operation: { ...draft },
      state: 'pending',
      total: draft.subscriptionIds.length,
      succeeded: 0,
      failed: 0,
      rolledBack: false,
      results: [],
      createdAt: Date.now(),
    };
    set({ current: record });
    return record;
  },

  executeBatch: async () => {
    const { current, executor } = get();
    if (!current || current.state !== 'pending') return null;

    set({ current: { ...current, state: 'running' } });

    const op = current.operation;
    const results: OperationResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < op.subscriptionIds.length; i++) {
      const subId = op.subscriptionIds[i];
      const param = op.params[i] ?? 0;
      let result: OperationResult;
      try {
        result = await executor(op.operationType, subId, param);
      } catch (e) {
        result = { subscriptionId: subId, success: false, message: String(e) };
      }
      results.push(result);
      result.success ? succeeded++ : failed++;
      // Progress reporting: surface incremental counts as we go.
      set({
        current: { ...get().current!, results: [...results], succeeded, failed },
      });
    }

    const rolledBack = op.atomic && failed > 0;
    const state: BatchState = rolledBack
      ? 'failed'
      : failed === 0
        ? 'completed'
        : 'partial';

    const finished: BatchRecord = {
      ...current,
      state,
      results,
      succeeded: rolledBack ? 0 : succeeded,
      failed,
      rolledBack,
    };
    set((s) => ({ current: finished, history: [...s.history, finished] }));
    return finished;
  },
}));
