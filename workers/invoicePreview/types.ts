/** Shared contracts for the invoice-preview pre-render worker. */

export const INVOICE_PREVIEW_QUEUE_NAME = 'subtrackr:invoice-preview';
export const INVOICE_PREVIEW_JOB_NAME = 'invoice:prerender-preview';

export const DEFAULT_PREVIEW_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_PREVIEW_MAX_ATTEMPTS = 3;
export const DEFAULT_PREVIEW_RETRY_BASE_MS = 1_000;
export const DEFAULT_PREVIEW_RETRY_MAX_MS = 30_000;
export const DEFAULT_PREVIEW_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_PREVIEW_MAX_JOBS_PER_TICK = 10;

/** Reasons that mean the cached document is stale and must be replaced. */
export const DEFAULT_PREVIEW_INVALIDATION_REASONS = [
  'invoice-updated',
  'branding-updated',
  'manual',
];

export interface InvoicePreviewJobPayload {
  invoiceId: string;
  tenantId?: string;
  templateId?: string;
  /** Stable revision used as the cache/retry identity. */
  contentVersion?: string;
  /** Why this preview was queued; some reasons invalidate cached output. */
  reason?: string;
  /** 0-based attempt counter managed by the worker. */
  attempt?: number;
}

export interface InvoicePreviewRenderResult {
  invoiceId: string;
  tenantId?: string;
  templateId: string;
  version: string;
  html: string;
  text?: string;
}

export interface CachedInvoicePreview extends InvoicePreviewRenderResult {
  key: string;
  renderedAt: number;
  expiresAt: number;
}

export interface PreviewCacheStats {
  size: number;
  hits: number;
  misses: number;
  sets: number;
  invalidations: number;
}

export interface PreviewCache {
  get(key: string): CachedInvoicePreview | undefined;
  set(key: string, preview: CachedInvoicePreview): void;
  invalidate(invoiceId: string): void;
  invalidateTenant?(tenantId: string): void;
  stats(): PreviewCacheStats;
}

export interface PreviewEnqueueOptions {
  jobId?: string;
  delay?: number;
  attempt?: number;
}

export interface PreviewJobHandle<T = InvoicePreviewJobPayload> {
  id?: string;
  data: T;
}

/**
 * Structural subset of the repo's priority queue. Existing queues satisfy this
 * without the worker importing BullMQ or any other runtime dependency.
 */
export interface PreviewQueue<T = InvoicePreviewJobPayload> {
  add(name: string, data: T, options?: PreviewEnqueueOptions): Promise<PreviewJobHandle<T> | void>;
  dequeue(): Promise<PreviewJobHandle<T> | undefined>;
}

export interface PreviewRenderer {
  render(
    payload: InvoicePreviewJobPayload
  ): InvoicePreviewRenderResult | Promise<InvoicePreviewRenderResult>;
}

export interface PreviewLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export type PreviewEventType =
  'cache-hit' | 'rendered' | 'deduplicated' | 'retry-scheduled' | 'dead-letter' | 'invalid-payload';

export interface PreviewEvent {
  type: PreviewEventType;
  invoiceId?: string;
  cacheKey: string;
  attempts: number;
  durationMs: number;
  error?: string;
}

export interface PreviewWorkerMetrics {
  ticks: number;
  jobsDequeued: number;
  rendered: number;
  cacheHits: number;
  deduplicated: number;
  retries: number;
  deadLettered: number;
  failures: number;
  lastTickAt: number | null;
  lastError: string | null;
  inFlight: number;
}

export type InvoicePreviewErrorCode =
  'INVALID_PAYLOAD' | 'INVOICE_NOT_FOUND' | 'RENDER_FAILED' | 'QUEUE_FAILED';

export class InvoicePreviewError extends Error {
  readonly code: InvoicePreviewErrorCode;
  readonly retryable: boolean;

  constructor(message: string, code: InvoicePreviewErrorCode = 'RENDER_FAILED', retryable = true) {
    super(message);
    this.name = 'InvoicePreviewError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function toPreviewError(error: unknown): InvoicePreviewError {
  if (error instanceof InvoicePreviewError) return error;
  return new InvoicePreviewError(
    error instanceof Error ? error.message : String(error),
    'RENDER_FAILED',
    true
  );
}
