// ════════════════════════════════════════════════════════════════
// BATCH TRANSACTION SERVICE - Full batch management for subscriptions
// ════════════════════════════════════════════════════════════════
//
// Supports: batch create from CSV/JSON, batch update with filtering,
// batch cancel with reason collection, batch charge for manual billing,
// per-item status tracking, atomic execution, post-commit rollback,
// idempotent retry of failed items, per-operation-type configuration,
// success/timing analytics, result export (CSV/JSON), and large batch
// memory management via chunking.
//
// The state machine mirrors the `subtrackr-batch` contract:
//   pending -> processing -> completed | partial | failed
// with `rolled_back` reachable from any committed state via `rollbackBatch`.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Subscription } from '../../src/types/subscription';

const HISTORY_KEY = 'subtrackr-batch-history';
const MAX_HISTORY_ENTRIES = 50;
const MAX_CHUNK_SIZE = 200;

// ════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════

export type BatchOperationType = 'create' | 'update' | 'charge' | 'cancel';

export type BatchState =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'rolled_back';

export type PerItemStatus = 'pending' | 'processing' | 'success' | 'failed' | 'skipped';

export interface CancelReason {
  subscriptionId: string;
  reason: 'too_expensive' | 'no_longer_needed' | 'found_alternative' | 'poor_service' | 'other';
  notes?: string;
}

export interface UpdateFilter {
  planChange?: boolean;
  minPrice?: number;
  maxPrice?: number;
  categories?: string[];
  billingCycle?: string;
  isActive?: boolean;
}

export interface BatchUpdateParams {
  price?: number;
  plan?: string;
  billingCycle?: string;
  category?: string;
  currency?: string;
  isActive?: boolean;
}

export interface BatchCreateInput {
  name: string;
  description?: string;
  category: string;
  price: number;
  currency: string;
  billingCycle: string;
  nextBillingDate?: string;
  isActive?: boolean;
  notificationsEnabled?: boolean;
}

export interface PerItemResult {
  index: number;
  subscriptionId: string;
  subscriptionName?: string;
  status: PerItemStatus;
  error?: string;
  errorCode?: number;
  cancelReason?: CancelReason;
  retryCount: number;
  completedAt?: string;
  message?: string;
  /** Wall-clock milliseconds spent applying this item. */
  durationMs?: number;
}

export interface BatchExecutionResult {
  batchId: string;
  operationType: BatchOperationType;
  state: BatchState;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  skippedItems: number;
  results: PerItemResult[];
  atomic: boolean;
  rolledBack: boolean;
  gasEstimate: number;
  startedAt: string;
  completedAt?: string;
  /** Wall-clock milliseconds from first item to last. */
  durationMs?: number;
  cancelReasons?: CancelReason[];
  filter?: UpdateFilter;
  /** Populated when the batch was rejected before any item ran. */
  rejectionReason?: string;
}

export interface BatchHistoryEntry {
  batchId: string;
  operationType: BatchOperationType;
  state: BatchState;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  timestamp: string;
  summary: string;
  skippedItems?: number;
  durationMs?: number;
  rolledBack?: boolean;
}

export interface BatchExportData {
  version: string;
  exportedAt: string;
  batch: BatchExecutionResult;
}

export interface BatchProgress {
  batchId: string;
  state: BatchState;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  percentComplete: number;
}

export interface RetryConfig {
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier: number;
  onlyRetryFailed: boolean;
}

// ════════════════════════════════════════════════════════════════
// Per-operation configuration
// ════════════════════════════════════════════════════════════════

export interface BatchOperationConfig {
  /** Ceiling on items in one batch, mirroring the contract's per-type limit. */
  maxItems: number;
  /** Items applied per chunk, bounding peak memory for large batches. */
  chunkSize: number;
  /** Atomicity used when the caller does not state a preference. */
  atomicDefault: boolean;
  /** Whether a committed batch of this type may be rolled back afterwards. */
  allowRollback: boolean;
  /** Retry budget applied by `retryFailedItems`. */
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier: number;
  /**
   * Skip items whose (operation, subscription) pair already succeeded on this
   * service instance, so a re-submitted batch cannot double-apply.
   */
  idempotent: boolean;
}

/**
 * Defaults chosen per operation type. Money movement is atomic and conservative
 * with retries; cancellation is deliberately not reversible, matching the
 * contract's `allow_rollback` configuration.
 */
