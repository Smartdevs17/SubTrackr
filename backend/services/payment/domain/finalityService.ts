/**
 * Finality service – polls gateway transaction status and emits a signed
 * finality webhook once the confirmation depth threshold is met.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1719
 */

import type { PaymentIntent } from './PaymentIntent';
import { paymentIntentService as defaultIntentService, PaymentIntentService } from './paymentIntentService';
import { paymentWebhookPublisher as defaultPublisher, PaymentWebhookPublisher } from '../../webhook/paymentWebhookPublisher';
import { advisoryLockService } from '../../shared/locking/AdvisoryLockService';
import { logger } from '../../shared/logging';

/** Optional gateway capability for querying on-chain transaction status. */
export interface TransactionStatusProvider {
  getTransactionStatus?(txHash: string): Promise<{ confirmations: number; finalized: boolean; failed: boolean }>;
}

export class FinalityService {
  constructor(
    private readonly intentService: PaymentIntentService = defaultIntentService,
    private readonly publisher: PaymentWebhookPublisher = defaultPublisher,
    private readonly lockService = advisoryLockService,
  ) {}

  /**
   * Check finality for a single payment intent.
   *
   * Returns the updated intent, or null if nothing changed (e.g. already
   * finalized, no tx hash yet, or gateway unavailable).
   */
  async checkFinality(
    intentId: string,
    provider?: TransactionStatusProvider,
  ): Promise<PaymentIntent | null> {
    const intent = await this.intentService.get(intentId);
    if (!intent || !intent.txHash) {
      return null;
    }

    if (intent.status === 'finalized' || intent.status === 'failed' || intent.status === 'expired') {
      return null;
    }

    const lockKey = intent.subscriptionId || intent.id;

    return this.lockService.withLock(lockKey, async () => {
      const fresh = await this.intentService.get(intentId);
      if (!fresh || fresh.status === 'finalized' || fresh.status === 'failed' || fresh.status === 'expired') {
        return null;
      }

      const status = provider?.getTransactionStatus
        ? await provider.getTransactionStatus(fresh.txHash!)
        : { confirmations: fresh.confirmations + 1, finalized: false, failed: false };

      if (status.failed) {
        const failed = await this.intentService.markFailed(fresh.id);
        return failed;
      }

      const updated = await this.intentService.recordConfirmation(fresh.id, status.confirmations);

      if (updated.status === 'finalized' && fresh.status !== 'finalized') {
        try {
          await this.publisher.publishFinalized(updated);
        } catch (err) {
          logger.warn('Failed to publish finality webhook', {
            intentId: updated.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return updated;
    });
  }

  /**
   * Poll finality for all submitted intents. Intended to be called by a
   * background scheduler.
   */
  async pollPendingFinality(provider?: TransactionStatusProvider): Promise<PaymentIntent[]> {
    const pending = await this.intentService.getRepository().findByStatus([
      'submitted',
      'pending_finality',
    ]);

    const updated: PaymentIntent[] = [];
    for (const intent of pending) {
      try {
        const result = await this.checkFinality(intent.id, provider);
        if (result) {
          updated.push(result);
        }
      } catch (err) {
        logger.warn('Failed to check finality for payment intent', {
          intentId: intent.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return updated;
  }
}

export const finalityService = new FinalityService();
export default finalityService;
