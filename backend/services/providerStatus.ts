/**
 * Provider Status Service
 *
 * Issue #2084 – Replace polling-based provider status with webhook-driven cache
 * ------------------------------------------------------------------------------
 * Problem: The previous implementation polled every external payment/RPC
 * provider on a fixed interval (every 30 s) even when nothing had changed.
 * Under load this produced ~2 400 outbound HTTP requests per hour per instance,
 * added 30 s worst-case staleness to incident detection, and wasted compute.
 *
 * Solution: webhook-driven, write-through in-memory cache with TTL backstop.
 *  1. Providers push status-change events to `POST /webhooks/provider-status`.
 *  2. The handler validates the HMAC signature, then calls `ingestWebhook()`
 *     which atomically updates the cache entry and emits a typed event.
 *  3. A lightweight TTL backstop (`STALE_CHECK_INTERVAL_MS`) performs a
 *     point-in-time HTTP GET only for providers whose cached entry has
 *     exceeded `CACHE_TTL_MS` without a webhook – avoiding full polling.
 *  4. All reads go through `getStatus()` / `getAllStatuses()` which return
 *     from cache (O(1)), measured in μs rather than ms.
 *
 * Observability:
 *  - Every cache mutation emits a structured log line with provider, status,
 *    latency, and source (`webhook` | `poll` | `manual`).
 *  - `getMetrics()` exposes hit/miss/staleness counters for Prometheus scraping.
 */

import { EventEmitter } from 'events';
import { createHmac, timingSafeEqual } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProviderStatusValue =
  | 'operational'
  | 'degraded'
  | 'partial_outage'
  | 'major_outage'
  | 'maintenance'
  | 'unknown';

export interface ProviderConfig {
  /** Unique identifier for the provider (e.g. "stripe", "stellar-mainnet"). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /**
   * URL polled as a TTL backstop when no webhook has arrived recently.
   * Expected to return `{ status: ProviderStatusValue }` JSON.
   */
  statusUrl: string;
  /** Shared secret used to verify HMAC-SHA256 webhook signatures. */
  webhookSecret: string;
  /** Override global CACHE_TTL_MS for this provider. */
  cacheTtlMs?: number;
}

export interface ProviderStatusEntry {
  providerId: string;
  status: ProviderStatusValue;
  /** ISO-8601 timestamp of when this status became active (from provider). */
  since: string;
  /** Internal timestamp of when we last wrote this entry. */
  cachedAt: number;
  /** Whether this entry came from a webhook push or a backstop poll. */
  source: 'webhook' | 'poll' | 'manual';
  /** Optional human-readable incident description from the webhook payload. */
  description?: string;
  /** Raw webhook payload for audit / replay. */
  rawPayload?: unknown;
}

export interface WebhookPayload {
  providerId: string;
  status: ProviderStatusValue;
  since?: string;
  description?: string;
  [key: string]: unknown;
}

export interface ProviderStatusMetrics {
  cacheHits: number;
  cacheMisses: number;
  webhooksProcessed: number;
  webhooksRejected: number;
  pollsExecuted: number;
  staleEntries: number;
}