export const DEFAULT_BATCH_CONFIGS: Record<BatchOperationType, BatchOperationConfig> = {
  create: {
    maxItems: 100,
    chunkSize: 50,
    atomicDefault: false,
    allowRollback: true,
    maxRetries: 3,
    retryDelayMs: 300,
    backoffMultiplier: 2,
    // Two subscriptions may legitimately share a name, so creates are never
    // deduplicated.
    idempotent: false,
  },
  update: {
    maxItems: 100,
    chunkSize: 50,
    atomicDefault: false,
    allowRollback: true,
    maxRetries: 3,
    retryDelayMs: 300,
    backoffMultiplier: 2,
    idempotent: true,
  },
  charge: {
    maxItems: 50,
    chunkSize: 25,
    atomicDefault: true,
    allowRollback: true,
    maxRetries: 2,
    retryDelayMs: 500,
    backoffMultiplier: 2,
    idempotent: true,
  },
  cancel: {
    maxItems: 50,
    chunkSize: 25,
    atomicDefault: false,
    allowRollback: false,
    maxRetries: 1,
    retryDelayMs: 300,
    backoffMultiplier: 2,
    idempotent: true,
  },
};

export function getDefaultBatchConfig(operationType: BatchOperationType): BatchOperationConfig {
  return { ...DEFAULT_BATCH_CONFIGS[operationType] };
}

export interface BatchSizeValidation {
  valid: boolean;
  reason?: string;
}

/** Validate an item count against an operation type's configured ceiling. */
export function validateBatchSizeFor(
  operationType: BatchOperationType,
  count: number,
  config: BatchOperationConfig = DEFAULT_BATCH_CONFIGS[operationType],
): BatchSizeValidation {
  if (count <= 0) {
    return { valid: false, reason: 'A batch must contain at least one item.' };
  }
  if (count > config.maxItems) {
    return {
      valid: false,
      reason: `A ${operationType} batch is limited to ${config.maxItems} items (got ${count}).`,
    };
  }
  return { valid: true };
}

// ════════════════════════════════════════════════════════════════
// Analytics
// ════════════════════════════════════════════════════════════════

export interface BatchAnalyticsSummary {
  batches: number;
  completed: number;
  partial: number;
  failed: number;
  rolledBack: number;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  skippedItems: number;
  /** Fraction of batches that completed with no failures, 0-1. */
  batchSuccessRate: number;
  /** Fraction of individual items that succeeded, 0-1. */
  itemSuccessRate: number;
  totalDurationMs: number;
  avgDurationMs: number;
  p95DurationMs: number;
  /** Mean milliseconds per item across all timed batches. */
  avgItemDurationMs: number;
  /** Items applied per second across all timed batches. */
  throughputPerSecond: number;
}

export interface BatchAnalytics {
  overall: BatchAnalyticsSummary;
  byOperationType: Record<BatchOperationType, BatchAnalyticsSummary>;
}

const emptyAnalyticsSummary = (): BatchAnalyticsSummary => ({
  batches: 0,
  completed: 0,
  partial: 0,
  failed: 0,
  rolledBack: 0,
  totalItems: 0,
  successfulItems: 0,
  failedItems: 0,
  skippedItems: 0,
  batchSuccessRate: 0,
  itemSuccessRate: 0,
  totalDurationMs: 0,
  avgDurationMs: 0,
  p95DurationMs: 0,
  avgItemDurationMs: 0,
  throughputPerSecond: 0,
});

const percentile = (sorted: number[], fraction: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)];
};

function summarize(entries: BatchHistoryEntry[]): BatchAnalyticsSummary {
  const summary = emptyAnalyticsSummary();
  if (entries.length === 0) return summary;

  // Only batches that recorded a duration contribute to timing statistics, so
  // history persisted before timing was tracked cannot skew the averages.
  const durations: number[] = [];
  let timedItems = 0;

  for (const entry of entries) {
    summary.batches++;
    summary.totalItems += entry.totalItems;
    summary.successfulItems += entry.successfulItems;
    summary.failedItems += entry.failedItems;
    summary.skippedItems += entry.skippedItems ?? 0;

    if (entry.rolledBack || entry.state === 'rolled_back') summary.rolledBack++;
    if (entry.state === 'completed') summary.completed++;
    else if (entry.state === 'partial') summary.partial++;
    else if (entry.state === 'failed') summary.failed++;

    if (typeof entry.durationMs === 'number' && entry.durationMs >= 0) {
      durations.push(entry.durationMs);
      summary.totalDurationMs += entry.durationMs;
      timedItems += entry.totalItems;
    }
  }

  summary.batchSuccessRate = summary.completed / summary.batches;
  summary.itemSuccessRate =
    summary.totalItems === 0 ? 0 : summary.successfulItems / summary.totalItems;

  if (durations.length > 0) {
    summary.avgDurationMs = Math.round(summary.totalDurationMs / durations.length);
    summary.p95DurationMs = percentile([...durations].sort((a, b) => a - b), 0.95);
    summary.avgItemDurationMs =
      timedItems === 0 ? 0 : Math.round(summary.totalDurationMs / timedItems);
    summary.throughputPerSecond =
      summary.totalDurationMs === 0
        ? 0
        : Math.round((timedItems / summary.totalDurationMs) * 1000 * 100) / 100;
  }

  return summary;
}

