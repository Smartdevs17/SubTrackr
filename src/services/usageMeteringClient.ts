/**
 * Client-Side High-Throughput Usage Event Metering SDK (Issue #2197)
 *
 * Sub-second usage event batcher with deterministic FNV-1a idempotency key
 * generation, configurable batch chunking (max 500 events per payload),
 * exponential backoff retries on transient network errors, dead-letter queue
 * callback, and optional local Zustand `meteringSlice` synchronization.
 */

export type ClientUsageMetricKind = 'api' | 'compute' | 'storage' | (string & {});

export interface DeterministicKeyInput {
  subscriptionId: string;
  metricType: string;
  amount: number;
  timestamp: Date | number | string;
  sequence?: number | string;
  dimensions?: Record<string, string>;
}

export interface ClientUsageEventInput {
  subscriptionId: string;
  metricType: ClientUsageMetricKind;
  amount: number;
  timestamp?: Date | number | string;
  idempotencyKey?: string;
  dimensions?: Record<string, string>;
}

export interface WireUsageEventPayload {
  userId: string;
  subscriptionId: string;
  metricType: string;
  amount: number;
  timestamp: string;
  idempotencyKey: string;
  dimensions?: Record<string, string>;
}

export interface ClientIngestBatchResult {
  accepted: number;
  duplicate: number;
  rejected: number;
  lateRouted?: number;
  droppedLate?: number;
  backpressureRejected?: number;
  results: {
    idempotencyKey: string;
    status: string;
    reason?: string;
    clockSkewDetected?: boolean;
  }[];
}

export interface MeteringStoreAdapter {
  recordUsage: (subscriptionId: string, metric: string, value: number) => unknown;
}

export type UsageMeteringTransport = (
  events: WireUsageEventPayload[]
) => Promise<ClientIngestBatchResult>;

export interface UsageMeteringClientConfig {
  /** Ingestion API endpoint URL (default: '/v1/usage'). */
  endpoint?: string;
  /** Optional API key or Bearer token for authenticated transport. */
  apiKey?: string;
  /** Sub-second auto-flush interval in milliseconds (default: 100ms; 0 disables background timer). */
  flushIntervalMs?: number;
  /** Maximum events per HTTP batch payload (default: 500). */
  maxBatchSize?: number;
  /** Maximum queued events before client backpressure rejects (default: 10_000). */
  maxQueueDepth?: number;
  /** Maximum retry attempts on transient transport errors (default: 3). */
  maxRetries?: number;
  /** Base exponential backoff delay in milliseconds (default: 50ms). */
  baseRetryDelayMs?: number;
  /** Custom transport function (overrides default HTTP fetch transport). */
  transport?: UsageMeteringTransport;
  /** Custom fetch implementation for HTTP transport. */
  fetchImpl?: typeof fetch;
  /** Optional callback invoked when a batch exhausts all retries and is sent to dead-letter. */
  onDeadLetter?: (events: WireUsageEventPayload[], error: Error) => void;
  /** Optional local Zustand store (`meteringSlice`) to synchronize optimistic usage increments. */
  store?: MeteringStoreAdapter;
  /** Injectable clock function for deterministic testing (default: () => Date.now()). */
  now?: () => number;
  /** Injectable sleep function for deterministic retry testing. */
  sleep?: (ms: number) => Promise<void>;
}

