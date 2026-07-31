import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import {
  WebhookAnalytics,
  WebhookConfig,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEventType,
  WebhookRetryPolicy,
  WebhookSecret,
} from '../types/webhook';
import { BillingCycle } from '../types/subscription';
import {
  generateWebhookSecret,
  serializeWebhookPayload,
  signWebhookPayload,
} from '../utils/webhookSignature';

const STORAGE_KEY = 'subtrackr-webhooks';
const DEFAULT_RETRY_POLICY: WebhookRetryPolicy = {
  maxRetries: 5,
  initialDelayMs: 250,
  maxDelayMs: 8_000,
  backoffFactor: 2,
};

const now = (): number => Date.now();

const createId = (prefix: string): string =>
  `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const calculateAnalytics = (webhookId: string, deliveries: WebhookDelivery[]): WebhookAnalytics => {
  const scoped = deliveries.filter((delivery) => delivery.webhookId === webhookId);
  const totalDeliveries = scoped.length;
  const successfulDeliveries = scoped.filter((delivery) => delivery.status === 'delivered').length;
  const failedDeliveries = scoped.filter((delivery) => delivery.status === 'failed').length;
  const pendingDeliveries = scoped.filter((delivery) =>
    ['pending', 'retrying', 'paused'].includes(delivery.status)
  ).length;
  const retryCount = scoped.reduce((sum, delivery) => sum + Math.max(0, delivery.attempts - 1), 0);
  const avgAttempts = totalDeliveries
    ? scoped.reduce((sum, delivery) => sum + delivery.attempts, 0) / totalDeliveries
    : 0;
  const latencySamples = scoped
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
    lastSuccessAt: scoped
      .filter((delivery) => delivery.status === 'delivered' && delivery.deliveredAt)
      .map((delivery) => delivery.deliveredAt as number)
      .sort((a, b) => b - a)[0],
    lastFailureAt: scoped
      .filter((delivery) => delivery.status === 'failed' && delivery.updatedAt)
      .map((delivery) => delivery.updatedAt)
      .sort((a, b) => b - a)[0],
  };
};

interface WebhookState {
  webhooks: WebhookConfig[];
  deliveries: WebhookDelivery[];
  analytics: Record<string, WebhookAnalytics>;
  isLoading: boolean;
  error: string | null;

  registerWebhook: (
    input: Omit<
      WebhookConfig,
      'id' | 'createdAt' | 'updatedAt' | 'successCount' | 'failureCount' | 'secrets'
    >
  ) => Promise<WebhookConfig>;
  updateWebhook: (id: string, patch: Partial<WebhookConfig>) => Promise<WebhookConfig>;
  deleteWebhook: (id: string) => Promise<void>;
  pauseWebhook: (id: string) => Promise<WebhookConfig>;
  resumeWebhook: (id: string) => Promise<WebhookConfig>;
  /** Rotates the signing secret; the old secret stays valid for `overlapMs` (default 24h). */
  rotateSecret: (id: string, newSecret?: string, overlapMs?: number) => Promise<WebhookConfig>;
  recordDelivery: (
    delivery: Omit<WebhookDelivery, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<WebhookDelivery>;
  retryDelivery: (deliveryId: string) => Promise<WebhookDelivery>;
  sendTestEvent: (webhookId: string, eventType?: WebhookEventType) => Promise<WebhookDelivery>;
  getWebhookDeliveries: (webhookId: string, limit?: number) => WebhookDelivery[];
  getDeadLetters: (webhookId?: string) => WebhookDelivery[];
  replayDeadLetter: (deliveryId: string) => Promise<WebhookDelivery>;
  getAnalytics: (webhookId: string) => WebhookAnalytics;
  refreshAnalytics: (webhookId?: string) => void;
  setWebhookState: (webhooks: WebhookConfig[]) => void;
}

export const useWebhookStore = create<WebhookState>()(
  persist(
    (set, get) => ({
      webhooks: [],
      deliveries: [],
      analytics: {},
      isLoading: false,
      error: null,

      registerWebhook: async (input) => {
        const createdAt = now();
        // Ensure every webhook has a signing secret so deliveries are
        // verifiable; generate one if the caller did not supply it.
        const secretKey = input.secretKey?.trim() ? input.secretKey : generateWebhookSecret();
        const webhook: WebhookConfig = {
          ...input,
          secretKey,
          secrets: [{ key: secretKey, createdAt, validFrom: createdAt }],
          id: createId('whk'),
          createdAt,
          updatedAt: createdAt,
          successCount: 0,
          failureCount: 0,
        };
        set((state) => ({
          webhooks: [...state.webhooks, webhook],
          analytics: {
            ...state.analytics,
            [webhook.id]: calculateAnalytics(webhook.id, state.deliveries),
          },
        }));
        return webhook;
      },

      updateWebhook: async (id, patch) => {
        const current = get().webhooks.find((webhook) => webhook.id === id);
        if (!current) throw new Error(`Webhook ${id} not found`);

        const next: WebhookConfig = {
          ...current,
          ...patch,
          id,
          updatedAt: now(),
        };

        set((state) => ({
          webhooks: state.webhooks.map((webhook) => (webhook.id === id ? next : webhook)),
          analytics: {
            ...state.analytics,
            [id]: calculateAnalytics(id, state.deliveries),
          },
        }));
        return next;
      },

      deleteWebhook: async (id) => {
        set((state) => ({
          webhooks: state.webhooks.filter((webhook) => webhook.id !== id),
          deliveries: state.deliveries.filter((delivery) => delivery.webhookId !== id),
          analytics: Object.fromEntries(
            Object.entries(state.analytics).filter(([webhookId]) => webhookId !== id)
          ),
        }));
      },

      pauseWebhook: async (id) => get().updateWebhook(id, { isPaused: true }),

      resumeWebhook: async (id) =>
        get().updateWebhook(id, { isPaused: false, disabledReason: undefined }),

      rotateSecret: async (id, newSecret, overlapMs = 24 * 60 * 60 * 1_000) => {
        const current = get().webhooks.find((webhook) => webhook.id === id);
        if (!current) throw new Error(`Webhook ${id} not found`);

        const rotatedAt = now();
        const nextSecret = newSecret?.trim() ? newSecret : generateWebhookSecret();
        const secrets: WebhookSecret[] = (current.secrets ?? []).map((secret) =>
          secret.validUntil === undefined
            ? { ...secret, validUntil: rotatedAt + overlapMs }
            : secret
        );
        secrets.push({ key: nextSecret, createdAt: rotatedAt, validFrom: rotatedAt });

        return get().updateWebhook(id, { secretKey: nextSecret, secrets });
      },

      recordDelivery: async (delivery) => {
        const record: WebhookDelivery = {
          ...delivery,
          id: createId('del'),
          createdAt: now(),
          updatedAt: now(),
        };

        set((state) => {
          const nextDeliveries = [...state.deliveries, record];
          return {
            deliveries: nextDeliveries,
            analytics: {
              ...state.analytics,
              [record.webhookId]: calculateAnalytics(record.webhookId, nextDeliveries),
            },
          };
        });
        return record;
      },

      retryDelivery: async (deliveryId) => {
        const current = get().deliveries.find((delivery) => delivery.id === deliveryId);
        if (!current) throw new Error(`Delivery ${deliveryId} not found`);

        const next: WebhookDelivery = {
          ...current,
          status: 'retrying',
          attempts: current.attempts + 1,
          lastAttemptAt: now(),
          nextRetryAt: now(),
          updatedAt: now(),
        };

        set((state) => {
          const nextDeliveries = state.deliveries.map((delivery) =>
            delivery.id === deliveryId ? next : delivery
          );
          return {
            deliveries: nextDeliveries,
            analytics: {
              ...state.analytics,
              [next.webhookId]: calculateAnalytics(next.webhookId, nextDeliveries),
            },
          };
        });
        return next;
      },

      sendTestEvent: async (webhookId, eventType = 'subscription.created') => {
        const webhook = get().webhooks.find((entry) => entry.id === webhookId);
        if (!webhook) throw new Error(`Webhook ${webhookId} not found`);
        const eventId = createId('evt');
        const payload = {
          id: eventId,
          webhookId,
          eventType,
          occurredAt: now(),
          merchantId: webhook.merchantId,
          previousStatus: 'none',
          currentStatus: 'active',
          payloadVersion: 1,
          subscription: {
            id: 'sample_subscription',
            planId: 'sample_plan',
            subscriberId: 'sample_customer',
            status: 'active',
            startedAt: now(),
            lastChargedAt: now(),
            nextChargeAt: now() + 2_592_000_000,
            totalPaid: 49,
            totalGasSpent: 0,
            chargeCount: 1,
            pausedAt: 0,
            pauseDuration: 0,
            refundRequestedAmount: 0,
          },
          plan: {
            id: 'sample_plan',
            merchantId: webhook.merchantId,
            name: 'Sample plan',
            price: 49,
            token: 'USD',
            interval: BillingCycle.MONTHLY,
            active: true,
            subscriberCount: 1,
            createdAt: now(),
          },
        };
        // Sign the exact serialized payload with the webhook secret so the
        // receiver can verify authenticity/integrity (HMAC-SHA256).
        const signature = signWebhookPayload(serializeWebhookPayload(payload), webhook.secretKey);
        return get().recordDelivery({
          webhookId,
          eventId,
          eventType,
          url: webhook.url,
          payload,
          status: 'delivered',
          attempts: 1,
          maxAttempts: webhook.retryPolicy.maxRetries,
          deliveredAt: now(),
          responseCode: 200,
          signature,
          idempotencyKey: createId('idem'),
          latencyMs: 120,
        });
      },

      getWebhookDeliveries: (webhookId, limit = 25) =>
        get()
          .deliveries.filter((delivery) => delivery.webhookId === webhookId)
          .slice(-Math.max(0, limit)),

      getDeadLetters: (webhookId) =>
        get()
          .deliveries.filter(
            (delivery) =>
              delivery.isDeadLettered && (!webhookId || delivery.webhookId === webhookId)
          )
          .sort((a, b) => (a.deadLetteredAt ?? 0) - (b.deadLetteredAt ?? 0)),

      replayDeadLetter: async (deliveryId) => {
        const current = get().deliveries.find((delivery) => delivery.id === deliveryId);
        if (!current) throw new Error(`Delivery ${deliveryId} not found`);

        const next: WebhookDelivery = {
          ...current,
          status: 'delivered',
          attempts: current.attempts + 1,
          lastAttemptAt: now(),
          deliveredAt: now(),
          responseCode: 200,
          errorMessage: undefined,
          isDeadLettered: false,
          deadLetteredAt: undefined,
          updatedAt: now(),
        };

        set((state) => {
          const nextDeliveries = state.deliveries.map((delivery) =>
            delivery.id === deliveryId ? next : delivery
          );
          return {
            deliveries: nextDeliveries,
            analytics: {
              ...state.analytics,
              [next.webhookId]: calculateAnalytics(next.webhookId, nextDeliveries),
            },
          };
        });
        return next;
      },

      getAnalytics: (webhookId) => {
        const analytics = calculateAnalytics(webhookId, get().deliveries);
        set((state) => ({
          analytics: {
            ...state.analytics,
            [webhookId]: analytics,
          },
        }));
        return analytics;
      },

      refreshAnalytics: (webhookId) => {
        if (webhookId) {
          get().getAnalytics(webhookId);
          return;
        }

        const nextAnalytics: Record<string, WebhookAnalytics> = {};
        for (const webhook of get().webhooks) {
          nextAnalytics[webhook.id] = calculateAnalytics(webhook.id, get().deliveries);
        }
        set({ analytics: nextAnalytics });
      },

      setWebhookState: (webhooks) => {
        set({ webhooks });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        webhooks: state.webhooks,
        deliveries: state.deliveries,
        analytics: state.analytics,
      }),
    }
  )
);

export const webhookEventTypes: WebhookEventType[] = [
  'subscription.created',
  'subscription.updated',
  'subscription.renewed',
  'subscription.cancelled',
  'subscription.payment_failed',
  'subscription.upgraded',
  'subscription.paused',
  'subscription.resumed',
  'subscription.charged',
  'subscription.refund_requested',
  'subscription.refund_approved',
  'subscription.refund_rejected',
  'subscription.transfer_requested',
  'subscription.transfer_accepted',
];

export const defaultRetryPolicy = DEFAULT_RETRY_POLICY;
export const webhookStatusLabels: Record<WebhookDeliveryStatus, string> = {
  pending: 'Pending',
  retrying: 'Retrying',
  delivered: 'Delivered',
  failed: 'Failed',
  paused: 'Paused',
  skipped: 'Skipped',
};
