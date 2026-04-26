import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  WebhookAnalytics,
  WebhookConfig,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEventType,
  WebhookRetryPolicy,
} from '../types/webhook';

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

  return {
    webhookId,
    totalDeliveries,
    successfulDeliveries,
    failedDeliveries,
    retryCount,
    pendingDeliveries,
    successRate: totalDeliveries ? successfulDeliveries / totalDeliveries : 0,
    avgAttempts,
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
    input: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt' | 'successCount' | 'failureCount'>
  ) => Promise<WebhookConfig>;
  updateWebhook: (id: string, patch: Partial<WebhookConfig>) => Promise<WebhookConfig>;
  deleteWebhook: (id: string) => Promise<void>;
  pauseWebhook: (id: string) => Promise<WebhookConfig>;
  resumeWebhook: (id: string) => Promise<WebhookConfig>;
  recordDelivery: (
    delivery: Omit<WebhookDelivery, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<WebhookDelivery>;
  retryDelivery: (deliveryId: string) => Promise<WebhookDelivery>;
  getWebhookDeliveries: (webhookId: string, limit?: number) => WebhookDelivery[];
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
        const webhook: WebhookConfig = {
          ...input,
          id: createId('whk'),
          createdAt: now(),
          updatedAt: now(),
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

      resumeWebhook: async (id) => get().updateWebhook(id, { isPaused: false }),

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

      getWebhookDeliveries: (webhookId, limit = 25) =>
        get()
          .deliveries.filter((delivery) => delivery.webhookId === webhookId)
          .slice(-Math.max(0, limit)),

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
      storage: createJSONStorage(() => AsyncStorage),
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
  'subscription.cancelled',
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
