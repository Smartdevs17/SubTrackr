import crypto from 'crypto';
import type {
  WebhookAnalytics,
  WebhookConfig,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEventInput,
  WebhookEventPayload,
  WebhookEventType,
  WebhookRetryPolicy,
} from '../../src/types/webhook';

export type { WebhookEventInput } from '../../src/types/webhook';

type FetchLike = typeof fetch;

export interface RegisterWebhookInput {
  merchantId: string;
  url: string;
  events: WebhookEventType[];
  secretKey: string;
  retryPolicy?: Partial<WebhookRetryPolicy>;
  isPaused?: boolean;
}

export interface WebhookDeliveryResult {
  delivery: WebhookDelivery;
  response?: Response;
}

const MAX_PAYLOAD_BYTES = 1_048_576;
const DEFAULT_RETRY_POLICY: WebhookRetryPolicy = {
  maxRetries: 5,
  initialDelayMs: 250,
  maxDelayMs: 8_000,
  backoffFactor: 2,
};

const now = (): number => Date.now();

const createId = (prefix: string): string =>
  `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const clampRetryPolicy = (retryPolicy?: Partial<WebhookRetryPolicy>): WebhookRetryPolicy => ({
  maxRetries: retryPolicy?.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
  initialDelayMs: retryPolicy?.initialDelayMs ?? DEFAULT_RETRY_POLICY.initialDelayMs,
  maxDelayMs: retryPolicy?.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs,
  backoffFactor: retryPolicy?.backoffFactor ?? DEFAULT_RETRY_POLICY.backoffFactor,
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

export class WebhookDeliveryService {
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly webhooks = new Map<string, WebhookConfig>();
  private readonly deliveries = new Map<string, WebhookDelivery>();
  private readonly deliveredKeys = new Set<string>();

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
      retryPolicy: clampRetryPolicy(input.retryPolicy),
      isPaused: input.isPaused ?? false,
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
    return this.updateWebhook(id, { isPaused: false });
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

    return {
      webhookId,
      totalDeliveries,
      successfulDeliveries,
      failedDeliveries,
      retryCount,
      pendingDeliveries,
      successRate: totalDeliveries ? successfulDeliveries / totalDeliveries : 0,
      avgAttempts,
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

  async deliverEvent(input: WebhookEventInput): Promise<WebhookDeliveryResult | null> {
    const webhook = this.webhooks.get(input.webhookId);
    if (!webhook || webhook.merchantId !== input.merchantId) return null;
    if (!isWebhookEventAllowed(webhook, input.eventType)) return null;

    const payload = buildWebhookPayload(input);
    const signature = signWebhookPayload(payload, webhook.secretKey);
    const idempotencyKey = `${payload.id}:${webhook.id}`;
    if (this.deliveredKeys.has(idempotencyKey)) {
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
      this.deliveredKeys.add(idempotencyKey);
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
      this.deliveredKeys.add(existing.idempotencyKey);
    }
    return result;
  }

  private async sendWithRetry(
    webhook: WebhookConfig,
    delivery: WebhookDelivery
  ): Promise<WebhookDeliveryResult> {
    const payloadBody = JSON.stringify(delivery.payload);
    if (Buffer.byteLength(payloadBody, 'utf8') > MAX_PAYLOAD_BYTES) {
      return this.finalizeDelivery(webhook, delivery, {
        status: 'failed',
        errorMessage: 'Payload exceeds 1MB limit',
      });
    }

    const headers = {
      'Content-Type': 'application/json',
      'X-SubTrackr-Signature': delivery.signature,
      'X-SubTrackr-Event-Type': delivery.eventType,
      'X-SubTrackr-Event-Id': delivery.eventId,
      'X-SubTrackr-Idempotency-Key': delivery.idempotencyKey,
    };

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
      };
      this.deliveries.set(delivery.id, next);

      try {
        const response = await this.fetchImpl(webhook.url, {
          method: 'POST',
          headers,
          body: payloadBody,
        });

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
          });
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
    });
  }

  private finalizeDelivery(
    webhook: WebhookConfig,
    delivery: WebhookDelivery,
    patch: Partial<WebhookDelivery> & { status: WebhookDeliveryStatus },
    response?: Response
  ): WebhookDeliveryResult {
    const next: WebhookDelivery = {
      ...delivery,
      ...patch,
      updatedAt: now(),
    };
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
    this.webhooks.set(webhook.id, { ...webhook, ...configPatch });

    return { delivery: next, response };
  }

  private computeDelay(policy: WebhookRetryPolicy, attempt: number): number {
    const factor = policy.backoffFactor ?? DEFAULT_RETRY_POLICY.backoffFactor ?? 2;
    const rawDelay = Math.floor(policy.initialDelayMs * Math.pow(factor, Math.max(0, attempt - 1)));
    return Math.min(rawDelay, policy.maxDelayMs);
  }
}

export const webhookDeliveryService = new WebhookDeliveryService();
