/**
 * Trial Service — trial period creation, conversion, and expiry.
 *
 * Manages the trial lifecycle from start through conversion or expiry.
 * State is held in-process; a database-backed store should replace
 * `this.trials` in production. The interface is stable either way.
 */

import { randomUUID } from 'crypto';
import { createPiiSafeLogger } from '../../../utils/logger';
import { LifecycleError } from './errors';
import { metrics, MetricName } from '../observability';
import type {
  ConvertTrialRequest,
  StartTrialRequest,
  TrialRecord,
  TrialStatus,
} from './types';

const logger = createPiiSafeLogger('subscriptions.lifecycle.trial');

const DEFAULT_TRIAL_DAYS = 14;
const MAX_TRIAL_DAYS = 90;

export class TrialService {
  /** In-process store. Swap for a DB-backed store in production. */
  private readonly trials = new Map<string, TrialRecord>();

  /** Per-plan duration overrides. */
  private readonly planDurations = new Map<string, number>();

  registerPlanDuration(planId: string, days: number): void {
    this.planDurations.set(planId, days);
  }

  /**
   * Start a trial for a subscription.
   *
   * @throws {LifecycleError} if the subscription already has an active trial.
   */
  start(request: StartTrialRequest): TrialRecord {
    const existing = this.getBySubscription(request.subscriptionId);
    if (existing?.status === 'active') {
      throw new LifecycleError(
        'LIFECYCLE_TRIAL_ACTIVE' as const,
        `Subscription ${request.subscriptionId} already has an active trial`,
        { subscriptionId: request.subscriptionId },
      );
    }

    const durationDays = Math.min(
      MAX_TRIAL_DAYS,
      request.durationDays ??
        this.planDurations.get(request.planId) ??
        DEFAULT_TRIAL_DAYS,
    );

    const now = Date.now();
    const record: TrialRecord = {
      id: randomUUID(),
      subscriptionId: request.subscriptionId,
      planId: request.planId,
      userId: request.userId,
      status: 'active',
      durationDays,
      startedAt: now,
      endsAt: now + durationDays * 86_400_000,
    };

    this.trials.set(record.id, record);

    logger.info('lifecycle.trial.started', {
      trialId: record.id,
      subscriptionId: record.subscriptionId,
      planId: record.planId,
      durationDays,
    });

    metrics.increment(MetricName.LIFECYCLE_TRIAL_START, { planId: request.planId });

    return record;
  }

  /**
   * Convert an active trial to a paid subscription.
   *
   * @throws {LifecycleError} when no active trial exists.
   */
  convert(request: ConvertTrialRequest): TrialRecord {
    const trial = this.getBySubscription(request.subscriptionId);
    if (!trial || trial.status !== 'active') {
      throw LifecycleError.trialNotFound(request.subscriptionId);
    }

    const updated: TrialRecord = {
      ...trial,
      status: 'converted',
      convertedAt: Date.now(),
    };
    this.trials.set(trial.id, updated);

    logger.info('lifecycle.trial.converted', {
      trialId: trial.id,
      subscriptionId: trial.subscriptionId,
    });

    metrics.increment(MetricName.LIFECYCLE_TRIAL_CONVERT, { planId: trial.planId });

    return updated;
  }

  /**
   * Expire all trials whose end date has passed.
   * Returns the list of expired records.
   */
  processExpirations(now = Date.now()): TrialRecord[] {
    const expired: TrialRecord[] = [];
    for (const [id, trial] of this.trials) {
      if (trial.status === 'active' && trial.endsAt <= now) {
        const updated: TrialRecord = { ...trial, status: 'expired' };
        this.trials.set(id, updated);
        expired.push(updated);
        logger.info('lifecycle.trial.expired', {
          trialId: id,
          subscriptionId: trial.subscriptionId,
        });
        metrics.increment(MetricName.LIFECYCLE_TRIAL_EXPIRE);
      }
    }
    return expired;
  }

  getById(trialId: string): TrialRecord | undefined {
    return this.trials.get(trialId);
  }

  getBySubscription(subscriptionId: string): TrialRecord | undefined {
    for (const trial of this.trials.values()) {
      if (trial.subscriptionId === subscriptionId) return trial;
    }
    return undefined;
  }

  /** Checks whether a subscription is in an active trial. */
  isActive(subscriptionId: string, now = Date.now()): boolean {
    const trial = this.getBySubscription(subscriptionId);
    return trial?.status === 'active' && trial.endsAt > now;
  }

  getMetrics(): { total: number; active: number; converted: number; expired: number } {
    let active = 0, converted = 0, expired = 0;
    for (const t of this.trials.values()) {
      if (t.status === 'active') active++;
      else if (t.status === 'converted') converted++;
      else if (t.status === 'expired') expired++;
    }
    return { total: this.trials.size, active, converted, expired };
  }
}

export const trialService = new TrialService();
