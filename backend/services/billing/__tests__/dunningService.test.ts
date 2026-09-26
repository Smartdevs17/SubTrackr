import { DunningService } from '../dunningService';
import type { RetryStrategy } from '../../../../src/types/dunning';
import { DEFAULT_DUNNING_STAGES } from '../../../../src/types/dunning';

const strategy = (overrides: Partial<RetryStrategy> = {}): RetryStrategy => ({
  stages: DEFAULT_DUNNING_STAGES,
  maxRetries: 3,
  retryIntervalHours: 1,
  warnAfterFailures: 3,
  suspendAfterDays: 3,
  cancelAfterDays: 7,
  communicationChannels: ['email', 'push'],
  ...overrides,
});

const ONE_HOUR_MS = 3_600_000;

let service: DunningService;

beforeEach(() => {
  service = new DunningService();
});

describe('strategy resolution', () => {
  it('falls back to the built-in strategy for an unconfigured plan', () => {
    const resolved = service.getStrategy('plan_unknown', 'default');
    expect(resolved.stages).toEqual(DEFAULT_DUNNING_STAGES);
  });

  it('uses the plan default once configured', () => {
    const custom = strategy({ maxRetries: 9 });
    service.configurePlan('plan_a', { defaultStrategy: custom });
    expect(service.getStrategy('plan_a', 'default').maxRetries).toBe(9);
  });

  it('prefers a failure-reason override over the plan default', () => {
    service.configurePlan('plan_a', {
      defaultStrategy: strategy({ maxRetries: 3 }),
      strategies: { expired_card: strategy({ maxRetries: 1 }) },
    });
    expect(service.getStrategy('plan_a', 'default').maxRetries).toBe(3);
    expect(service.getStrategy('plan_a', 'expired_card').maxRetries).toBe(1);
  });

  it('prefers an active A/B variant over everything else', () => {
    service.configurePlan('plan_a', {
      defaultStrategy: strategy({ maxRetries: 3 }),
      strategies: { expired_card: strategy({ maxRetries: 1 }) },
    });
    service.configureABTest('plan_a', true, [
      { id: 'aggressive', weight: 1, strategy: strategy({ maxRetries: 7 }) },
    ]);
    expect(service.getStrategy('plan_a', 'expired_card', 'aggressive').maxRetries).toBe(7);
  });

  it('ignores a variant when the A/B test is disabled', () => {
    service.configurePlan('plan_a', { defaultStrategy: strategy({ maxRetries: 3 }) });
    service.configureABTest('plan_a', false, [
      { id: 'aggressive', weight: 1, strategy: strategy({ maxRetries: 7 }) },
    ]);
    expect(service.getStrategy('plan_a', 'default', 'aggressive').maxRetries).toBe(3);
  });

  it('keeps the existing default when a later configurePlan omits it', () => {
    service.configurePlan('plan_a', { defaultStrategy: strategy({ maxRetries: 5 }) });
    service.configurePlan('plan_a', { strategies: {} });
    expect(service.getStrategy('plan_a', 'default').maxRetries).toBe(5);
  });
});

