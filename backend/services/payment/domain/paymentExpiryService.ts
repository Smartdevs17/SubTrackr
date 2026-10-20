/**
 * Payment expiry service – expires overdue payment intents and cancels
 * their linked subscriptions.
 *
 * The advisory lock serialises expiry against concurrent finality
 * processing for the same subscription, and is always released (via
 * `withLock`) whether the expiry succeeds or fails.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1716
 */

import type { PaymentIntent, PaymentIntentStatus } from './PaymentIntent';
import { paymentIntentService as defaultIntentService, PaymentIntentService } from './paymentIntentService';
import { paymentWebhookPublisher as defaultPublisher, PaymentWebhookPublisher } from '../../webhook/paymentWebhookPublisher';
import { advisoryLockService } from '../../shared/locking/AdvisoryLockService';
import { cancellationService } from '../../../subscription/domain/cancellationService';
import { logger } from '../../shared/logging';

export interface PaymentExpiryConfig {
  /** Expiry window (TTL) in seconds applied to new payment intents. */
  expiryWindowSeconds: number;
  /** How often the scheduler sweeps for overdue intents (ms). */
  sweepIntervalMs: number;
}

export const DEFAULT_PAYMENT_EXPIRY_CONFIG: PaymentExpiryConfig = {
  expiryWindowSeconds: Number(process.env.PAYMENT_EXPIRY_WINDOW_SECONDS ?? 900),
  sweepIntervalMs: Number(process.env.PAYMENT_EXPIRY_SWEEP_INTERVAL_MS ?? 60_000),
};

export interface ExpiredPaymentResult {
  intent: PaymentIntent;
  subscriptionCancelled: boolean;
}

/**
 * Cancel the linked subscription because its payment intent expired.
 * Uses `mode: 'immediate'` + `reason: 'payment_expired'` so retention
 * analytics attribute the churn to payment failure.
 */
export async function cancelSubscriptionOnExpiry(
  subscriptionId: string,
  userId: string,
): Promise<boolean> {
  try {
    const { cancellation } = cancellationService.initiate({
      subscriptionId,
      userId,
      mode: 'immediate',
      reason: 'payment_expired',
    });
    return Boolean(cancellation);
  } catch (err) {
    logger.warn('Failed to cancel subscription after payment expiry', {
      subscriptionId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export class PaymentExpiryService {
  constructor(
    private readonly intentService: PaymentIntentService = defaultIntentService,
    private readonly publisher: PaymentWebhookPublisher = defaultPublisher,
    private readonly lockService = advisoryLockService,
    private readonly config: PaymentExpiryConfig = DEFAULT_PAYMENT_EXPIRY_CONFIG,
    private readonly cancelSubscription: (
      subscriptionId: string,
      userId: string
    ) => Promise<boolean> | boolean = cancelSubscriptionOnExpiry,
  ) {}

  get expiryWindowSeconds(): number {
    return this.config.expiryWindowSeconds;
  }

  /**
   * Sweep all overdue intents, expire them under lock, and cancel their
   * subscriptions. Locks are always released (withLock guarantees release).
   */
  async expireOverdue(now: number = Date.now()): Promise<ExpiredPaymentResult[]> {
    const overdue = await this.intentService.getRepository().findOverdue(now, [
      'created',
      'awaiting_signature',
      'submitted',
      'pending_finality',
    ]);

    const results: ExpiredPaymentResult[] = [];

    for (const intent of overdue) {
      const lockKey = intent.subscriptionId || intent.id;

      try {
        const result = await this.lockService.withLock(lockKey, async () => {
          const fresh = await this.intentService.get(intent.id);
          if (!fresh) return null;
          const expirable: PaymentIntentStatus[] = ['created', 'awaiting_signature'];
          if (!expirable.includes(fresh.status)) {
            return null;
          }

          const expired = await this.intentService.getRepository().update(fresh.id, {
            status: 'expired',
            updatedAt: Date.now(),
          });

          let cancelled = false;
          if (fresh.subscriptionId) {
            try {
              const outcome = await this.cancelSubscription(fresh.subscriptionId, fresh.subscriberId);
              cancelled = Boolean(outcome);
            } catch (err) {
              logger.warn('Failed to cancel subscription on payment expiry', {
                intentId: fresh.id,
                subscriptionId: fresh.subscriptionId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          try {
            await this.publisher.publishExpired(expired);
          } catch (err) {
            logger.warn('Failed to publish expiry webhook', {
              intentId: expired.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }

          return { intent: expired, subscriptionCancelled: cancelled };
        });

        if (result) {
          results.push(result);
        }
      } catch (err) {
        logger.warn('Failed to expire overdue payment intent', {
          intentId: intent.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /** Expire a single payment intent (used by the API cancel/expire path). */
  async expireIntent(intentId: string): Promise<PaymentIntent | null> {
    const intent = await this.intentService.get(intentId);
    if (!intent) {
      return null;
    }
    const lockKey = intent.subscriptionId || intent.id;

    return this.lockService.withLock(lockKey, async () => {
      const fresh = await this.intentService.get(intentId);
      if (!fresh || fresh.status === 'expired' || fresh.status === 'finalized') {
        return fresh;
      }
      const expired = await this.intentService.getRepository().update(fresh.id, {
        status: 'expired',
        updatedAt: Date.now(),
      });

      if (fresh.subscriptionId) {
        try {
          await this.cancelSubscription(fresh.subscriptionId, fresh.subscriberId);
        } catch (err) {
          logger.warn('Failed to cancel subscription on single intent expiry', {
            intentId: fresh.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      try {
        await this.publisher.publishExpired(expired);
      } catch (err) {
        logger.warn('Failed to publish expiry webhook for single intent', {
          intentId: expired.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return expired;
    });
  }
}

export const paymentExpiryService = new PaymentExpiryService();
export default paymentExpiryService;
