import crypto from 'crypto';
import type {
  WebhookAnalytics,
  WebhookConfig,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEventInput,
  WebhookEventPayload,
  WebhookEventType,
  WebhookRateLimitConfig,
  WebhookRetryPolicy,
  WebhookSecret,
} from '../../../src/types/webhook';

export type { WebhookEventInput } from '../../../src/types/webhook';

type FetchLike = typeof fetch;

export interface RegisterWebhookInput {
  merchantId: string;
  url: string;
  events: WebhookEventType[];
  secretKey: string;
  retryPolicy?: Partial<WebhookRetryPolicy>;
  rateLimitPerMinute?: number;
  rateLimit?: WebhookRateLimitConfig;
  isPaused?: boolean;
}

export interface WebhookDeliveryResult {
  delivery: WebhookDelivery;
  response?: Response;
}

export const WEBHOOK_IDEMPOTENCY_HEADER = 'Idempotency-Key';

const MAX_PAYLOAD_BYTES = 1_048_576;
const BODY_PREVIEW_CHARS = 500;
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1_000; // 24 hours
const DEFAULT_BURST_WINDOW_MS = 1_000;
const DLQ_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000; // 30 days

// Default retry schedule: 1min, 5min, 15min, 1h, 6h (5 attempts after the first).
const DEFAULT_RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];

const DEFAULT_RETRY_POLICY: WebhookRetryPolicy = {
  maxRetries: 5,
  initialDelayMs: DEFAULT_RETRY_DELAYS_MS[0],
  maxDelayMs: DEFAULT_RETRY_DELAYS_MS[DEFAULT_RETRY_DELAYS_MS.length - 1],
  backoffFactor: 2,
  retryDelaysMs: DEFAULT_RETRY_DELAYS_MS,
};

const now = (): number => Date.now();