describe('configurable retry backoff', () => {
  it('repeats the base delay under a fixed policy', () => {
    service.configureRetrySchedule({
      failureType: 'card_declined',
      baseDelayHours: 4,
      backoffPolicy: 'fixed',
      maxDelayHours: 100,
    });
    expect(service.calculateRetryDelay('card_declined', 1)).toBe(4);
    expect(service.calculateRetryDelay('card_declined', 5)).toBe(4);
  });

  it('scales linearly with the attempt number under a linear policy', () => {
    service.configureRetrySchedule({
      failureType: 'card_declined',
      baseDelayHours: 2,
      backoffPolicy: 'linear',
      maxDelayHours: 100,
    });
    expect(service.calculateRetryDelay('card_declined', 1)).toBe(2);
    expect(service.calculateRetryDelay('card_declined', 3)).toBe(6);
  });

  it('compounds under an exponential policy', () => {
    service.configureRetrySchedule({
      failureType: 'card_declined',
      baseDelayHours: 1,
      backoffMultiplier: 3,
      backoffPolicy: 'exponential',
      maxDelayHours: 1_000,
    });
    expect(service.calculateRetryDelay('card_declined', 1)).toBe(1);
    expect(service.calculateRetryDelay('card_declined', 3)).toBe(9);
  });

  it('caps the delay at maxDelayHours', () => {
    service.configureRetrySchedule({
      failureType: 'card_declined',
      baseDelayHours: 1,
      backoffMultiplier: 10,
      backoffPolicy: 'exponential',
      maxDelayHours: 12,
    });
    expect(service.calculateRetryDelay('card_declined', 8)).toBe(12);
  });

  it('keeps jittered delays inside the configured envelope', () => {
    service.configureRetrySchedule({
      failureType: 'network_error',
      baseDelayHours: 4,
      backoffMultiplier: 1,
      backoffPolicy: 'exponential_jitter',
      jitterRatio: 0.25,
      maxDelayHours: 10,
    });
    const samples = Array.from({ length: 200 }, () =>
      service.calculateRetryDelay('network_error', 1)
    );
    for (const sample of samples) {
      expect(sample).toBeGreaterThanOrEqual(3);
      expect(sample).toBeLessThanOrEqual(5);
    }
    // Jitter must actually spread the values, otherwise it is not doing its job.
    expect(new Set(samples).size).toBeGreaterThan(1);
  });

  it('treats attempt 0 as the first attempt', () => {
    service.configureRetrySchedule({
      failureType: 'card_declined',
      baseDelayHours: 3,
      backoffPolicy: 'linear',
      maxDelayHours: 100,
    });
    expect(service.calculateRetryDelay('card_declined', 0)).toBe(3);
  });

  it('merges a partial schedule update onto the existing one', () => {
    service.configureRetrySchedule({ failureType: 'expired_card', maxRetries: 9 });
    const schedule = service.getRetrySchedule('expired_card');
    expect(schedule.maxRetries).toBe(9);
    // Untouched fields keep their defaults.
    expect(schedule.baseDelayHours).toBe(24);
    expect(schedule.backoffPolicy).toBe('fixed');
  });

  it('falls back to the unknown schedule for an unregistered failure type', () => {
    const schedule = service.getRetrySchedule('not_a_real_type' as never);
    expect(schedule.failureType).toBe('unknown');
  });
});