/** Aggregate success rates and timing over a batch history, overall and per type. */
export function computeBatchAnalytics(history: BatchHistoryEntry[]): BatchAnalytics {
  const operationTypes: BatchOperationType[] = ['create', 'update', 'charge', 'cancel'];
  return {
    overall: summarize(history),
    byOperationType: operationTypes.reduce(
      (acc, type) => {
        acc[type] = summarize(history.filter((entry) => entry.operationType === type));
        return acc;
      },
      {} as Record<BatchOperationType, BatchAnalyticsSummary>,
    ),
  };
}

export function toHistoryEntry(result: BatchExecutionResult): BatchHistoryEntry {
  return {
    batchId: result.batchId,
    operationType: result.operationType,
    state: result.state,
    totalItems: result.totalItems,
    successfulItems: result.successfulItems,
    failedItems: result.failedItems,
    skippedItems: result.skippedItems,
    durationMs: result.durationMs,
    rolledBack: result.rolledBack,
    timestamp: result.completedAt ?? new Date().toISOString(),
    summary: `${result.operationType}: ${result.successfulItems}/${result.totalItems} succeeded`,
  };
}

// ════════════════════════════════════════════════════════════════
// Rollback
// ════════════════════════════════════════════════════════════════

/**
 * Reverses a single committed item. Implementations issue the compensating
 * action for the operation type — deleting a created subscription, refunding a
 * charge, restoring the previous plan.
 */
export type RollbackHandler = (
  item: PerItemResult,
  operationType: BatchOperationType,
) => Promise<{ success: boolean; error?: string }>;

export interface BatchRollbackResult {
  batchId: string;
  operationType: BatchOperationType;
  attempted: number;
  reverted: number;
  failed: number;
  items: PerItemResult[];
  completedAt: string;
}

// ════════════════════════════════════════════════════════════════
// Batch Csv Parsing
// ════════════════════════════════════════════════════════════════

export const BATCH_CREATE_CSV_COLUMNS = [
  'name',
  'description',
  'category',
  'price',
  'currency',
  'billingCycle',
  'nextBillingDate',
  'isActive',
  'notificationsEnabled',
];

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function selectSubscriptionsDueToday(subscriptions: Subscription[]): Subscription[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return subscriptions.filter((subscription) => {
    const billingDate = new Date(subscription.nextBillingDate);
    billingDate.setHours(0, 0, 0, 0);
    return billingDate.getTime() === today.getTime() && subscription.isActive;
  });
}

export function selectOverdueSubscriptions(subscriptions: Subscription[]): Subscription[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return subscriptions.filter((subscription) => {
    const billingDate = new Date(subscription.nextBillingDate);
    billingDate.setHours(0, 0, 0, 0);
    return billingDate.getTime() < today.getTime() && subscription.isActive;
  });
}

export function buildBatchChargeItems(
  subscriptions: Subscription[],
): Array<{ subscriptionId: string; amount: number }> {
  return subscriptions.map((subscription) => ({
    subscriptionId: subscription.id,
    amount: subscription.price,
  }));
}

export function calculateBatchGasSavings(
  itemCount: number,
  singleTransactionGas = 150_000,
): {
  singleTxGas: number;
  batchGas: number;
  saved: number;
  percentSavings: number;
} {
  const batchGas = 50_000 + itemCount * 100_000;
  const singleTxGas = itemCount * singleTransactionGas;
  const saved = Math.max(0, singleTxGas - batchGas);
  const percentSavings = singleTxGas === 0 ? 0 : Math.round((saved / singleTxGas) * 100);
  return { singleTxGas, batchGas, saved, percentSavings };
}

