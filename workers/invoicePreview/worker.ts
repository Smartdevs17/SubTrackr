import { InMemoryPreviewCache } from './cache';
import { enqueueInvoicePreview } from './enqueue';
import { previewCacheKey, previewJobId, validatePreviewPayload } from './keys';
import { InMemoryPreviewQueue } from './queue';
import {
  DEFAULT_PREVIEW_INVALIDATION_REASONS,
  DEFAULT_PREVIEW_MAX_ATTEMPTS,
  DEFAULT_PREVIEW_MAX_JOBS_PER_TICK,
  DEFAULT_PREVIEW_POLL_INTERVAL_MS,
  DEFAULT_PREVIEW_RETRY_BASE_MS,
  DEFAULT_PREVIEW_RETRY_MAX_MS,
  DEFAULT_PREVIEW_TTL_MS,
  InvoicePreviewError,
  toPreviewError,
  type CachedInvoicePreview,
  type InvoicePreviewJobPayload,
  type InvoicePreviewRenderResult,
  type PreviewCache,
  type PreviewEvent,
  type PreviewEventType,
  type PreviewJobHandle,
  type PreviewLogger,
  type PreviewQueue,
  type PreviewRenderer,
  type PreviewWorkerMetrics,
} from './types';

export interface InvoicePreviewWorkerOptions {
  renderer: PreviewRenderer;
  queue?: PreviewQueue;
  cache?: PreviewCache;
  pollIntervalMs?: number;
  maxJobsPerTick?: number;
  ttlMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  invalidationReasons?: string[];
  logger?: PreviewLogger;
  onEvent?: (event: PreviewEvent) => void;
  onMetrics?: (metrics: PreviewWorkerMetrics) => void;
  onDeadLetter?: (payload: InvoicePreviewJobPayload, error: InvoicePreviewError) => void;
  now?: () => number;
}

const defaultLogger: PreviewLogger = {
  debug: () => undefined,
  warn: (message, meta) => console.warn(message, meta ?? ''),
  error: (message, meta) => console.error(message, meta ?? ''),
};

export function previewRetryDelay(
  attempt: number,
  baseMs = DEFAULT_PREVIEW_RETRY_BASE_MS,
  maxMs = DEFAULT_PREVIEW_RETRY_MAX_MS
): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(maxMs, baseMs * 2 ** exponent);
}

/**
 * Background worker that turns queued invoice-preview jobs into cached HTML.
 * Rendering is single-flight per cache key, failures are retried with capped
 * exponential backoff, and every terminal/retry path emits an event.
 */
export class InvoicePreviewWorker {
  private readonly renderer: PreviewRenderer;
  private readonly queue: PreviewQueue;
  private readonly cache: PreviewCache;
  private readonly pollIntervalMs: number;
  private readonly maxJobsPerTick: number;
  private readonly ttlMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly invalidationReasons: Set<string>;
  private readonly logger: PreviewLogger;
  private readonly onEvent?: (event: PreviewEvent) => void;
  private readonly onMetrics?: (metrics: PreviewWorkerMetrics) => void;
  private readonly onDeadLetter?: (
    payload: InvoicePreviewJobPayload,
    error: InvoicePreviewError
  ) => void;
  private readonly now: () => number;
  private readonly inFlight = new Map<string, Promise<CachedInvoicePreview>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private isTicking = false;

  private readonly metrics: PreviewWorkerMetrics = {
    ticks: 0,
    jobsDequeued: 0,
    rendered: 0,
    cacheHits: 0,
    deduplicated: 0,
    retries: 0,
    deadLettered: 0,
    failures: 0,
    lastTickAt: null,
    lastError: null,
    inFlight: 0,
  };