const createId = (prefix: string): string =>
  `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const clampRetryPolicy = (retryPolicy?: Partial<WebhookRetryPolicy>): WebhookRetryPolicy => ({
  maxRetries: retryPolicy?.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
  initialDelayMs: retryPolicy?.initialDelayMs ?? DEFAULT_RETRY_POLICY.initialDelayMs,
  maxDelayMs: retryPolicy?.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs,
  backoffFactor: retryPolicy?.backoffFactor ?? DEFAULT_RETRY_POLICY.backoffFactor,
  // Only fall back to the fixed default schedule when the caller didn't ask
  // for a custom policy at all — an explicit custom policy keeps using the
  // exponential formula unless it supplies its own retryDelaysMs.
  retryDelaysMs: retryPolicy?.retryDelaysMs ?? (retryPolicy ? undefined : DEFAULT_RETRY_POLICY.retryDelaysMs),
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const sha256Hex = (data: string): string => crypto.createHash('sha256').update(data).digest('hex');

export const signWebhookPayload = (payload: WebhookEventPayload, secretKey: string): string => {
  const body = JSON.stringify(payload);
  return crypto.createHmac('sha256', secretKey).update(body).digest('hex');
};

export const verifyWebhookSignature = (
  signature: string,
  payload: WebhookEventPayload,
  secretKey: string
): boolean => {
  const expected = signWebhookPayload(payload, secretKey);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  return crypto.timingSafeEqual(actualBytes, expectedBytes);
};

export const buildWebhookPayload = (input: WebhookEventInput): WebhookEventPayload => {
  const eventId = createId('evt');
  return {
    id: eventId,
    webhookId: input.webhookId,
    eventType: input.eventType,
    occurredAt: input.occurredAt ?? now(),
    merchantId: input.merchantId,
    subscription: input.subscription,
    plan: input.plan,
    previousStatus: input.previousStatus,
    currentStatus: input.currentStatus,
    payloadVersion: 1,
  };
};

export const isWebhookEventAllowed = (
  webhook: Pick<WebhookConfig, 'events' | 'isPaused'>,
  eventType: WebhookEventType
): boolean => !webhook.isPaused && webhook.events.includes(eventType);

/** Returns true if `signature` matches any signing secret currently valid for `webhook`. */
export const verifyWebhookSignatureAny = (
  webhook: Pick<WebhookConfig, 'secrets' | 'secretKey'>,
  signature: string,
  payload: WebhookEventPayload,
  at: number = Date.now()
): boolean => {
  const secrets = webhook.secrets?.length ? webhook.secrets : [{ key: webhook.secretKey, createdAt: at, validFrom: at }];
  return secrets.some((secret) => {
    if (at < secret.validFrom) return false;
    if (secret.validUntil !== undefined && at > secret.validUntil) return false;
    return verifyWebhookSignature(signature, payload, secret.key);
  });
};

export class WebhookDeliveryService {
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly webhooks = new Map<string, WebhookConfig>();
  private readonly deliveries = new Map<string, WebhookDelivery>();
  private readonly deliveredKeys = new Map<string, number>();
  private readonly rateLimitWindows = new Map<string, number[]>();
  private readonly burstWindows = new Map<string, number[]>();
  private readonly deadLetters = new Map<string, number>();

  constructor(options: { fetchImpl?: FetchLike; sleepImpl?: (ms: number) => Promise<void> } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? sleep;
  }

  registerWebhook(input: RegisterWebhookInput): WebhookConfig {
    const id = createId('whk');
    const createdAt = now();
    const config: WebhookConfig = {
      id,
      merchantId: input.merchantId,
      url: input.url,
      events: [...input.events],
      secretKey: input.secretKey,
      secrets: [{ key: input.secretKey, createdAt, validFrom: createdAt }],
      retryPolicy: clampRetryPolicy(input.retryPolicy),
      rateLimitPerMinute: input.rateLimitPerMinute,
      rateLimit: input.rateLimit,
      isPaused: input.isPaused ?? false,
      disabledReason: undefined,
      createdAt,
      updatedAt: createdAt,
      lastHealthCheckAt: undefined,
      lastHealthStatus: undefined,
      successCount: 0,
      failureCount: 0,
    };

    this.webhooks.set(id, config);
    return config;
  }

  updateWebhook(
    id: string,
    input: Partial<Omit<RegisterWebhookInput, 'merchantId'>>
  ): WebhookConfig {
    const existing = this.webhooks.get(id);
    if (!existing) throw new Error(`Webhook ${id} not found`);

    const next: WebhookConfig = {
      ...existing,
      url: input.url ?? existing.url,
      events: input.events ? [...input.events] : existing.events,
      secretKey: input.secretKey ?? existing.secretKey,
      retryPolicy: clampRetryPolicy(input.retryPolicy ?? existing.retryPolicy),
      rateLimitPerMinute: input.rateLimitPerMinute ?? existing.rateLimitPerMinute,
      rateLimit: input.rateLimit ?? existing.rateLimit,
      isPaused: input.isPaused ?? existing.isPaused,
      updatedAt: now(),
    };

    this.webhooks.set(id, next);
    return next;
  }

  deleteWebhook(id: string): void {
    this.webhooks.delete(id);
  }

  pauseWebhook(id: string): WebhookConfig {
    return this.updateWebhook(id, { isPaused: true });
  }

  resumeWebhook(id: string): WebhookConfig {
    const existing = this.webhooks.get(id);
    if (!existing) throw new Error(`Webhook ${id} not found`);
    const next: WebhookConfig = { ...existing, isPaused: false, disabledReason: undefined, updatedAt: now() };
    this.webhooks.set(id, next);
    return next;
  }

  /**
   * Rotates the active signing secret. The previous secret stays valid until
   * `now + overlapMs` so in-flight receivers have time to pick up the new one.
   */
  rotateSecret(id: string, newSecret: string, overlapMs = 24 * 60 * 60 * 1_000): WebhookConfig {
    const existing = this.webhooks.get(id);
    if (!existing) throw new Error(`Webhook ${id} not found`);

    const rotatedAt = now();
    const secrets: WebhookSecret[] = (existing.secrets ?? []).map((secret) =>
      secret.validUntil === undefined ? { ...secret, validUntil: rotatedAt + overlapMs } : secret
    );
    secrets.push({ key: newSecret, createdAt: rotatedAt, validFrom: rotatedAt });

    const next: WebhookConfig = {
      ...existing,
      secretKey: newSecret,
      secrets,
      updatedAt: rotatedAt,
    };
    this.webhooks.set(id, next);
    return next;
  }

  listWebhooks(merchantId: string): WebhookConfig[] {
    return Array.from(this.webhooks.values()).filter(
      (webhook) => webhook.merchantId === merchantId
    );
  }

  getWebhook(id: string): WebhookConfig | undefined {
    return this.webhooks.get(id);
  }

  getWebhookDeliveries(webhookId: string, limit: number): WebhookDelivery[] {
    return Array.from(this.deliveries.values())
      .filter((delivery) => delivery.webhookId === webhookId)
      .slice(-Math.max(0, limit));
  }

  getDelivery(deliveryId: string): WebhookDelivery | undefined {
    return this.deliveries.get(deliveryId);
  }

  /** Deliveries that have exhausted retries and are awaiting manual replay. */
  listDeadLetters(webhookId?: string): WebhookDelivery[] {
    return Array.from(this.deadLetters.keys())
      .map((deliveryId) => this.deliveries.get(deliveryId))
      .filter((delivery): delivery is WebhookDelivery => !!delivery)
      .filter((delivery) => !webhookId || delivery.webhookId === webhookId)
      .sort((a, b) => (a.deadLetteredAt ?? 0) - (b.deadLetteredAt ?? 0));
  }

  /**
   * Manually replay a dead-lettered delivery, resetting its attempt count.
   * On success the entry is cleared from the DLQ; on renewed failure it is re-queued.
   */
  async replayDeadLetter(deliveryId: string): Promise<WebhookDeliveryResult> {
    if (!this.deadLetters.has(deliveryId)) {
      throw new Error(`Delivery ${deliveryId} is not in the dead-letter queue`);
    }
    return this.retryWebhookDelivery(deliveryId);
  }

  /** Removes dead-lettered deliveries older than `maxAgeMs`. Returns the count purged. */
  cleanupDeadLetters(maxAgeMs: number = DLQ_RETENTION_MS): number {
    const cutoff = now() - maxAgeMs;
    let purged = 0;
    for (const [deliveryId, deadLetteredAt] of this.deadLetters) {
      if (deadLetteredAt < cutoff) {
        this.deadLetters.delete(deliveryId);
        this.deliveries.delete(deliveryId);
        purged++;
      }
    }
    return purged;
  }

  /** Removes idempotency keys older than the 24h dedup window. Returns the count purged. */
  cleanupExpiredIdempotencyKeys(windowMs: number = IDEMPOTENCY_WINDOW_MS): number {
    const cutoff = now() - windowMs;
    let purged = 0;
    for (const [key, deliveredAt] of this.deliveredKeys) {
      if (deliveredAt < cutoff) {
        this.deliveredKeys.delete(key);
        purged++;
      }
    }
    return purged;
  }

  /** Deliveries currently due for an automatic retry (used by the delivery worker). */
  getDueRetries(at: number = now()): WebhookDelivery[] {
    return Array.from(this.deliveries.values()).filter(
      (delivery) =>
        delivery.status === 'retrying' &&
        !this.deadLetters.has(delivery.id) &&
        delivery.nextRetryAt !== undefined &&
        delivery.nextRetryAt <= at
    );
  }

  /** Processes every delivery currently due for retry. Used by the delivery worker cron. */
  async processDueRetries(): Promise<WebhookDeliveryResult[]> {
    const due = this.getDueRetries();
    const results: WebhookDeliveryResult[] = [];
    for (const delivery of due) {
      const webhook = this.webhooks.get(delivery.webhookId);
      if (!webhook) continue;
      results.push(await this.sendWithRetry(webhook, delivery));
    }
    return results;
  }

  getAnalytics(webhookId: string): WebhookAnalytics {
    const deliveries = this.getWebhookDeliveries(webhookId, Number.MAX_SAFE_INTEGER);
    const totalDeliveries = deliveries.length;
    const successfulDeliveries = deliveries.filter(
      (delivery) => delivery.status === 'delivered'
    ).length;
    const failedDeliveries = deliveries.filter((delivery) => delivery.status === 'failed').length;
    const pendingDeliveries = deliveries.filter((delivery) =>
      ['pending', 'retrying', 'paused'].includes(delivery.status)
    ).length;
    const retryCount = deliveries.reduce(
      (sum, delivery) => sum + Math.max(0, delivery.attempts - 1),
      0
    );
    const avgAttempts = totalDeliveries
      ? deliveries.reduce((sum, d) => sum + d.attempts, 0) / totalDeliveries
      : 0;
    const latencySamples = deliveries
      .map((delivery) => delivery.latencyMs)
      .filter((latency): latency is number => typeof latency === 'number');

    return {
      webhookId,
      totalDeliveries,
      successfulDeliveries,
      failedDeliveries,
      retryCount,
      pendingDeliveries,
      successRate: totalDeliveries ? successfulDeliveries / totalDeliveries : 0,
      avgAttempts,
      avgLatencyMs: latencySamples.length
        ? latencySamples.reduce((sum, latency) => sum + latency, 0) / latencySamples.length
        : 0,
      lastSuccessAt: deliveries
        .filter((delivery) => delivery.status === 'delivered' && delivery.deliveredAt)
        .map((delivery) => delivery.deliveredAt as number)
        .sort((a, b) => b - a)[0],
      lastFailureAt: deliveries
        .filter((delivery) => delivery.status === 'failed' && delivery.updatedAt)
        .map((delivery) => delivery.updatedAt)
        .sort((a, b) => b - a)[0],
    };
  }

  async checkWebhookHealth(id: string): Promise<WebhookConfig> {
    const webhook = this.webhooks.get(id);
    if (!webhook) throw new Error(`Webhook ${id} not found`);

    const checkedAt = now();
    try {
      const response = await this.fetchImpl(webhook.url, { method: 'HEAD' });
      const healthy = response.ok;
      const next: WebhookConfig = {
        ...webhook,
        lastHealthCheckAt: checkedAt,
        lastHealthStatus: healthy ? 'healthy' : 'unhealthy',
        updatedAt: checkedAt,
      };
      this.webhooks.set(id, next);
      return next;
    } catch {
      const next: WebhookConfig = {
        ...webhook,
        lastHealthCheckAt: checkedAt,
        lastHealthStatus: 'unhealthy',
        updatedAt: checkedAt,
      };
      this.webhooks.set(id, next);
      return next;
    }
  }

  /** True if `idempotencyKey` was already delivered successfully within the 24h dedup window. */
  private isWithinIdempotencyWindow(idempotencyKey: string): boolean {
    const deliveredAt = this.deliveredKeys.get(idempotencyKey);
    if (deliveredAt === undefined) return false;
    if (now() - deliveredAt > IDEMPOTENCY_WINDOW_MS) {
      this.deliveredKeys.delete(idempotencyKey);
      return false;
    }
    return true;
  }

  async deliverEvent(input: WebhookEventInput): Promise<WebhookDeliveryResult | null> {
    const webhook = this.webhooks.get(input.webhookId);
    if (!webhook || webhook.merchantId !== input.merchantId) return null;
    if (!isWebhookEventAllowed(webhook, input.eventType)) return null;

    const payload = buildWebhookPayload(input);
    const signature = signWebhookPayload(payload, webhook.secretKey);
    const idempotencyKey = input.idempotencyKey ?? `${payload.id}:${webhook.id}`;
    if (this.isWithinIdempotencyWindow(idempotencyKey)) {
      const delivery: WebhookDelivery = {
        id: createId('del'),
        webhookId: webhook.id,
        eventId: payload.id,
        eventType: payload.eventType,
        url: webhook.url,
        payload,
        status: 'skipped',
        attempts: 0,
        maxAttempts: webhook.retryPolicy.maxRetries,
        createdAt: now(),
        updatedAt: now(),
        signature,
        idempotencyKey,
      };
      this.deliveries.set(delivery.id, delivery);
      return { delivery };
    }

    if (this.isRateLimited(webhook)) {
      const delivery: WebhookDelivery = {
        id: createId('del'),
        webhookId: webhook.id,
        eventId: payload.id,
        eventType: payload.eventType,
        url: webhook.url,
        payload,
        status: 'retrying',
        attempts: 0,
        maxAttempts: webhook.retryPolicy.maxRetries,
        createdAt: now(),
        updatedAt: now(),
        signature,
        idempotencyKey,
        errorMessage: 'Webhook endpoint rate limited',
        nextRetryAt: now() + 60_000,
      };
      this.deliveries.set(delivery.id, delivery);
      return { delivery };
    }

    const delivery: WebhookDelivery = {
      id: createId('del'),
      webhookId: webhook.id,
      eventId: payload.id,
      eventType: payload.eventType,
      url: webhook.url,
      payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: webhook.retryPolicy.maxRetries,
      createdAt: now(),
      updatedAt: now(),
      signature,
      idempotencyKey,
    };

    this.deliveries.set(delivery.id, delivery);
    const result = await this.sendWithRetry(webhook, delivery);
    this.deliveries.set(delivery.id, result.delivery);

    if (result.delivery.status === 'delivered') {
      this.deliveredKeys.set(idempotencyKey, now());
    }
    return result;
  }

  async retryWebhookDelivery(deliveryId: string): Promise<WebhookDeliveryResult> {
    const existing = this.deliveries.get(deliveryId);
    if (!existing) throw new Error(`Delivery ${deliveryId} not found`);
    const webhook = this.webhooks.get(existing.webhookId);
    if (!webhook) throw new Error(`Webhook ${existing.webhookId} not found`);

    const restarted: WebhookDelivery = {
      ...existing,
      attempts: 0,
      status: 'retrying',
      updatedAt: now(),
      nextRetryAt: undefined,
      errorMessage: undefined,
    };

    this.deliveries.set(deliveryId, restarted);
    const result = await this.sendWithRetry(webhook, restarted);
    this.deliveries.set(deliveryId, result.delivery);

    if (result.delivery.status === 'delivered') {
      this.deliveredKeys.set(existing.idempotencyKey, now());
    }
    return result;
  }

  private async sendWithRetry(
    webhook: WebhookConfig,
    delivery: WebhookDelivery
  ): Promise<WebhookDeliveryResult> {
    const fullPayloadBody = JSON.stringify(delivery.payload);
    const fullByteLength = Buffer.byteLength(fullPayloadBody, 'utf8');
    let payloadBody = fullPayloadBody;
    let payloadTruncated = false;
    let payloadHash: string | undefined;
    if (fullByteLength > MAX_PAYLOAD_BYTES) {
      payloadHash = sha256Hex(fullPayloadBody);
      payloadBody = Buffer.from(fullPayloadBody, 'utf8').subarray(0, MAX_PAYLOAD_BYTES).toString('utf8');
      payloadTruncated = true;
    }
    const bodyPreview = payloadBody.slice(0, BODY_PREVIEW_CHARS);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-SubTrackr-Signature': delivery.signature,
      'X-SubTrackr-Event-Type': delivery.eventType,
      'X-SubTrackr-Event-Id': delivery.eventId,
      [WEBHOOK_IDEMPOTENCY_HEADER]: delivery.idempotencyKey,
    };
    if (payloadTruncated) {
      headers['X-SubTrackr-Payload-Truncated'] = 'true';
      headers['X-SubTrackr-Payload-Hash'] = payloadHash as string;
    }

    let attempt = delivery.attempts;
    let lastError: string | undefined;
    const maxAttempts = Math.max(1, webhook.retryPolicy.maxRetries + 1);

    while (attempt < maxAttempts) {
      attempt += 1;
      const attemptAt = now();
      const next: WebhookDelivery = {
        ...delivery,
        status: attempt === 1 ? 'pending' : 'retrying',
        attempts: attempt,
        lastAttemptAt: attemptAt,
        updatedAt: attemptAt,
        bodyPreview,
        payloadTruncated,
        payloadHash,
      };
      this.deliveries.set(delivery.id, next);

      try {
        const response = await this.fetchImpl(webhook.url, {
          method: 'POST',
          headers,
          body: payloadBody,
        });

        if (response.status === 410) {
          // Endpoint is permanently gone — stop retrying and disable the webhook.
          this.webhooks.set(webhook.id, {
            ...webhook,
            isPaused: true,
            disabledReason: 'Endpoint returned 410 Gone',
            updatedAt: now(),
          });
          return this.finalizeDelivery(webhook, next, {
            status: 'failed',
            responseCode: 410,
            errorMessage: 'Endpoint returned 410 Gone (webhook auto-disabled)',
          }, undefined, true);
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return this.finalizeDelivery(
          webhook,
          next,
          {
            status: 'delivered',
            responseCode: response.status,
            deliveredAt: now(),
            latencyMs: now() - attemptAt,
          },
          response
        );
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Webhook delivery failed';
        const isLastAttempt = attempt >= maxAttempts;
        const delay = this.computeDelay(webhook.retryPolicy, attempt);

        if (isLastAttempt) {
          return this.finalizeDelivery(webhook, next, {
            status: 'failed',
            errorMessage: lastError,
            responseCode: undefined,
          }, undefined, true);
        }

        const retried: WebhookDelivery = {
          ...next,
          status: 'retrying',
          errorMessage: lastError,
          nextRetryAt: now() + delay,
        };
        this.deliveries.set(delivery.id, retried);
        await this.sleepImpl(delay);
      }
    }

    return this.finalizeDelivery(webhook, delivery, {
      status: 'failed',
      errorMessage: lastError ?? 'Webhook delivery failed',
    }, undefined, true);
  }

  private finalizeDelivery(
    webhook: WebhookConfig,
    delivery: WebhookDelivery,
    patch: Partial<WebhookDelivery> & { status: WebhookDeliveryStatus },
    response?: Response,
    deadLetterOnFailure = false
  ): WebhookDeliveryResult {
    const finalizedAt = now();
    const next: WebhookDelivery = {
      ...delivery,
      ...patch,
      updatedAt: finalizedAt,
    };

    if (deadLetterOnFailure && next.status === 'failed') {
      next.isDeadLettered = true;
      next.deadLetteredAt = finalizedAt;
      this.deadLetters.set(next.id, finalizedAt);
    } else if (next.status === 'delivered' && this.deadLetters.has(next.id)) {
      // A manual retry succeeded for a previously dead-lettered delivery.
      this.deadLetters.delete(next.id);
      next.isDeadLettered = false;
      next.deadLetteredAt = undefined;
    }

    this.deliveries.set(delivery.id, next);

    const configPatch: Partial<WebhookConfig> = {
      updatedAt: next.updatedAt,
      successCount: next.status === 'delivered' ? webhook.successCount + 1 : webhook.successCount,
      failureCount: next.status === 'failed' ? webhook.failureCount + 1 : webhook.failureCount,
      lastHealthStatus:
        next.status === 'delivered'
          ? 'healthy'
          : next.status === 'failed'
            ? 'degraded'
            : webhook.lastHealthStatus,
    };
    this.webhooks.set(webhook.id, { ...this.webhooks.get(webhook.id)!, ...configPatch });

    return { delivery: next, response };
  }

  private computeDelay(policy: WebhookRetryPolicy, attempt: number): number {
    if (policy.retryDelaysMs?.length) {
      const schedule = policy.retryDelaysMs;
      return schedule[Math.min(attempt - 1, schedule.length - 1)];
    }
    const factor = policy.backoffFactor ?? DEFAULT_RETRY_POLICY.backoffFactor ?? 2;
    const rawDelay = Math.floor(policy.initialDelayMs * Math.pow(factor, Math.max(0, attempt - 1)));
    return Math.min(rawDelay, policy.maxDelayMs);
  }

  private isRateLimited(webhook: WebhookConfig): boolean {
    const nowMs = now();

    if (webhook.rateLimit) {
      const burstWindowMs = webhook.rateLimit.burstWindowMs ?? DEFAULT_BURST_WINDOW_MS;
      const burstStart = nowMs - burstWindowMs;
      const burstCurrent = (this.burstWindows.get(webhook.id) ?? []).filter((t) => t >= burstStart);
      const steadyStart = nowMs - 60_000;
      const steadyCurrent = (this.rateLimitWindows.get(webhook.id) ?? []).filter((t) => t >= steadyStart);

      if (
        burstCurrent.length >= webhook.rateLimit.burstLimit ||
        steadyCurrent.length >= webhook.rateLimit.steadyPerMinute
      ) {
        this.burstWindows.set(webhook.id, burstCurrent);
        this.rateLimitWindows.set(webhook.id, steadyCurrent);
        return true;
      }

      burstCurrent.push(nowMs);
      steadyCurrent.push(nowMs);
      this.burstWindows.set(webhook.id, burstCurrent);
      this.rateLimitWindows.set(webhook.id, steadyCurrent);
      return false;
    }

    if (!webhook.rateLimitPerMinute || webhook.rateLimitPerMinute <= 0) return false;
    const windowStart = nowMs - 60_000;
    const current = (this.rateLimitWindows.get(webhook.id) ?? []).filter(
      (timestamp) => timestamp >= windowStart
    );
    if (current.length >= webhook.rateLimitPerMinute) {
      this.rateLimitWindows.set(webhook.id, current);
      return true;
    }
    current.push(nowMs);
    this.rateLimitWindows.set(webhook.id, current);
    return false;
  }
}

export const webhookDeliveryService = new WebhookDeliveryService();