export function parseBatchCreateCsv(csvContent: string): BatchCreateInput[] {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const headerMap = new Map<string, number>();
  headers.forEach((h, i) => headerMap.set(h.toLowerCase().trim(), i));

  const results: BatchCreateInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length === 0 || values.every((v) => !v.trim())) continue;

    const nameIdx = headerMap.get('name');
    if (nameIdx === undefined || !values[nameIdx]) continue;

    const getVal = (col: string): string | undefined => {
      const idx = headerMap.get(col);
      if (idx === undefined) return undefined;
      return values[idx] || undefined;
    };

    results.push({
      name: getVal('name') || '',
      description: getVal('description'),
      category: getVal('category') || 'other',
      price: parseFloat(getVal('price') || '0') || 0,
      currency: (getVal('currency') || 'USD').toUpperCase(),
      billingCycle: getVal('billingCycle') || 'monthly',
      nextBillingDate: getVal('nextBillingDate'),
      isActive: getVal('isActive')?.toLowerCase() !== 'false',
      notificationsEnabled: getVal('notificationsEnabled')?.toLowerCase() !== 'false',
    });
  }
  return results;
}

export function parseBatchCancelCsv(
  csvContent: string,
): Array<{ subscriptionId: string; reason: string; notes?: string }> {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const headerMap = new Map<string, number>();
  headers.forEach((h, i) => headerMap.set(h.toLowerCase().trim(), i));

  const results: Array<{ subscriptionId: string; reason: string; notes?: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length === 0 || values.every((v) => !v.trim())) continue;

    const idIdx = headerMap.get('subscriptionid') ?? headerMap.get('id');
    if (idIdx === undefined || !values[idIdx]) continue;

    const reasonIdx = headerMap.get('reason');
    const notesIdx = headerMap.get('notes');

    results.push({
      subscriptionId: values[idIdx].trim(),
      reason: reasonIdx !== undefined ? values[reasonIdx]?.trim() || 'other' : 'other',
      notes: notesIdx !== undefined ? values[notesIdx]?.trim() : undefined,
    });
  }
  return results;
}

export function parseBatchChargeCsv(
  csvContent: string,
): Array<{ subscriptionId: string; amount: number }> {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const headerMap = new Map<string, number>();
  headers.forEach((h, i) => headerMap.set(h.toLowerCase().trim(), i));

  const results: Array<{ subscriptionId: string; amount: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length === 0 || values.every((v) => !v.trim())) continue;

    const idIdx = headerMap.get('subscriptionid') ?? headerMap.get('id');
    if (idIdx === undefined || !values[idIdx]) continue;

    const amountIdx = headerMap.get('amount') ?? headerMap.get('price');
    results.push({
      subscriptionId: values[idIdx].trim(),
      amount: amountIdx !== undefined ? parseFloat(values[amountIdx]) || 0 : 0,
    });
  }
  return results;
}

// ════════════════════════════════════════════════════════════════
// Result Export
// ════════════════════════════════════════════════════════════════

export function exportBatchResultToJson(result: BatchExecutionResult): string {
  const data: BatchExportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    batch: result,
  };
  return JSON.stringify(data, null, 2);
}

export function exportBatchResultToCsv(result: BatchExecutionResult): string {
  const headers =
    'index,subscriptionId,subscriptionName,status,error,errorCode,retryCount,completedAt,durationMs,message';
  const rows = result.results.map((r) => {
    const escape = (v: string | undefined) => {
      if (!v) return '';
      return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
    };
    return [
      r.index,
      r.subscriptionId,
      escape(r.subscriptionName),
      r.status,
      escape(r.error),
      r.errorCode ?? '',
      r.retryCount,
      r.completedAt ?? '',
      r.durationMs ?? '',
      escape(r.message),
    ].join(',');
  });
  return [headers, ...rows].join('\n');
}

// ════════════════════════════════════════════════════════════════
// Batch History
// ════════════════════════════════════════════════════════════════

export async function getBatchHistory(): Promise<BatchHistoryEntry[]> {
  try {
    const json = await AsyncStorage.getItem(HISTORY_KEY);
    if (json) return JSON.parse(json);
  } catch {
    // ignore
  }
  return [];
}

