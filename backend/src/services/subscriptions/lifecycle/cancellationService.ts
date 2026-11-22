/**
 * Cancellation Service — subscription cancellation flow.
 *
 * Supports immediate cancellation (access revoked now) and
 * end-of-period cancellation (access continues until the period ends).
 * Both paths are pure: no I/O, testable in isolation.
 *
 * The caller is responsible for:
 *  - Validating the subscription exists and is in a cancellable state.
 *  - Persisting the returned result.
 *  - Publishing the `subscription.cancelled` lifecycle event via
 *    {@link SubscriptionEventBus}.
 */

import { createPiiSafeLogger } from '../../../utils/logger';
import { LifecycleError } from './errors';
import { metrics, MetricName } from '../observability';
import type {
  CancellationMode,
  CancellationRequest,
  CancellationResult,
  SubscriptionStatus,
} from './types';

const logger = createPiiSafeLogger('subscriptions.lifecycle.cancellation');

const CANCELLABLE_STATES: SubscriptionStatus[] = [
  'trialing',
  'active',
  'paused',
  'past_due',
];

export class CancellationService {
  /**
   * Processes a cancellation request and returns the effective timestamps.
   *
   * @param request      - What to cancel and how.
   * @param currentStatus - Current subscription status (guard against invalid transitions).
   * @param periodEnd    - Epoch ms of the current billing period end (used for
   *                       end-of-period mode).
   */
  cancel(
    request: CancellationRequest,
    currentStatus: SubscriptionStatus,
    periodEnd?: number,
  ): CancellationResult {
    if (!CANCELLABLE_STATES.includes(currentStatus)) {
      throw LifecycleError.invalidState(
        request.subscriptionId,
        CANCELLABLE_STATES.join(' | '),
        currentStatus,
      );
    }

    if (currentStatus === 'cancelled') {
      throw LifecycleError.alreadyCancelled(request.subscriptionId);
    }

    const now = Date.now();
    const effectiveAt =
      request.mode === 'immediate' ? now : (periodEnd ?? now);

    logger.info('lifecycle.cancellation.processed', {
      subscriptionId: request.subscriptionId,
      mode: request.mode,
      reason: request.reason,
      effectiveAt,
    });

    metrics.increment(MetricName.LIFECYCLE_CANCEL, { mode: request.mode });

    return {
      subscriptionId: request.subscriptionId,
      mode: request.mode,
      effectiveAt,
      cancelledAt: now,
    };
  }

  /**
   * Whether the given status allows cancellation.
   */
  canCancel(status: SubscriptionStatus): boolean {
    return CANCELLABLE_STATES.includes(status);
  }

  /**
   * Determine which cancellation mode to apply based on caller preference
   * and remaining days in the period. If fewer than 3 days remain, default
   * to immediate to avoid a pointless end-of-period grace window.
   */
  resolveMode(
    preferredMode: CancellationMode,
    periodEnd: number,
    now = Date.now(),
  ): CancellationMode {
    const remainingMs = periodEnd - now;
    const threeDaysMs = 3 * 86_400_000;
    return remainingMs < threeDaysMs ? 'immediate' : preferredMode;
  }
}

export const cancellationService = new CancellationService();