export interface UsageMeteringClientMetrics {
  trackedCount: number;
  flushedBatchCount: number;
  flushedEventCount: number;
  retryCount: number;
  deadLetterEventCount: number;
  droppedBackpressureCount: number;
  pendingQueueDepth: number;
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeTimestampMs(timestamp: Date | number | string): number {
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  if (typeof timestamp === 'number') {
    return timestamp;
  }
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Generates a deterministic idempotency key from canonical event fields so
 * client retries across network drops never double-bill a customer.
 */
export function generateDeterministicIdempotencyKey(input: DeterministicKeyInput): string {
  const tsMs = normalizeTimestampMs(input.timestamp);
  const sortedDims = input.dimensions
    ? Object.keys(input.dimensions)
        .sort()
        .map((k) => `${k}=${input.dimensions![k]}`)
        .join('&')
    : '';
  const seqPart = input.sequence !== undefined ? String(input.sequence) : '';
  const canonical = `${input.subscriptionId.trim()}|${input.metricType.trim()}|${input.amount}|${tsMs}|${seqPart}|${sortedDims}`;
  const digest = fnv1aHex(canonical);
  const suffix = seqPart ? `_${seqPart}` : '';
  return `idem_${input.subscriptionId.trim()}_${input.metricType.trim()}_${tsMs}_${digest}${suffix}`;
}

const DEFAULT_CLIENT_CONFIG = {
  endpoint: '/v1/usage',
  apiKey: '',
  flushIntervalMs: 100,
  maxBatchSize: 500,
  maxQueueDepth: 10_000,
  maxRetries: 3,
  baseRetryDelayMs: 50,
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export class UsageMeteringClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly maxQueueDepth: number;
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;
  private readonly transport?: UsageMeteringTransport;
  private readonly fetchImpl?: typeof fetch;
  private readonly onDeadLetter?: (events: WireUsageEventPayload[], error: Error) => void;
  private readonly store?: MeteringStoreAdapter;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly queue: WireUsageEventPayload[] = [];
  private readonly deadLetterEvents: WireUsageEventPayload[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;

  private trackedCount = 0;
  private flushedBatchCount = 0;
  private flushedEventCount = 0;
  private retryCount = 0;
  private deadLetterEventCount = 0;
  private droppedBackpressureCount = 0;

  constructor(config: UsageMeteringClientConfig = {}) {
    this.endpoint = config.endpoint ?? DEFAULT_CLIENT_CONFIG.endpoint;
    this.apiKey = config.apiKey ?? DEFAULT_CLIENT_CONFIG.apiKey;
    this.flushIntervalMs = config.flushIntervalMs ?? DEFAULT_CLIENT_CONFIG.flushIntervalMs;
    this.maxBatchSize = config.maxBatchSize ?? DEFAULT_CLIENT_CONFIG.maxBatchSize;
    this.maxQueueDepth = config.maxQueueDepth ?? DEFAULT_CLIENT_CONFIG.maxQueueDepth;
    this.maxRetries = config.maxRetries ?? DEFAULT_CLIENT_CONFIG.maxRetries;
    this.baseRetryDelayMs = config.baseRetryDelayMs ?? DEFAULT_CLIENT_CONFIG.baseRetryDelayMs;
    this.transport = config.transport;
    this.fetchImpl = config.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
    this.onDeadLetter = config.onDeadLetter;
    this.store = config.store;
    this.now = config.now ?? DEFAULT_CLIENT_CONFIG.now;
    this.sleep = config.sleep ?? DEFAULT_CLIENT_CONFIG.sleep;
  }

  /**
   * Buffers a single usage event for sub-second batch transmission and
   * optionally updates the local Zustand `meteringSlice` store.
   */
  track(input: ClientUsageEventInput): WireUsageEventPayload {
    if (!input || typeof input.subscriptionId !== 'string' || !input.subscriptionId.trim()) {
      throw new Error('subscriptionId is required');
    }
    if (typeof input.metricType !== 'string' || !input.metricType.trim()) {
      throw new Error('metricType is required');
    }
    if (typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount < 0) {
      throw new Error('amount must be a non-negative finite number');
    }

    if (this.queue.length >= this.maxQueueDepth) {
      this.droppedBackpressureCount += 1;
      throw new Error(
        `UsageMeteringClient queue depth (${this.queue.length}) reached maxQueueDepth (${this.maxQueueDepth})`
      );
    }

    const subscriptionId = input.subscriptionId.trim();
    const metricType = input.metricType.trim();
    const tsMs = input.timestamp !== undefined ? normalizeTimestampMs(input.timestamp) : this.now();
    const isoTimestamp = new Date(tsMs).toISOString();

    const idempotencyKey =
      typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim().length > 0
        ? input.idempotencyKey.trim()
        : generateDeterministicIdempotencyKey({
            subscriptionId,
            metricType,
            amount: input.amount,
            timestamp: tsMs,
            sequence: ++this.sequence,
            dimensions: input.dimensions,
          });

    const wireEvent: WireUsageEventPayload = {
      userId: subscriptionId,
      subscriptionId,
      metricType,
      amount: input.amount,
      timestamp: isoTimestamp,
      idempotencyKey,
      ...(input.dimensions ? { dimensions: { ...input.dimensions } } : {}),
    };

    this.queue.push(wireEvent);
    this.trackedCount += 1;

    if (this.store && input.amount > 0) {
      this.store.recordUsage(subscriptionId, metricType, input.amount);
    }

    if (this.queue.length >= this.maxBatchSize) {
      void this.flush();
    } else {
      this.scheduleAutoFlush();
    }

    return wireEvent;
  }

  /**
   * Buffers multiple usage events into the client queue.
   */
  trackBatch(inputs: ClientUsageEventInput[]): WireUsageEventPayload[] {
    return inputs.map((item) => this.track(item));
  }

  /**
   * Drains the client queue, splits buffered events into chunks of at most
   * `maxBatchSize`, and transmits each chunk with exponential backoff retries.
   */
  async flush(): Promise<ClientIngestBatchResult[]> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.queue.length === 0) {
      return [];
    }

    const drained = this.queue.splice(0, this.queue.length);
    const chunks: WireUsageEventPayload[][] = [];
    for (let i = 0; i < drained.length; i += this.maxBatchSize) {
      chunks.push(drained.slice(i, i + this.maxBatchSize));
    }

    const results: ClientIngestBatchResult[] = [];
    for (const chunk of chunks) {
      const batchResult = await this.sendChunkWithRetry(chunk);
      results.push(batchResult);
    }
    return results;
  }

  /**
   * Stops any pending background flush timers and flushes remaining queued events.
   */
  async stop(): Promise<ClientIngestBatchResult[]> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    return this.flush();
  }

