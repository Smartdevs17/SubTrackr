/**
 * withDeliveryReceipts — ChannelTransport decorator for #1749
 *
 * `ChannelTransport` returns only a boolean ("did the provider accept it?"),
 * which is all `NotificationCenterService` needs. Delivery receipts need two
 * facts the boolean cannot carry: which notification type the attempt belonged
 * to, and the provider's message id (for later status callbacks).
 *
 * This decorator wraps an existing transport, records one receipt per attempt,
 * and folds the message id back out of the transport where the provider exposes
 * it. The id is read from the `data` bag after the send — `buildSmsTransport`
 * does not currently surface `SmsResult.messageId`, so the SMS provider is
 * given the chance to stash it under `data.providerMessageId`. When it is
 * absent the receipt still records the attempt status, just without an id to
 * correlate a callback against.
 *
 * Correlation by hand is deliberate: changing `ChannelTransport`'s return type
 * would ripple through every transport (email, push, in-app, voice, …) and the
 * microservice boundary, for a field only the receipt layer consumes.
 */

import type { ChannelTransport } from '@subtrackr/notification-providers';
import type {
  DeliveryReceiptService,
  DeliveryReceiptStatus,
} from './deliveryReceiptService';
import type { NotificationChannel, NotificationType } from '../../../src/types/notification';

/** Type hint the notification center places in `data` for templated sends. */
const TYPE_HINT_KEY = 'notificationType';
/** Key a transport may populate so the decorator can capture the provider id. */
export const PROVIDER_MESSAGE_ID_KEY = 'providerMessageId';

const DEFAULT_TYPE: NotificationType = 'product_update';

function resolveType(data: Record<string, string> | undefined): NotificationType {
  const hinted = data?.[TYPE_HINT_KEY];
  // The type is a display-only classification on the receipt; an unknown hint
  // must not fail the send, so fall back to a neutral type.
  return (hinted as NotificationType | undefined) ?? DEFAULT_TYPE;
}

export interface DeliveryReceiptTransportHooks {
  /** Test seam; production reads from the transport's `data` mutation. */
  onAttempt?: (receiptId: string, status: DeliveryReceiptStatus) => void;
}

/** Wrap a channel transport so every attempt produces a delivery receipt. */
export function withDeliveryReceipts(
  channel: NotificationChannel,
  transport: ChannelTransport,
  service: DeliveryReceiptService,
  hooks: DeliveryReceiptTransportHooks = {}
): ChannelTransport {
  return async (input) => {
    const type = resolveType(input.data);
    let accepted = false;
    let error: string | undefined;

    try {
      accepted = await transport(input);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      // The center records the failure too; the receipt exists so support can
      // see the provider-level outcome independently of the notification status.
    }

    const receipt = await service.recordAttempt({
      userId: input.userId,
      type,
      channel,
      providerMessageId: input.data?.[PROVIDER_MESSAGE_ID_KEY] || undefined,
      accepted,
      error,
    });
    hooks.onAttempt?.(receipt.id, receipt.status);

    // Preserve the transport's contract: a throw must still propagate so the
    // notification center can attach the reason to the delivery record.
    if (error && !accepted) throw new Error(error);
    return accepted;
  };
}