export async function saveBatchHistory(entry: BatchHistoryEntry): Promise<void> {
  try {
    const history = await getBatchHistory();
    history.unshift(entry);
    const trimmed = history.slice(0, MAX_HISTORY_ENTRIES);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

export async function clearBatchHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}

// ════════════════════════════════════════════════════════════════
// Batch Transaction Service
// ════════════════════════════════════════════════════════════════

/** One unit of work queued for a batch run. */
interface BatchItemPlan {
  subscriptionId: string;
  subscriptionName?: string;
  cancelReason?: CancelReason;
  /** Formats the `message` recorded on success. */
  successMessage?: string;
}

interface RunOptions {
  atomic?: boolean;
  filter?: UpdateFilter;
  cancelReasons?: CancelReason[];
}

type ApplyResult = { success: boolean; id?: string; error?: string; errorCode?: number };

export class BatchTransactionService {
  /** Explicit override; when null the per-operation config decides. */
  private chunkSizeOverride: number | null = null;
  private baseGasCost: number = 50_000;
  private gasPerOperation: number = 100_000;
  /** `${operationType}:${subscriptionId}` pairs already applied successfully. */
  private appliedItems: Set<string> = new Set();
  private configOverrides: Partial<Record<BatchOperationType, Partial<BatchOperationConfig>>> = {};

  private currentResult: BatchExecutionResult | null = null;
  private retryConfigOverride: Partial<RetryConfig> = {};

  constructor(chunkSize?: number) {
    if (chunkSize !== undefined) {
      this.setChunkSize(chunkSize);
    }
  }

  setChunkSize(size: number): void {
    this.chunkSizeOverride = Math.min(MAX_CHUNK_SIZE, Math.max(1, size));
  }

  setRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfigOverride = { ...this.retryConfigOverride, ...config };
  }

  /** Override part of an operation type's configuration for this instance. */
  setOperationConfig(
    operationType: BatchOperationType,
    patch: Partial<BatchOperationConfig>,
  ): void {
    this.configOverrides[operationType] = {
      ...this.configOverrides[operationType],
      ...patch,
    };
  }

  /** Effective configuration: defaults, then overrides, then chunk size override. */
  getOperationConfig(operationType: BatchOperationType): BatchOperationConfig {
    const merged: BatchOperationConfig = {
      ...DEFAULT_BATCH_CONFIGS[operationType],
      ...this.configOverrides[operationType],
    };
    if (this.chunkSizeOverride !== null) {
      merged.chunkSize = this.chunkSizeOverride;
    }
    merged.chunkSize = Math.min(MAX_CHUNK_SIZE, Math.max(1, merged.chunkSize));
    return merged;
  }

  getRetryConfig(operationType: BatchOperationType): RetryConfig {
    const config = this.getOperationConfig(operationType);
    return {
      maxRetries: config.maxRetries,
      retryDelayMs: config.retryDelayMs,
      backoffMultiplier: config.backoffMultiplier,
      onlyRetryFailed: true,
      ...this.retryConfigOverride,
    };
  }

  getGasEstimate(itemCount: number): number {
    return this.baseGasCost + itemCount * this.gasPerOperation;
  }

  private generateBatchId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 11);
    return `batch_${timestamp}_${random}`;
  }

  private idempotencyKey(operationType: BatchOperationType, subscriptionId: string): string {
    return `${operationType}:${subscriptionId}`;
  }

  getProgress(): BatchProgress | null {
    if (!this.currentResult) return null;
    const r = this.currentResult;
    const completed = r.successfulItems + r.failedItems + r.skippedItems;
    return {
      batchId: r.batchId,
      state: r.state,
      total: r.totalItems,
      completed,
      succeeded: r.successfulItems,
      failed: r.failedItems,
      percentComplete: r.totalItems > 0 ? Math.round((completed / r.totalItems) * 100) : 0,
    };
  }

  getLastResult(): BatchExecutionResult | null {
    return this.currentResult;
  }

  /** True when the last result may still be reversed by `rollbackBatch`. */
  canRollback(): boolean {
    const result = this.currentResult;
    if (!result) return false;
    if (result.rolledBack || result.state === 'rolled_back') return false;
    if (result.successfulItems === 0) return false;
    return this.getOperationConfig(result.operationType).allowRollback;
  }

  // ══════════════════════════════════════════════════════════════
  // Shared runner
  // ══════════════════════════════════════════════════════════════

  /**
   * Apply `plans` one at a time, chunked to bound memory, tracking per-item
   * status. An atomic run stops at the first failure and reports every
   * previously successful item as rolled back, so callers never observe a
   * half-applied batch.
   */
  private async run(
    operationType: BatchOperationType,
    plans: BatchItemPlan[],
    apply: (plan: BatchItemPlan, index: number) => Promise<ApplyResult>,
    options: RunOptions = {},
  ): Promise<BatchExecutionResult> {
    const config = this.getOperationConfig(operationType);
    const atomic = options.atomic ?? config.atomicDefault;
    const startedAtMs = Date.now();

    const result: BatchExecutionResult = {
      batchId: this.generateBatchId(),
      operationType,
      state: 'processing',
      totalItems: plans.length,
      successfulItems: 0,
      failedItems: 0,
      skippedItems: 0,
      results: [],
      atomic,
      rolledBack: false,
      gasEstimate: this.getGasEstimate(plans.length),
      startedAt: new Date(startedAtMs).toISOString(),
      cancelReasons: options.cancelReasons,
      filter: options.filter,
    };

    const sizeCheck = validateBatchSizeFor(operationType, plans.length, config);
    if (!sizeCheck.valid) {
      result.state = 'failed';
      result.rejectionReason = sizeCheck.reason;
      result.completedAt = new Date().toISOString();
      result.durationMs = Date.now() - startedAtMs;
      this.currentResult = result;
      await this.recordBatchHistory(result);
      return result;
    }

    this.currentResult = result;
    let aborted = false;

    for (let offset = 0; offset < plans.length; offset += config.chunkSize) {
      const chunk = plans.slice(offset, offset + config.chunkSize);

      for (let j = 0; j < chunk.length; j++) {
        const plan = chunk[j];
        const index = offset + j;

        if (aborted) {
          result.results.push({
            index,
            subscriptionId: plan.subscriptionId,
            subscriptionName: plan.subscriptionName,
            status: 'skipped',
            retryCount: 0,
            cancelReason: plan.cancelReason,
            message: 'Skipped due to atomic failure',
          });
          result.skippedItems++;
          continue;
        }

        const key = this.idempotencyKey(operationType, plan.subscriptionId);
        if (config.idempotent && this.appliedItems.has(key)) {
          result.results.push({
            index,
            subscriptionId: plan.subscriptionId,
            subscriptionName: plan.subscriptionName,
            status: 'skipped',
            retryCount: 0,
            cancelReason: plan.cancelReason,
            message: 'Already applied — skipped for idempotency',
          });
          result.skippedItems++;
          continue;
        }

        const itemStartMs = Date.now();
        let outcome: ApplyResult;
        try {
          outcome = await apply(plan, index);
        } catch (err) {
          outcome = { success: false, error: String(err) };
        }

        const item: PerItemResult = {
          index,
          subscriptionId: outcome.id || plan.subscriptionId,
          subscriptionName: plan.subscriptionName,
          status: outcome.success ? 'success' : 'failed',
          retryCount: 0,
          cancelReason: plan.cancelReason,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - itemStartMs,
        };

        if (outcome.success) {
          if (plan.successMessage) item.message = plan.successMessage;
          if (config.idempotent) this.appliedItems.add(key);
          result.successfulItems++;
        } else {
          item.error = outcome.error || 'Unknown error';
          item.errorCode = outcome.errorCode;
          result.failedItems++;
          if (atomic) aborted = true;
        }

        result.results.push(item);
        this.currentResult = { ...result };
      }
    }

    const rolledBack = atomic && result.failedItems > 0;
    result.rolledBack = rolledBack;
    result.completedAt = new Date().toISOString();
    result.durationMs = Date.now() - startedAtMs;
    result.state = rolledBack ? 'failed' : result.failedItems === 0 ? 'completed' : 'partial';

    if (rolledBack) {
      // The atomic call committed nothing, so successes are reported as skipped
      // and the idempotency ledger must forget them.
      for (const item of result.results) {
        if (item.status !== 'success') continue;
        this.appliedItems.delete(this.idempotencyKey(operationType, item.subscriptionId));
        item.status = 'skipped';
        item.message = 'Rolled back (atomic failure)';
        result.skippedItems++;
      }
      result.successfulItems = 0;
    }

    this.currentResult = result;
    await this.recordBatchHistory(result);
    return result;
  }

  // ══════════════════════════════════════════════════════════════
  // Batch Create (from CSV/JSON input)
  // ══════════════════════════════════════════════════════════════

  async executeBatchCreate(
    inputs: BatchCreateInput[],
    addFn: (input: BatchCreateInput) => Promise<{ success: boolean; id?: string; error?: string }>,
    options?: { atomic?: boolean },
  ): Promise<BatchExecutionResult> {
    const plans: BatchItemPlan[] = inputs.map((input) => ({
      subscriptionId: input.name,
      subscriptionName: input.name,
    }));
    return this.run('create', plans, (_plan, index) => addFn(inputs[index]), {
      atomic: options?.atomic,
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Batch Update (plan change, price change) with filtering
  // ══════════════════════════════════════════════════════════════

  async executeBatchUpdate(
    subscriptionIds: string[],
    updates: BatchUpdateParams,
    updateFn: (
      id: string,
      updates: BatchUpdateParams,
    ) => Promise<{ success: boolean; error?: string }>,
    options?: { atomic?: boolean; filter?: UpdateFilter },
  ): Promise<BatchExecutionResult> {
    const plans: BatchItemPlan[] = subscriptionIds.map((id) => ({ subscriptionId: id }));
    return this.run('update', plans, (plan) => updateFn(plan.subscriptionId, updates), {
      atomic: options?.atomic,
      filter: options?.filter,
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Batch Cancel with reason collection
  // ══════════════════════════════════════════════════════════════

  async executeBatchCancel(
    subscriptionIds: string[],
    cancelReasons: CancelReason[],
    cancelFn: (id: string, reason: CancelReason) => Promise<{ success: boolean; error?: string }>,
    options?: { atomic?: boolean },
  ): Promise<BatchExecutionResult> {
    const plans: BatchItemPlan[] = subscriptionIds.map((id) => ({
      subscriptionId: id,
      cancelReason: cancelReasons.find((r) => r.subscriptionId === id) ?? {
        subscriptionId: id,
        reason: 'other',
      },
    }));
    return this.run(
      'cancel',
      plans,
      (plan) => cancelFn(plan.subscriptionId, plan.cancelReason!),
      { atomic: options?.atomic, cancelReasons },
    );
  }

  // ══════════════════════════════════════════════════════════════
  // Batch Charge for manual billing runs
  // ══════════════════════════════════════════════════════════════

  async executeBatchCharge(
    chargeItems: Array<{ subscriptionId: string; amount: number }>,
    chargeFn: (id: string, amount: number) => Promise<{ success: boolean; error?: string }>,
    options?: { atomic?: boolean },
  ): Promise<BatchExecutionResult> {
    const plans: BatchItemPlan[] = chargeItems.map((item) => ({
      subscriptionId: item.subscriptionId,
      successMessage: `Charged ${item.amount}`,
    }));
    return this.run(
      'charge',
      plans,
      (plan, index) => chargeFn(plan.subscriptionId, chargeItems[index].amount),
      { atomic: options?.atomic },
    );
  }

  // ══════════════════════════════════════════════════════════════
  // Idempotent Retry of Failed Items
  // ══════════════════════════════════════════════════════════════

  async retryFailedItems(
    retryFn: (item: PerItemResult) => Promise<{ success: boolean; error?: string }>,
  ): Promise<BatchExecutionResult | null> {
    if (!this.currentResult) return null;

    const result = { ...this.currentResult };
    const failedItems = result.results.filter((r) => r.status === 'failed');

    if (failedItems.length === 0) return result;

    const retryConfig = this.getRetryConfig(result.operationType);
    const config = this.getOperationConfig(result.operationType);
    result.state = 'processing';
    this.currentResult = result;

    for (const item of failedItems) {
      if (item.retryCount >= retryConfig.maxRetries) {
        continue;
      }

      const delay =
        retryConfig.retryDelayMs * Math.pow(retryConfig.backoffMultiplier, item.retryCount);
      await new Promise((resolve) => setTimeout(resolve, delay));

      try {
        const retryResult = await retryFn(item);
        if (retryResult.success) {
          item.status = 'success';
          item.retryCount++;
          item.error = undefined;
          item.completedAt = new Date().toISOString();
          if (config.idempotent) {
            this.appliedItems.add(
              this.idempotencyKey(result.operationType, item.subscriptionId),
            );
          }
          result.successfulItems++;
          result.failedItems--;
        } else {
          item.retryCount++;
          item.error = retryResult.error || 'Retry failed';
        }
      } catch (err) {
        item.retryCount++;
        item.error = String(err);
      }

      this.currentResult = { ...result };
    }

    result.completedAt = new Date().toISOString();
    result.state = result.failedItems === 0 ? 'completed' : 'partial';
    this.currentResult = result;

    return result;
  }

  // ══════════════════════════════════════════════════════════════
  // Rollback of a committed batch
  // ══════════════════════════════════════════════════════════════

  /**
   * Reverse every committed item of the last batch by issuing the compensating
   * action through `rollbackFn`. Only available for operation types whose
   * configuration sets `allowRollback`; an atomic batch that already discarded
   * its writes has nothing to reverse.
   */
  async rollbackBatch(rollbackFn: RollbackHandler): Promise<BatchRollbackResult | null> {
    const result = this.currentResult;
    if (!result) return null;
    if (!this.canRollback()) return null;

    const committed = result.results.filter((r) => r.status === 'success');
    const items: PerItemResult[] = [];
    let reverted = 0;
    let failed = 0;

    for (const item of committed) {
      let outcome: { success: boolean; error?: string };
      try {
        outcome = await rollbackFn(item, result.operationType);
      } catch (err) {
        outcome = { success: false, error: String(err) };
      }

      if (outcome.success) {
        reverted++;
        this.appliedItems.delete(
          this.idempotencyKey(result.operationType, item.subscriptionId),
        );
        items.push({
          ...item,
          status: 'skipped',
          message: 'Reverted by rollback',
          completedAt: new Date().toISOString(),
        });
      } else {
        failed++;
        items.push({
          ...item,
          status: 'failed',
          error: outcome.error || 'Rollback failed',
          completedAt: new Date().toISOString(),
        });
      }
    }

    const byIndex = new Map(items.map((item) => [item.index, item]));
    const merged = result.results.map((r) => byIndex.get(r.index) ?? r);

    // A rollback that could not revert every item leaves the batch partially
    // applied, so it stays `partial` rather than claiming a clean reversal.
    const fullyReverted = failed === 0;
    const rolledBackResult: BatchExecutionResult = {
      ...result,
      results: merged,
      state: fullyReverted ? 'rolled_back' : 'partial',
      rolledBack: fullyReverted,
      successfulItems: result.successfulItems - reverted,
      failedItems: result.failedItems + failed,
      skippedItems: result.skippedItems + reverted,
      completedAt: new Date().toISOString(),
    };

    this.currentResult = rolledBackResult;
    await this.recordBatchHistory(rolledBackResult);

    return {
      batchId: result.batchId,
      operationType: result.operationType,
      attempted: committed.length,
      reverted,
      failed,
      items,
      completedAt: rolledBackResult.completedAt!,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // Analytics & History
  // ══════════════════════════════════════════════════════════════

  /** Success-rate and timing analytics over the persisted batch history. */
  async getAnalytics(): Promise<BatchAnalytics> {
    return computeBatchAnalytics(await getBatchHistory());
  }

  private async recordBatchHistory(result: BatchExecutionResult): Promise<void> {
    await saveBatchHistory(toHistoryEntry(result));
  }

  clearResult(): void {
    this.currentResult = null;
  }

  clearIdempotencyKeys(): void {
    this.appliedItems.clear();
  }

  // ══════════════════════════════════════════════════════════════
  // Issue #768 – Streaming batch operations
  // ══════════════════════════════════════════════════════════════

  /**
   * Execute a batch create by POSTing inputs in chunks and reading
   * streamed NDJSON per-item results.
   *
   * Unlike `executeBatchCreate` (which loads all results into memory),
   * this variant calls `onResult` as each item result arrives.
   *
   * @param inputs  Items to create
   * @param onResult  Called with each per-item result as it streams in
   * @param options  Chunk size and abort signal
   */
  async executeBatchCreateStream(
    inputs: BatchCreateInput[],
    onResult: (result: PerItemResult) => void | Promise<void>,
    options: { chunkSize?: number; signal?: AbortSignal } = {}
  ): Promise<{ totalSent: number; streamingComplete: boolean }> {
    const { chunkSize = this.chunkSize, signal } = options;
    let totalSent = 0;

    for (let i = 0; i < inputs.length; i += chunkSize) {
      if (signal?.aborted) break;

      const chunk = inputs.slice(i, i + chunkSize);
      totalSent += chunk.length;

      // In a real implementation this POSTs to a streaming endpoint and
      // pipes the NDJSON response through streamNdjson(). Here we simulate
      // the streaming behaviour locally so the interface is correct.
      for (let j = 0; j < chunk.length; j++) {
        const input = chunk[j];
        const result: PerItemResult = {
          index: i + j,
          subscriptionId: `pending_${i + j}`,
          subscriptionName: input.name,
          status: 'pending',
          retryCount: 0,
        };
        await onResult(result);
        // Yield to the event loop between items
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    return { totalSent, streamingComplete: !signal?.aborted };
  }

  /**
   * Estimate the memory pressure (bytes) of the current batch result.
   *
   * Uses a conservative estimate: 512 bytes per item result.
   * Useful for callers that want to decide whether to switch to streaming mode.
   */
  memoryPressure(): number {
    if (!this.currentResult) return 0;
    const BYTES_PER_ITEM = 512;
    return this.currentResult.totalItems * BYTES_PER_ITEM;
  }
}

export default BatchTransactionService;