  constructor(options: InvoicePreviewWorkerOptions) {
    this.renderer = options.renderer;
    this.queue = options.queue ?? new InMemoryPreviewQueue();
    this.cache = options.cache ?? new InMemoryPreviewCache();
    this.pollIntervalMs = Math.max(1, options.pollIntervalMs ?? DEFAULT_PREVIEW_POLL_INTERVAL_MS);
    this.maxJobsPerTick = Math.max(1, options.maxJobsPerTick ?? DEFAULT_PREVIEW_MAX_JOBS_PER_TICK);
    this.ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_PREVIEW_TTL_MS);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_PREVIEW_MAX_ATTEMPTS);
    this.retryBaseMs = Math.max(0, options.retryBaseMs ?? DEFAULT_PREVIEW_RETRY_BASE_MS);
    this.retryMaxMs = Math.max(
      this.retryBaseMs,
      options.retryMaxMs ?? DEFAULT_PREVIEW_RETRY_MAX_MS
    );
    this.invalidationReasons = new Set(
      options.invalidationReasons ?? DEFAULT_PREVIEW_INVALIDATION_REASONS
    );
    this.logger = options.logger ?? defaultLogger;
    this.onEvent = options.onEvent;
    this.onMetrics = options.onMetrics;
    this.onDeadLetter = options.onDeadLetter;
    this.now = options.now ?? Date.now;
  }

  getMetrics(): PreviewWorkerMetrics {
    return { ...this.metrics, inFlight: this.inFlight.size };
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    const timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    this.timer = timer;
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Process one bounded batch. Concurrent ticks are skipped, not queued. */
  async tick(): Promise<void> {
    if (this.isTicking) return;
    this.isTicking = true;
    try {
      for (let index = 0; index < this.maxJobsPerTick; index += 1) {
        const job = await this.queue.dequeue();
        if (!job) break;
        await this.process(job);
      }
      this.metrics.ticks += 1;
      this.metrics.lastTickAt = this.now();
      this.metrics.lastError = null;
    } catch (error) {
      const failure = toPreviewError(error);
      this.metrics.lastError = failure.message;
      this.logger.error('[invoice-preview] tick failed', {
        error: failure.message,
        code: failure.code,
      });
    } finally {
      this.isTicking = false;
      this.onMetrics?.(this.getMetrics());
    }
  }

  /** Process a single job. Exposed for direct consumer integration and tests. */
  async process(job: PreviewJobHandle<InvoicePreviewJobPayload>): Promise<void> {
    const payload = job.data;
    const startedAt = this.now();
    let cacheKey = 'invalid';

    this.metrics.jobsDequeued += 1;
    try {
      validatePreviewPayload(payload);
      cacheKey = previewCacheKey(payload);

      if (payload.reason && this.invalidationReasons.has(payload.reason)) {
        this.cache.invalidate(payload.invoiceId);
        if (payload.tenantId) this.cache.invalidateTenant?.(payload.tenantId);
        this.logger.debug('[invoice-preview] invalidated stale preview', {
          invoiceId: payload.invoiceId,
          reason: payload.reason,
        });
      }

      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.metrics.cacheHits += 1;
        this.emit('cache-hit', payload, cacheKey, startedAt);
        return;
      }

      const { deduplicated } = await this.renderSingleFlight(cacheKey, payload);
      if (deduplicated) this.metrics.deduplicated += 1;
      else this.metrics.rendered += 1;
      this.emit(deduplicated ? 'deduplicated' : 'rendered', payload, cacheKey, startedAt);
    } catch (error) {
      await this.handleFailure(payload, toPreviewError(error), cacheKey, startedAt);
    }
  }

  private renderSingleFlight(
    cacheKey: string,
    payload: InvoicePreviewJobPayload
  ): Promise<{ preview: CachedInvoicePreview; deduplicated: boolean }> {
    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      return existing.then((preview) => ({ preview, deduplicated: true }));
    }

    const render = (async (): Promise<CachedInvoicePreview> => {
      const rendered: InvoicePreviewRenderResult = await this.renderer.render(payload);
      if (!rendered || typeof rendered.html !== 'string' || !rendered.version) {
        throw new InvoicePreviewError(
          'Renderer returned an incomplete preview',
          'RENDER_FAILED',
          true
        );
      }
      const renderedAt = this.now();
      const preview: CachedInvoicePreview = {
        ...rendered,
        key: cacheKey,
        renderedAt,
        expiresAt: renderedAt + this.ttlMs,
      };
      this.cache.set(cacheKey, preview);
      return preview;
    })();

    const tracked = render.finally(() => {
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, tracked);
    return tracked.then((preview) => ({ preview, deduplicated: false }));
  }

  private async handleFailure(
    payload: InvoicePreviewJobPayload | undefined,
    originalFailure: InvoicePreviewError,
    cacheKey: string,
    startedAt: number
  ): Promise<void> {
    let failure = originalFailure;
    this.metrics.failures += 1;
    this.metrics.lastError = failure.message;
    this.logger.warn('[invoice-preview] job failed', {
      invoiceId: payload?.invoiceId,
      code: failure.code,
      error: failure.message,
      attempt: (payload?.attempt ?? 0) + 1,
    });

    const nextAttempt = (payload?.attempt ?? 0) + 1;
    if (failure.retryable && nextAttempt < this.maxAttempts && payload) {
      try {
        await enqueueInvoicePreview(
          this.queue,
          { ...payload, attempt: nextAttempt },
          {
            jobId: previewJobId(payload),
            delay: previewRetryDelay(nextAttempt, this.retryBaseMs, this.retryMaxMs),
          }
        );
        this.metrics.retries += 1;
        this.emit(
          'retry-scheduled',
          { ...payload, attempt: nextAttempt },
          cacheKey,
          startedAt,
          failure
        );
        return;
      } catch (queueError) {
        failure = new InvoicePreviewError(
          `Failed to schedule preview retry: ${toPreviewError(queueError).message}`,
          'QUEUE_FAILED',
          false
        );
      }
    }

    if (payload) this.onDeadLetter?.(payload, failure);
    this.metrics.deadLettered += 1;
    const type: PreviewEventType =
      failure.code === 'INVALID_PAYLOAD' ? 'invalid-payload' : 'dead-letter';
    this.emit(type, payload, cacheKey, startedAt, failure);
  }

  private emit(
    type: PreviewEventType,
    payload: InvoicePreviewJobPayload | undefined,
    cacheKey: string,
    startedAt: number,
    error?: InvoicePreviewError
  ): void {
    const event: PreviewEvent = {
      type,
      invoiceId: payload?.invoiceId,
      cacheKey,
      attempts: (payload?.attempt ?? 0) + 1,
      durationMs: Math.max(0, this.now() - startedAt),
      error: error?.message,
    };
    this.logger.debug('[invoice-preview] job result', event as unknown as Record<string, unknown>);
    this.onEvent?.(event);
    this.onMetrics?.(this.getMetrics());
  }
}
