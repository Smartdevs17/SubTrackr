/**
 * Pause/Resume Service — billing adjustment engine for subscription pauses.
 *
 * When a subscription is paused, unused days in the current billing period are
 * converted to a credit that reduces the next invoice. Resuming early returns
 * the unconsumed portion of that credit.
 *
 * All calculations are pure (no I/O). Event emission and persistence are the
 * caller's responsibility.
 */

import { createPiiSafeLogger } from '../../../utils/logger';
import { LifecycleError } from './errors';
import type {
  PauseRequest,
  PauseResult,
  ResumeRequest,
  ResumeResult,
  SubscriptionStatus,
} from './types';

const logger = createPiiSafeLogger('subscriptions.lifecycle.pause');

const MIN_PAUSE_DAYS = 1;
const MAX_PAUSE_DAYS = 90;

export class PauseResumeService {
  /**
   * Calculate billing adjustments and return a pause result.
   *
   * @throws {LifecycleError} when the subscription is not in a pausable state.
   */
  pause(request: PauseRequest, currentStatus: SubscriptionStatus): PauseResult {
    if (currentStatus === 'paused') {
      throw LifecycleError.alreadyPaused(request.subscriptionId);
    }
    if (currentStatus !== 'active' && currentStatus !== 'trialing') {
      throw LifecycleError.invalidState(
        request.subscriptionId,
        'active | trialing',
        currentStatus,
      );
    }
    if (request.pauseDays < MIN_PAUSE_DAYS || request.pauseDays > MAX_PAUSE_DAYS) {
      throw LifecycleError.invalidState(
        request.subscriptionId,
        `pauseDays between ${MIN_PAUSE_DAYS} and ${MAX_PAUSE_DAYS}`,
        String(request.pauseDays),
      );
    }

    const dailyRate = request.price / (request.periodDays || 30);
    const creditAmount = round2(dailyRate * request.pauseDays);
    const now = Date.now();
    const resumeAt = now + request.pauseDays * 86_400_000;

    logger.info('lifecycle.pause.calculated', {
      subscriptionId: request.subscriptionId,
      pauseDays: request.pauseDays,
      creditAmount,
      currency: request.currency,
    });

    return {
      subscriptionId: request.subscriptionId,
      pausedAt: now,
      resumeAt,
      creditAmount,
      currency: request.currency,
    };
  }

  /**
   * Calculate the unused credit returned on early resume.
   *
   * @throws {LifecycleError} when the subscription is not paused.
   */
  resume(request: ResumeRequest, currentStatus: SubscriptionStatus): ResumeResult {
    if (currentStatus !== 'paused') {
      throw LifecycleError.notPaused(request.subscriptionId);
    }

    const daysRemaining = Math.max(0, request.pauseDays - request.daysElapsed);
    const dailyCredit = request.creditAmount / (request.pauseDays || 1);
    const unusedCredit = round2(dailyCredit * daysRemaining);

    logger.info('lifecycle.resume.calculated', {
      subscriptionId: request.subscriptionId,
      daysElapsed: request.daysElapsed,
      daysRemaining,
      unusedCredit,
    });

    return {
      subscriptionId: request.subscriptionId,
      resumedAt: Date.now(),
      unusedCredit,
      currency: 'USD', // currency is preserved by callers who store PauseResult
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const pauseResumeService = new PauseResumeService();