describe('dunning lifecycle', () => {
  const start = () => service.startDunning('sub_1', 'subscriber_1', 'merchant_1', 'plan_a');

  it('opens an entry at the first stage of the resolved strategy', () => {
    service.configurePlan('plan_a', { defaultStrategy: strategy() });
    const entry = start();
    expect(entry.currentStage).toBe('retry');
    expect(entry.failedAttempts).toBe(0);
    expect(service.getDunningEntry('sub_1')).toBe(entry);
  });

  it('is idempotent — starting twice returns the same entry', () => {
    expect(start()).toBe(start());
    expect(service.listActiveDunning()).toHaveLength(1);
  });

  it('schedules the next retry using the configured backoff', () => {
    service.configurePlan('plan_a', { defaultStrategy: strategy() });
    service.configureRetrySchedule({
      failureType: 'network_error',
      baseDelayHours: 2,
      backoffPolicy: 'fixed',
      maxRetries: 10,
      maxDelayHours: 100,
    });
    start();
    const before = Date.now();
    const entry = service.recordFailedCharge('sub_1', 'network_error')!;
    expect(entry.failedAttempts).toBe(1);
    expect(entry.currentStage).toBe('retry');
    expect(entry.nextActionAt - before).toBeGreaterThanOrEqual(2 * ONE_HOUR_MS - 50);
  });

  it('advances to the next stage once the stage attempt budget is spent', () => {
    service.configurePlan('plan_a', { defaultStrategy: strategy() });
    service.configureRetrySchedule({ failureType: 'network_error', maxRetries: 99 });
    start();
    // The default `retry` stage allows 3 attempts.
    service.recordFailedCharge('sub_1', 'network_error');
    service.recordFailedCharge('sub_1', 'network_error');
    const entry = service.recordFailedCharge('sub_1', 'network_error')!;
    expect(entry.currentStage).toBe('warn');
    expect(entry.failedAttempts).toBe(0);
  });

  it('escalates immediately for a failure type marked non-retryable', () => {
    service.configurePlan('plan_a', { defaultStrategy: strategy() });
    service.configureRetrySchedule({ failureType: 'expired_card', retryable: false });
    start();
    const entry = service.recordFailedCharge('sub_1', 'expired_card')!;
    expect(entry.currentStage).toBe('warn');
  });

  it('sends a stage communication when it escalates', () => {
    service.configurePlan('plan_a', { defaultStrategy: strategy() });
    service.configureRetrySchedule({ failureType: 'expired_card', retryable: false });
    start();
    service.recordFailedCharge('sub_1', 'expired_card');
    const comms = service.getCommunications('sub_1');
    expect(comms).toHaveLength(1);
    expect(comms[0].stage).toBe('warn');
    expect(comms[0].templateId).toBe('payment_warning');
    // The channel comes from the resolved strategy, not a hardcoded default.
    expect(comms[0].channel).toBe('email');
  });

  it('lands on cancel once the ladder is exhausted', () => {
    service.configurePlan('plan_a', {
      defaultStrategy: strategy({ stages: [{ stage: 'retry', delayHours: 1, maxAttempts: 1, templateId: 'payment_retry' }] }),
    });
    service.configureRetrySchedule({ failureType: 'unknown', maxRetries: 99 });
    start();
    const entry = service.recordFailedCharge('sub_1', 'unknown')!;
    expect(entry.currentStage).toBe('cancel');
  });

  it('does not record failures against a paused entry', () => {
    start();
    service.pauseDunning('sub_1');
    expect(service.recordFailedCharge('sub_1')).toBeNull();
  });

  it('reschedules on resume', () => {
    service.configurePlan('plan_a', { defaultStrategy: strategy() });
    start();
    service.pauseDunning('sub_1');
    const resumed = service.resumeDunning('sub_1')!;
    expect(resumed.isPaused).toBe(false);
    expect(resumed.nextActionAt).toBeGreaterThan(Date.now());
  });

  it('returns null for lifecycle calls on an unknown subscription', () => {
    expect(service.recordFailedCharge('nope')).toBeNull();
    expect(service.recordSuccessfulCharge('nope')).toBeNull();
    expect(service.pauseDunning('nope')).toBeNull();
    expect(service.resumeDunning('nope')).toBeNull();
    expect(service.overrideStage('nope', 'warn')).toBeNull();
  });

  it('closes the entry on a successful charge', () => {
    start();
    service.recordFailedCharge('sub_1');
    const recovered = service.recordSuccessfulCharge('sub_1');
    expect(recovered).not.toBeNull();
    expect(service.getDunningEntry('sub_1')).toBeUndefined();
    expect(service.listRecoveredDunning('merchant_1')).toHaveLength(1);
  });

  it('lists only entries whose next action is due', () => {
    service.configurePlan('plan_a', { defaultStrategy: strategy() });
    start();
    expect(service.getProcessableEntries()).toHaveLength(0);
    service.overrideStage('sub_1', 'retry');
    const entry = service.getDunningEntry('sub_1')!;
    entry.nextActionAt = Date.now() - 1_000;
    expect(service.getProcessableEntries()).toHaveLength(1);
  });

  it('scopes active listings by merchant', () => {
    service.startDunning('sub_1', 'subscriber_1', 'merchant_1', 'plan_a');
    service.startDunning('sub_2', 'subscriber_2', 'merchant_2', 'plan_a');
    expect(service.listActiveDunning('merchant_1')).toHaveLength(1);
    expect(service.listActiveDunning()).toHaveLength(2);
  });
});

