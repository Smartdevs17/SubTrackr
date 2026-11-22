/**
 * deliveryReceiptsStore — client cache of per-channel delivery status (#1749)
 *
 * The backend owns the receipt timeline (providers post status callbacks to
 * `/api/delivery-receipts/status`); this store is a read-through cache the UI
 * uses to show "Delivered / Failed / Undelivered" without a spinner per render.
 *
 * Persistence is deliberately off: a status is only meaningful while it is
 * fresh, and a stale cached "sent" would mislead more than an empty panel. The
 * store hydrates on mount and refreshes on demand.
 */

import { create } from 'zustand';

import { apiClient } from '../services/network/apiClient';
import type { NotificationChannel } from '../types/notification';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DeliveryReceiptStatus =
  'accepted' | 'sent' | 'delivered' | 'failed' | 'undelivered' | 'expired';

export interface DeliveryReceiptEvent {
  status: DeliveryReceiptStatus;
  at: string;
  detail?: string;
}

export interface DeliveryReceipt {
  id: string;
  userId: string;
  type: string;
  channel: NotificationChannel;
  providerMessageId?: string;
  status: DeliveryReceiptStatus;
  events: DeliveryReceiptEvent[];
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelReceiptSummary {
  channel: NotificationChannel;
  receiptId: string | null;
  status: DeliveryReceiptStatus | null;
  updatedAt: string | null;
}

export interface DeliverySummary {
  userId: string;
  byChannel: Record<NotificationChannel, ChannelReceiptSummary>;
  counts: Record<DeliveryReceiptStatus, number>;
  total: number;
}

const EMPTY_COUNTS: Record<DeliveryReceiptStatus, number> = {
  accepted: 0,
  sent: 0,
  delivered: 0,
  failed: 0,
  undelivered: 0,
  expired: 0,
};

export const emptySummary = (userId: string): DeliverySummary => ({
  userId,
  byChannel: (['email', 'push', 'sms', 'in_app'] as NotificationChannel[]).reduce(
    (acc, channel) => {
      acc[channel] = { channel, receiptId: null, status: null, updatedAt: null };
      return acc;
    },
    {} as Record<NotificationChannel, ChannelReceiptSummary>
  ),
  counts: { ...EMPTY_COUNTS },
  total: 0,
});

// ─── Display metadata ──────────────────────────────────────────────────────────

export interface StatusPresentation {
  label: string;
  tone: 'positive' | 'pending' | 'negative' | 'neutral';
  description: string;
}

export const STATUS_PRESENTATION: Record<DeliveryReceiptStatus, StatusPresentation> = {
  accepted: {
    label: 'Accepted',
    tone: 'pending',
    description: 'The provider has taken the message and will send it shortly.',
  },
  sent: {
    label: 'Sent',
    tone: 'pending',
    description: 'Handed to the provider, awaiting confirmation of delivery.',
  },
  delivered: {
    label: 'Delivered',
    tone: 'positive',
    description: 'The recipient’s device or inbox confirmed receipt.',
  },
  failed: {
    label: 'Failed',
    tone: 'negative',
    description: 'The provider refused the message.',
  },
  undelivered: {
    label: 'Undelivered',
    tone: 'negative',
    description: 'The provider gave up — the number or address may be unreachable.',
  },
  expired: {
    label: 'Expired',
    tone: 'neutral',
    description: 'No delivery confirmation arrived before the message expired.',
  },
};

// ─── Store ─────────────────────────────────────────────────────────────────────

export interface DeliveryReceiptsState {
  userId: string | null;
  summary: DeliverySummary;
  receipts: DeliveryReceipt[];
  loading: boolean;
  error: string | null;
}

export interface DeliveryReceiptsActions {
  /** Fetch the summary and recent receipts for a user. */
  refresh: (userId: string) => Promise<void>;
  /** Load a single receipt's full timeline. */
  loadReceipt: (receiptId: string) => Promise<DeliveryReceipt | null>;
  reset: () => void;
}

export type DeliveryReceiptsStore = DeliveryReceiptsState & DeliveryReceiptsActions;

export const useDeliveryReceiptsStore = create<DeliveryReceiptsStore>((set, get) => ({
  userId: null,
  summary: emptySummary(''),
  receipts: [],
  loading: false,
  error: null,

  refresh: async (userId) => {
    set({ userId, loading: true, error: null });
    try {
      const [summaryRes, listRes] = await Promise.all([
        apiClient.request<DeliverySummary>(
          `/api/delivery-receipts/summary?userId=${encodeURIComponent(userId)}`
        ),
        apiClient.request<DeliveryReceipt[]>(
          `/api/delivery-receipts?userId=${encodeURIComponent(userId)}&limit=50`
        ),
      ]);
      if (!summaryRes.ok || !listRes.ok) {
        set({ loading: false, error: `Failed to load delivery status (${summaryRes.status})` });
        return;
      }
      set({
        summary: summaryRes.data,
        receipts: listRes.data ?? [],
        loading: false,
        error: null,
      });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  loadReceipt: async (receiptId) => {
    // Prefer the cached copy; a callback may not have arrived yet, so hit the
    // API only when we have never seen the id.
    const cached = get().receipts.find((receipt) => receipt.id === receiptId);
    if (cached) return cached;
    try {
      const response = await apiClient.request<DeliveryReceipt>(
        `/api/delivery-receipts/${encodeURIComponent(receiptId)}`
      );
      if (!response.ok) return null;
      set((state) => ({
        receipts: [response.data, ...state.receipts.filter((r) => r.id !== response.data.id)],
      }));
      return response.data;
    } catch {
      return null;
    }
  },

  reset: () =>
    set({ userId: null, summary: emptySummary(''), receipts: [], loading: false, error: null }),
}));

/** Convenience selector — the latest per-channel summary for the active user. */
export const selectChannelSummaries = (state: DeliveryReceiptsStore): ChannelReceiptSummary[] =>
  (['email', 'push', 'sms', 'in_app'] as NotificationChannel[]).map(
    (channel) => state.summary.byChannel[channel]
  );
