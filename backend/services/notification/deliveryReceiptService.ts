/**
 * Notification delivery receipts (#1749)
 *
 * A `NotificationRecord` says a transport *accepted* a message; a receipt
 * tracks what happened afterwards — the provider's own confirmation that the
 * SMS was delivered, the email bounced, the push ticket expired. Each receipt
 * carries a per-channel status timeline so support can answer "did the customer
 * actually receive it?" without reading provider dashboards.
 *
 * Model
 * ─────
 *   accepted     — the provider took the message (handover confirmed)
 *   sent         — the provider dispatched it on the wire
 *   delivered    — the recipient's carrier/device confirmed receipt
 *   failed       — the provider refused or the send errored
 *   undelivered  — the provider gave up (bad number, full mailbox, …)
 *   expired      — e.g. an Expo push ticket that never resolved
 *
 * Transitions are forward-only and idempotent: a late "sent" arriving after
 * "delivered" is ignored, so out-of-order webhooks cannot regress a receipt.
 *
 * `in_app` receipts are marked `delivered` on acceptance — the store-and-show
 * hop is the delivery. Other channels start at `sent` and wait for the
 * provider's status callback (e.g. Twilio's `StatusCallback` webhook, handled
 * by `deliveryStatusRouter`).
 */

import type { NotificationChannel, NotificationType } from '../../../src/types/notification';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DeliveryReceiptStatus =
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'undelivered'
  | 'expired';

export interface DeliveryReceiptEvent {
  status: DeliveryReceiptStatus;
  at: string;
  /** Provider-supplied detail, e.g. an error message. */
  detail?: string;
}

export interface DeliveryReceipt {
  id: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  /** Provider message identifier (Twilio SM…, Expo ticket id, …). */
  providerMessageId?: string;
  status: DeliveryReceiptStatus;
  /** Forward-only timeline, oldest first. */
  events: DeliveryReceiptEvent[];
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecordAttemptInput {
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  providerMessageId?: string;
  /** True when the channel transport accepted the message. */
  accepted: boolean;
  error?: string;
  errorCode?: string;
}

export interface StatusUpdateInput {
  /** Update by provider message id … */
  providerMessageId?: string;
  /** … or by receipt id. */
  receiptId?: string;
  status: DeliveryReceiptStatus;
  detail?: string;
  errorCode?: string;
  /** Overrides "now" for the event timestamp. */
  at?: Date;
}

export interface ChannelReceiptSummary {
  channel: NotificationChannel;
  receiptId: string | null;
  status: DeliveryReceiptStatus | null;
  updatedAt: string | null;
}

/** Latest receipt per channel plus status counts, for a dashboard. */
export interface DeliverySummary {
  userId: string;
  byChannel: Record<NotificationChannel, ChannelReceiptSummary>;
  counts: Record<DeliveryReceiptStatus, number>;
  total: number;
}

// ─── Status vocabulary ─────────────────────────────────────────────────────────

const TERMINAL: ReadonlySet<DeliveryReceiptStatus> = new Set([
  'delivered',
  'failed',
  'undelivered',
  'expired',
]);

/** Progress rank — higher wins; terminal statuses accept nothing further. */
const RANK: Record<DeliveryReceiptStatus, number> = {
  accepted: 0,
  sent: 1,
  delivered: 2,
  failed: 3,
  undelivered: 3,
  expired: 3,
};

/** Channels whose acceptance *is* delivery — no wire to wait on. */
const INSTANTLY_DELIVERED: ReadonlySet<NotificationChannel> = new Set(['in_app']);

/**
 * Map a provider status string onto our vocabulary.
 *
 * Handles Twilio's message statuses (the only provider with status callbacks
 * today) and is deliberately lenient: unknown values resolve to null so the
 * caller can ignore them rather than invent a transition.
 */
export function normalizeProviderStatus(raw: string): DeliveryReceiptStatus | null {
  switch (raw.trim().toLowerCase()) {
    case 'queued':
    case 'accepted':
    case 'received':
    case 'receiving':
      return 'accepted';
    case 'sending':
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'failed':
      return 'failed';
    case 'undelivered':
      return 'undelivered';
    case 'expired':
      return 'expired';
    default:
      return null;
  }
}

/** True when a receipt may move from `from` to `to`. */
export function canTransition(from: DeliveryReceiptStatus, to: DeliveryReceiptStatus): boolean {
  if (from === to) return false;
  if (TERMINAL.has(from)) return false;
  return RANK[to] >= RANK[from];
}

// ─── Repository ────────────────────────────────────────────────────────────────

export interface DeliveryReceiptRepository {
  save(receipt: DeliveryReceipt): Promise<void>;
  remove(receiptId: string): Promise<void>;
  get(id: string): Promise<DeliveryReceipt | null>;
  findByProviderMessageId(providerMessageId: string): Promise<DeliveryReceipt | null>;
  listForUser(userId: string): Promise<DeliveryReceipt[]>;
}

/** In-memory repository — tests and local development. */
export class InMemoryDeliveryReceiptRepository implements DeliveryReceiptRepository {
  private readonly byId = new Map<string, DeliveryReceipt>();
  private readonly byProviderId = new Map<string, string>();

  async save(receipt: DeliveryReceipt): Promise<void> {
    this.byId.set(receipt.id, { ...receipt, events: [...receipt.events] });
    if (receipt.providerMessageId) {
      this.byProviderId.set(receipt.providerMessageId, receipt.id);
    }
  }

  async remove(receiptId: string): Promise<void> {
    const existing = this.byId.get(receiptId);
    if (existing?.providerMessageId) this.byProviderId.delete(existing.providerMessageId);
    this.byId.delete(receiptId);
  }