describe('analytics', () => {
  beforeEach(() => {
    service.configurePlan('plan_a', { defaultStrategy: strategy() });
    service.configureRetrySchedule({ failureType: 'network_error', maxRetries: 99 });
  });

  it('counts retries by failure type', () => {
    service.startDunning('sub_1', 'subscriber_1', 'merchant_1', 'plan_a');
    service.recordFailedCharge('sub_1', 'network_error');
    service.recordFailedCharge('sub_1', 'card_declined');
    const analytics = service.getRetryAnalytics('merchant_1');
    expect(analytics.totalRetries).toBe(2);
    expect(analytics.retriesByFailureType.network_error).toBe(1);
    expect(analytics.retriesByFailureType.card_declined).toBe(1);
    expect(analytics.successfulRetries).toBe(0);
  });

  it('scopes analytics to a merchant', () => {
    service.startDunning('sub_1', 'subscriber_1', 'merchant_1', 'plan_a');
    service.startDunning('sub_2', 'subscriber_2', 'merchant_2', 'plan_a');
    service.recordFailedCharge('sub_1', 'network_error');
    service.recordFailedCharge('sub_2', 'network_error');
    expect(service.getRetryAnalytics('merchant_1').totalRetries).toBe(1);
    expect(service.getRetryAnalytics().totalRetries).toBe(2);
  });

  it('measures recovery rate over closed outcomes only', () => {
    service.startDunning('sub_1', 'subscriber_1', 'merchant_1', 'plan_a');
    service.startDunning('sub_2', 'subscriber_2', 'merchant_1', 'plan_a');
    service.recordFailedCharge('sub_1', 'network_error');
    service.recordSuccessfulCharge('sub_1');
    service.overrideStage('sub_2', 'cancel');

    const analytics = service.getAnalytics('merchant_1');
    expect(analytics.totalRecovered).toBe(1);
    expect(analytics.totalLost).toBe(1);
    expect(analytics.recoveryRate).toBe(50);
  });

  it('reports zeroes rather than NaN with no history', () => {
    const analytics = service.getAnalytics('merchant_none');
    expect(analytics.recoveryRate).toBe(0);
    expect(analytics.averageDaysToRecovery).toBe(0);
    expect(analytics.totalActiveDunning).toBe(0);
    expect(service.getRetryAnalytics('merchant_none').successRate).toBe(0);
  });

  it('breaks active entries down by stage', () => {
    service.startDunning('sub_1', 'subscriber_1', 'merchant_1', 'plan_a');
    service.startDunning('sub_2', 'subscriber_2', 'merchant_1', 'plan_a');
    service.overrideStage('sub_2', 'suspend');
    const { stageBreakdown } = service.getAnalytics('merchant_1');
    expect(stageBreakdown.retry).toBe(1);
    expect(stageBreakdown.suspend).toBe(1);
  });
});

describe('communication templates', () => {
  it('ships the default template set', () => {
    expect(service.getTemplates().map((t) => t.id)).toEqual([
      'payment_retry',
      'payment_warning',
      'service_suspension',
      'subscription_cancellation',
    ]);
  });

  it('adds, updates, and removes templates', () => {
    service.addTemplate({
      id: 'custom',
      stage: 'warn',
      subject: 'Subject',
      body: 'Body',
      pushTitle: 'Title',
      pushBody: 'Push',
      actionLabel: 'Go',
      actionUrl: '/go',
    });
    expect(service.getTemplates()).toHaveLength(5);

    service.updateTemplate('custom', { subject: 'Updated' });
    expect(service.getTemplates().find((t) => t.id === 'custom')?.subject).toBe('Updated');

    service.removeTemplate('custom');
    expect(service.getTemplates()).toHaveLength(4);
  });

  it('does not add the same template id twice', () => {
    const existing = service.getTemplates()[0];
    service.addTemplate(existing);
    expect(service.getTemplates()).toHaveLength(4);
  });
});

describe('reset', () => {
  it('clears entries, history, and configuration', () => {
    service.configurePlan('plan_a', { defaultStrategy: strategy({ maxRetries: 9 }) });
    service.startDunning('sub_1', 'subscriber_1', 'merchant_1', 'plan_a');
    service.recordFailedCharge('sub_1');
    service.reset();

    expect(service.listActiveDunning()).toHaveLength(0);
    expect(service.listRecoveredDunning()).toHaveLength(0);
    expect(service.getConfiguration('plan_a')).toBeUndefined();
    expect(service.getRetryAnalytics().totalRetries).toBe(0);
  });
});