  /**
   * Returns the current number of events waiting in the client buffer.
   */
  getPendingCount(): number {
    return this.queue.length;
  }

  /**
   * Returns events that exhausted all retry attempts and were routed to the client DLQ.
   */
  getDeadLetterEvents(): WireUsageEventPayload[] {
    return [...this.deadLetterEvents];
  }

  /**
   * Returns client telemetry counters.
   */
  getMetrics(): UsageMeteringClientMetrics {
    return {
      trackedCount: this.trackedCount,
      flushedBatchCount: this.flushedBatchCount,
      flushedEventCount: this.flushedEventCount,
      retryCount: this.retryCount,
      deadLetterEventCount: this.deadLetterEventCount,
      droppedBackpressureCount: this.droppedBackpressureCount,
      pendingQueueDepth: this.queue.length,
    };
  }

  private scheduleAutoFlush(): void {
    if (this.flushIntervalMs <= 0 || this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushIntervalMs);
    if (typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  private async sendChunkWithRetry(
    chunk: WireUsageEventPayload[]
  ): Promise<ClientIngestBatchResult> {
    let lastError: Error = new Error('Unknown transport failure');

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) {
        this.retryCount += 1;
        const delayMs = this.baseRetryDelayMs * Math.pow(2, attempt - 1);
        await this.sleep(delayMs);
      }

      try {
        const response = await this.executeTransport(chunk);
        this.flushedBatchCount += 1;
        this.flushedEventCount += chunk.length;
        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    this.deadLetterEventCount += chunk.length;
    this.deadLetterEvents.push(...chunk);
    if (this.onDeadLetter) {
      this.onDeadLetter(chunk, lastError);
    }

    return {
      accepted: 0,
      duplicate: 0,
      rejected: chunk.length,
      results: chunk.map((event) => ({
        idempotencyKey: event.idempotencyKey,
        status: 'rejected',
        reason: lastError.message,
      })),
    };
  }

  private async executeTransport(chunk: WireUsageEventPayload[]): Promise<ClientIngestBatchResult> {
    if (this.transport) {
      return this.transport(chunk);
    }

    if (!this.fetchImpl) {
      throw new Error('No transport or fetch implementation configured for UsageMeteringClient');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const httpResponse = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: chunk }),
    });

    if (!httpResponse.ok && httpResponse.status >= 400) {
      throw new Error(`HTTP ${httpResponse.status}: usage ingestion request failed`);
    }

    const payload = (await httpResponse.json()) as {
      data?: ClientIngestBatchResult;
    } & Partial<ClientIngestBatchResult>;

    if (payload && payload.data && Array.isArray(payload.data.results)) {
      return payload.data;
    }

    if (payload && Array.isArray(payload.results)) {
      return payload as ClientIngestBatchResult;
    }

    return {
      accepted: chunk.length,
      duplicate: 0,
      rejected: 0,
      results: chunk.map((e) => ({ idempotencyKey: e.idempotencyKey, status: 'accepted' })),
    };
  }
}

export function createUsageMeteringClient(config?: UsageMeteringClientConfig): UsageMeteringClient {
  return new UsageMeteringClient(config);
}