  async get(id: string): Promise<DeliveryReceipt | null> {
    const found = this.byId.get(id);
    return found ? { ...found, events: [...found.events] } : null;
  }

  async findByProviderMessageId(providerMessageId: string): Promise<DeliveryReceipt | null> {
    const id = this.byProviderId.get(providerMessageId);
    return id ? this.get(id) : null;
  }

  async listForUser(userId: string): Promise<DeliveryReceipt[]> {
    return [...this.byId.values()]
      .filter((receipt) => receipt.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((receipt) => ({ ...receipt, events: [...receipt.events] }));
  }
}

// ─── Service ───────────────────────────────────────────────────────────────────

/** Retention cap per subscriber, mirroring the history cap. */
export const MAX_RECEIPTS_PER_USER = 500;

export class DeliveryReceiptService {
  private sequence = 0;

  constructor(
    private readonly repo: DeliveryReceiptRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Record the outcome of one delivery attempt.
   *
   * Accepted attempts become `sent` (or `delivered` for in-app); refused
   * attempts become `failed` with the transport's error attached.
   */
  async recordAttempt(input: RecordAttemptInput): Promise<DeliveryReceipt> {
    const timestamp = this.now().toISOString();
    const initial: DeliveryReceiptStatus = !input.accepted
      ? 'failed'
      : INSTANTLY_DELIVERED.has(input.channel)
        ? 'delivered'
        : 'sent';

    this.sequence += 1;
    const receipt: DeliveryReceipt = {
      id: `rcpt_${this.sequence.toString(36)}_${input.channel}`,
      userId: input.userId,
      type: input.type,
      channel: input.channel,
      providerMessageId: input.providerMessageId,
      status: initial,
      events: [{ status: initial, at: timestamp, detail: input.error }],
      errorCode: input.errorCode,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repo.save(receipt);
    await this.trim(input.userId);
    return receipt;
  }

  /**
   * Apply a provider status update.
   *
   * Returns the updated receipt, or null when no receipt matches or the
   * transition is stale/out-of-order (in which case nothing is written).
   */
  async applyStatusUpdate(input: StatusUpdateInput): Promise<DeliveryReceipt | null> {
    const receipt = input.receiptId
      ? await this.repo.get(input.receiptId)
      : input.providerMessageId
        ? await this.repo.findByProviderMessageId(input.providerMessageId)
        : null;
    if (!receipt) return null;
    if (!canTransition(receipt.status, input.status)) return receipt;

    const at = (input.at ?? this.now()).toISOString();
    const updated: DeliveryReceipt = {
      ...receipt,
      status: input.status,
      events: [...receipt.events, { status: input.status, at, detail: input.detail }],
      errorCode: input.errorCode ?? receipt.errorCode,
      updatedAt: at,
    };
    await this.repo.save(updated);
    return updated;
  }

  async get(receiptId: string): Promise<DeliveryReceipt | null> {
    return this.repo.get(receiptId);
  }

  async getByProviderMessageId(providerMessageId: string): Promise<DeliveryReceipt | null> {
    return this.repo.findByProviderMessageId(providerMessageId);
  }

  /** Newest first, optionally narrowed to one channel. */
  async listForUser(
    userId: string,
    options: { channel?: NotificationChannel; limit?: number } = {}
  ): Promise<DeliveryReceipt[]> {
    const all = await this.repo.listForUser(userId);
    const filtered = options.channel
      ? all.filter((receipt) => receipt.channel === options.channel)
      : all;
    return options.limit ? filtered.slice(0, options.limit) : filtered;
  }

  /** The newest receipt on every channel — what the status dashboard shows. */
  async latestPerChannel(userId: string): Promise<Record<NotificationChannel, ChannelReceiptSummary>> {
    const empty = (channel: NotificationChannel): ChannelReceiptSummary => ({
      channel,
      receiptId: null,
      status: null,
      updatedAt: null,
    });
    const byChannel = {
      email: empty('email'),
      push: empty('push'),
      sms: empty('sms'),
      in_app: empty('in_app'),
    } as Record<NotificationChannel, ChannelReceiptSummary>;

    for (const receipt of await this.repo.listForUser(userId)) {
      const current = byChannel[receipt.channel];
      // listForUser is newest first, so the first sighting per channel wins.
      if (!current.receiptId) {
        byChannel[receipt.channel] = {
          channel: receipt.channel,
          receiptId: receipt.id,
          status: receipt.status,
          updatedAt: receipt.updatedAt,
        };
      }
    }
    return byChannel;
  }

  /** Per-channel latest status plus per-status totals. */
  async summarize(userId: string): Promise<DeliverySummary> {
    const counts: Record<DeliveryReceiptStatus, number> = {
      accepted: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      undelivered: 0,
      expired: 0,
    };
    const all = await this.repo.listForUser(userId);
    for (const receipt of all) counts[receipt.status] += 1;

    return {
      userId,
      byChannel: await this.latestPerChannel(userId),
      counts,
      total: all.length,
    };
  }

  private async trim(userId: string): Promise<void> {
    const all = await this.repo.listForUser(userId);
    if (all.length <= MAX_RECEIPTS_PER_USER) return;
    // listForUser is newest first; the overflow is the oldest tail.
    for (const receipt of all.slice(MAX_RECEIPTS_PER_USER)) {
      await this.repo.remove(receipt.id);
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const deliveryReceiptRepository = new InMemoryDeliveryReceiptRepository();
export const deliveryReceiptService = new DeliveryReceiptService(deliveryReceiptRepository);