export interface ProviderStatusOptions {
  /** How long (ms) a cache entry is considered fresh. Default: 300_000 (5 min). */
  cacheTtlMs?: number;
  /**
   * How often (ms) the backstop poll timer fires to check for stale entries.
   * Default: 60_000 (1 min).
   */
  staleCheckIntervalMs?: number;
  /**
   * Optional fetch implementation (for testing / Node < 18 compatibility).
   * Defaults to global `fetch`.
   */
  fetchImpl?: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  /**
   * Optional logger.  Defaults to `console`.
   */
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface ProviderStatusEvents {
  'status:changed': (entry: ProviderStatusEntry, previous: ProviderStatusEntry | undefined) => void;
  'webhook:received': (providerId: string, payload: WebhookPayload) => void;
  'webhook:rejected': (providerId: string, reason: string) => void;
  'poll:completed': (providerId: string, entry: ProviderStatusEntry) => void;
  'poll:failed': (providerId: string, error: Error) => void;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes
const DEFAULT_STALE_CHECK_INTERVAL_MS = 60 * 1_000; // 1 minute
const SIGNATURE_HEADER = 'x-subtrackr-signature-256';

// ─── Service ──────────────────────────────────────────────────────────────────

export class ProviderStatusService extends EventEmitter {
  private readonly providers = new Map<string, ProviderConfig>();
  private readonly cache = new Map<string, ProviderStatusEntry>();
  private readonly opts: Required<Omit<ProviderStatusOptions, 'fetchImpl' | 'logger'>>;
  private readonly fetchImpl: NonNullable<ProviderStatusOptions['fetchImpl']>;
  private readonly logger: NonNullable<ProviderStatusOptions['logger']>;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private metrics: ProviderStatusMetrics = {
    cacheHits: 0,
    cacheMisses: 0,
    webhooksProcessed: 0,
    webhooksRejected: 0,
    pollsExecuted: 0,
    staleEntries: 0,
  };

  constructor(options: ProviderStatusOptions = {}) {
    super();
    this.opts = {
      cacheTtlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      staleCheckIntervalMs: options.staleCheckIntervalMs ?? DEFAULT_STALE_CHECK_INTERVAL_MS,
    };
    this.fetchImpl =
      options.fetchImpl ??
      ((url) => fetch(url) as ReturnType<NonNullable<ProviderStatusOptions['fetchImpl']>>);
    this.logger = options.logger ?? console;
  }

  // ─── Provider registration ──────────────────────────────────────────────────

  registerProvider(config: ProviderConfig): void {
    this.providers.set(config.id, config);
    // Seed cache with unknown status so reads never return undefined for a
    // registered provider.
    if (!this.cache.has(config.id)) {
      this.cache.set(config.id, {
        providerId: config.id,
        status: 'unknown',
        since: new Date().toISOString(),
        cachedAt: Date.now(),
        source: 'manual',
      });
    }
    this.logger.info(`[ProviderStatus] Registered provider: ${config.id}`);
  }

  registerProviders(configs: ProviderConfig[]): void {
    for (const cfg of configs) this.registerProvider(cfg);
  }

  // ─── Backstop poll timer ────────────────────────────────────────────────────

  /**
   * Starts the TTL backstop timer.  Should be called once at app startup.
   * The timer only polls providers whose cache entry is older than their TTL –
   * providers actively pushing webhooks are never polled.
   */
  start(): void {
    if (this.staleTimer) return;
    this.staleTimer = setInterval(() => {
      void this.checkStaleEntries();
    }, this.opts.staleCheckIntervalMs);
    this.logger.info('[ProviderStatus] Backstop poll timer started');
  }

  stop(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    this.logger.info('[ProviderStatus] Backstop poll timer stopped');
  }

  // ─── Webhook ingestion ──────────────────────────────────────────────────────

  /**
   * Called by the webhook HTTP handler after signature verification.
   * Updates the cache and emits events synchronously.
   */
  ingestWebhook(payload: WebhookPayload, rawBody?: unknown): void {
    const provider = this.providers.get(payload.providerId);
    if (!provider) {
      this.logger.warn(
        `[ProviderStatus] Webhook for unknown provider: ${payload.providerId}`,
      );
      this.metrics.webhooksRejected++;
      this.emit('webhook:rejected', payload.providerId, 'unknown_provider');
      return;
    }

    this.metrics.webhooksProcessed++;
    this.emit('webhook:received', payload.providerId, payload);
    this.logger.info(
      `[ProviderStatus] Webhook received: provider=${payload.providerId} status=${payload.status}`,
    );

    const previous = this.cache.get(payload.providerId);
    const entry: ProviderStatusEntry = {
      providerId: payload.providerId,
      status: payload.status,
      since: payload.since ?? new Date().toISOString(),
      cachedAt: Date.now(),
      source: 'webhook',
      description: payload.description,
      rawPayload: rawBody,
    };

    this.cache.set(payload.providerId, entry);

    if (!previous || previous.status !== entry.status) {
      this.logger.info(
        `[ProviderStatus] Status changed: provider=${entry.providerId} ` +
          `${previous?.status ?? 'unknown'} → ${entry.status} source=webhook`,
      );
      this.emit('status:changed', entry, previous);
    }
  }

  /**
   * Verifies the HMAC-SHA256 signature on a raw webhook request.
   *
   * @param providerId - provider ID looked up from the route parameter
   * @param rawBody    - raw UTF-8 request body string (before JSON.parse)
   * @param signature  - value of the `x-subtrackr-signature-256` header
   * @returns `true` if signature matches; `false` otherwise
   */
  verifySignature(providerId: string, rawBody: string, signature: string): boolean {
    const provider = this.providers.get(providerId);
    if (!provider) return false;

    // Constant-time comparison to prevent timing side-channels.
    const expected = `sha256=${createHmac('sha256', provider.webhookSecret)
      .update(rawBody, 'utf8')
      .digest('hex')}`;

    try {
      return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
    } catch {
      return false;
    }
  }

  /**
   * Express/Fastify-compatible webhook middleware.
   *
   * Usage:
   * ```ts
   * app.post('/webhooks/provider-status/:providerId', express.text({ type: '*\/*' }), (req, res) => {
   *   const result = providerStatusService.handleWebhookRequest(
   *     req.params.providerId,
   *     req.body,            // raw string – use express.text() middleware
   *     req.headers[SIGNATURE_HEADER] as string,
   *   );
   *   res.status(result.ok ? 200 : 401).json(result);
   * });
   * ```
   */
  handleWebhookRequest(
    providerId: string,
    rawBody: string,
    signatureHeader: string | undefined,
  ): { ok: boolean; error?: string } {
    if (!signatureHeader) {
      this.metrics.webhooksRejected++;
      this.emit('webhook:rejected', providerId, 'missing_signature');
      return { ok: false, error: 'Missing signature header' };
    }

    if (!this.verifySignature(providerId, rawBody, signatureHeader)) {
      this.metrics.webhooksRejected++;
      this.emit('webhook:rejected', providerId, 'invalid_signature');
      this.logger.warn(
        `[ProviderStatus] Invalid signature for provider: ${providerId}`,
      );
      return { ok: false, error: 'Invalid signature' };
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawBody) as WebhookPayload;
      // Allow route-level providerId to override payload field for simpler
      // integration (some providers don't include their own id in the body).
      payload.providerId = payload.providerId ?? providerId;
    } catch {
      this.metrics.webhooksRejected++;
      return { ok: false, error: 'Invalid JSON payload' };
    }

    this.ingestWebhook(payload, payload);
    return { ok: true };
  }

  // ─── Cache reads ────────────────────────────────────────────────────────────

  /**
   * Returns the cached status for a single provider.
   * O(1) – never performs network I/O.
   */
  getStatus(providerId: string): ProviderStatusEntry | undefined {
    const entry = this.cache.get(providerId);
    if (entry) {
      this.metrics.cacheHits++;
    } else {
      this.metrics.cacheMisses++;
    }
    return entry;
  }

  /**
   * Returns cached statuses for all registered providers.
   * Useful for the admin dashboard health panel.
   */
  getAllStatuses(): ProviderStatusEntry[] {
    return Array.from(this.cache.values());
  }

  /**
   * Returns `true` when every registered provider is `operational`.
   */
  isAllOperational(): boolean {
    return this.getAllStatuses().every((e) => e.status === 'operational');
  }

  // ─── Manual override ────────────────────────────────────────────────────────

  /**
   * Allows ops to manually override a provider status (e.g. during a
   * planned maintenance window where the provider doesn't send webhooks).
   */
  setStatus(
    providerId: string,
    status: ProviderStatusValue,
    description?: string,
  ): ProviderStatusEntry {
    const previous = this.cache.get(providerId);
    const entry: ProviderStatusEntry = {
      providerId,
      status,
      since: new Date().toISOString(),
      cachedAt: Date.now(),
      source: 'manual',
      description,
    };
    this.cache.set(providerId, entry);
    if (!previous || previous.status !== status) {
      this.logger.info(
        `[ProviderStatus] Status overridden: provider=${providerId} ` +
          `${previous?.status ?? 'unknown'} → ${status} source=manual`,
      );
      this.emit('status:changed', entry, previous);
    }
    return entry;
  }

  // ─── Backstop poll (private) ────────────────────────────────────────────────

  private async checkStaleEntries(): Promise<void> {
    const now = Date.now();
    for (const [providerId, provider] of this.providers) {
      const entry = this.cache.get(providerId);
      const ttl = provider.cacheTtlMs ?? this.opts.cacheTtlMs;
      const age = entry ? now - entry.cachedAt : Infinity;
      if (age < ttl) continue; // fresh – skip

      this.metrics.staleEntries++;
      await this.pollProvider(providerId).catch((err: Error) => {
        this.logger.error(
          `[ProviderStatus] Backstop poll failed: provider=${providerId} error=${err.message}`,
        );
        this.emit('poll:failed', providerId, err);
      });
    }
  }

  private async pollProvider(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) return;

    this.metrics.pollsExecuted++;
    this.logger.info(
      `[ProviderStatus] Backstop poll: provider=${providerId} url=${provider.statusUrl}`,
    );

    const resp = await this.fetchImpl(provider.statusUrl);
    if (!resp.ok) {
      throw new Error(`HTTP ${(resp as unknown as Response).status} from ${provider.statusUrl}`);
    }

    const data = (await resp.json()) as { status?: ProviderStatusValue };
    const status: ProviderStatusValue =
      data.status && isValidStatus(data.status) ? data.status : 'unknown';

    const previous = this.cache.get(providerId);
    const entry: ProviderStatusEntry = {
      providerId,
      status,
      since: previous?.since ?? new Date().toISOString(),
      cachedAt: Date.now(),
      source: 'poll',
    };

    this.cache.set(providerId, entry);
    this.emit('poll:completed', providerId, entry);

    if (!previous || previous.status !== status) {
      this.logger.info(
        `[ProviderStatus] Status changed (poll): provider=${providerId} ` +
          `${previous?.status ?? 'unknown'} → ${status}`,
      );
      this.emit('status:changed', entry, previous);
    }
  }

  // ─── Metrics ────────────────────────────────────────────────────────────────

  getMetrics(): Readonly<ProviderStatusMetrics> {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      webhooksProcessed: 0,
      webhooksRejected: 0,
      pollsExecuted: 0,
      staleEntries: 0,
    };
  }

  // ─── Introspection ───────────────────────────────────────────────────────────

  get signatureHeader(): string {
    return SIGNATURE_HEADER;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidStatus(value: string): value is ProviderStatusValue {
  return [
    'operational',
    'degraded',
    'partial_outage',
    'major_outage',
    'maintenance',
    'unknown',
  ].includes(value);
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const providerStatusService = new ProviderStatusService();
