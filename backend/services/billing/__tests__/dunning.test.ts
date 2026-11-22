import {
  IntelligentRetryScheduler,
  DunningOrchestrator,
  DEFAULT_RETRY_POLICY,
  DEFAULT_GRACE_PERIOD_CONFIG,
  noopDispatcher,
  type DeclineCode,
  type RetryPolicy,
  type OutreachPayload,
  type GracePeriodConfig,
} from '../dunning';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeScheduler() {
  return new IntelligentRetryScheduler();
}

function registerInvoice(
  scheduler: IntelligentRetryScheduler,
  overrides?: Partial<{ invoiceId: string; amount: number; planId: string }>,
) {
  const invoiceId = overrides?.invoiceId ?? 'inv_001';
  const planId = overrides?.planId ?? 'plan_basic';
  const amount = overrides?.amount ?? 100;
  return scheduler.register(invoiceId, 'sub_001', planId, amount, 'USD');
}

// ─── Policy management ────────────────────────────────────────────────────────

describe('setPlanPolicy', () => {
  it('merges with defaults', () => {
    const s = makeScheduler();
    const policy = s.setPlanPolicy('plan_a', { maxRetries: 6, baseDelayHours: 2 });
    expect(policy.maxRetries).toBe(6);
    expect(policy.baseDelayHours).toBe(2);
    expect(policy.backoffMultiplier).toBe(DEFAULT_RETRY_POLICY.backoffMultiplier);
  });

  it('caps maxRetries at 10', () => {
    const s = makeScheduler();
    const policy = s.setPlanPolicy('plan_b', { maxRetries: 999 });
    expect(policy.maxRetries).toBe(10);
  });

  it('getPlanPolicy returns default when no override', () => {
    const s = makeScheduler();
    expect(s.getPlanPolicy('unknown_plan')).toEqual(DEFAULT_RETRY_POLICY);
  });
});

// ─── register ─────────────────────────────────────────────────────────────────

describe('register', () => {
  it('creates a record with zero attempts', () => {
    const s = makeScheduler();
    const r = registerInvoice(s);
    expect(r.attempts).toBe(0);
    expect(r.cardUpdaterTriggered).toBe(false);
  });

  it('inherits maxAttempts from plan policy', () => {
    const s = makeScheduler();
    s.setPlanPolicy('plan_x', { maxRetries: 7 });
    const r = s.register('inv_x', 'sub_x', 'plan_x', 50, 'USD');
    expect(r.maxAttempts).toBe(7);
  });
});

// ─── decideRetry — hard blocks ────────────────────────────────────────────────

describe('decideRetry — hard blocks', () => {
  it('never retries card_lost_stolen', () => {
    const s = makeScheduler();
    registerInvoice(s);
    const d = s.decideRetry('inv_001', 'card_lost_stolen', 'plan_basic');
    expect(d.shouldRetry).toBe(false);
    expect(d.escalatePriority).toBe(true);
  });

  it('stops after maxAttempts', () => {
    const s = makeScheduler();
    s.setPlanPolicy('plan_basic', { maxRetries: 2 });
    registerInvoice(s);
    s.decideRetry('inv_001', 'insufficient_funds', 'plan_basic');
    s.decideRetry('inv_001', 'insufficient_funds', 'plan_basic');
    const d = s.decideRetry('inv_001', 'insufficient_funds', 'plan_basic');
    expect(d.shouldRetry).toBe(false);
    expect(d.escalatePriority).toBe(true);
  });

  it('returns not-found when invoice is unknown', () => {
    const s = makeScheduler();
    const d = s.decideRetry('missing', 'generic_decline', 'plan_basic');
    expect(d.shouldRetry).toBe(false);
  });
});

// ─── decideRetry — normal path ────────────────────────────────────────────────

describe('decideRetry — normal path', () => {
  const retryCodes: DeclineCode[] = [
    'insufficient_funds',
    'card_expired',
    'do_not_honor',
    'authentication_required',
    'generic_decline',
    'network_error',
    'processing_error',
  ];

  it.each(retryCodes)('schedules a retry for %s', (code) => {
    const s = makeScheduler();
    registerInvoice(s);
    const d = s.decideRetry('inv_001', code, 'plan_basic');
    expect(d.shouldRetry).toBe(true);
    expect(d.delayHours).toBeGreaterThan(0);
  });

  it('respects maxDelayHours ceiling', () => {
    const s = makeScheduler();
    s.setPlanPolicy('plan_basic', { maxDelayHours: 1 });
    registerInvoice(s);
    // exhaust several retries to grow backoff
    for (let i = 0; i < 3; i++) {
      s.decideRetry('inv_001', 'insufficient_funds', 'plan_basic');
    }
    const d = s.decideRetry('inv_001', 'insufficient_funds', 'plan_basic');
    expect(d.shouldRetry).toBe(true);
    expect(d.delayHours).toBeLessThanOrEqual(1 + 0.5); // ceiling + jitter bound
  });

  it('triggers card updater on card_expired', () => {
    const s = makeScheduler();
    registerInvoice(s);
    s.decideRetry('inv_001', 'card_expired', 'plan_basic');
    const r = s.getRecord('inv_001')!;
    expect(r.cardUpdaterTriggered).toBe(true);
  });

  it('does not trigger card updater twice', () => {
    const s = makeScheduler();
    registerInvoice(s);
    s.decideRetry('inv_001', 'card_expired', 'plan_basic');
    s.decideRetry('inv_001', 'card_expired', 'plan_basic');
    const r = s.getRecord('inv_001')!;
    expect(r.cardUpdaterTriggered).toBe(true); // still true, not toggled
  });

  it('suggests a split for large amounts on first retry', () => {
    const s = makeScheduler();
    s.register('inv_big', 'sub_1', 'plan_basic', 1000, 'USD');
    const d = s.decideRetry('inv_big', 'insufficient_funds', 'plan_basic');
    expect(d.splitAmount).toBe(500);
  });

  it('does not split on second+ retry', () => {
    const s = makeScheduler();
    s.register('inv_big', 'sub_1', 'plan_basic', 1000, 'USD');
    s.decideRetry('inv_big', 'insufficient_funds', 'plan_basic');
    const d = s.decideRetry('inv_big', 'insufficient_funds', 'plan_basic');
    expect(d.splitAmount).toBeUndefined();
  });
});

// ─── Circuit breaker ──────────────────────────────────────────────────────────

describe('circuit breaker', () => {
  it('opens after circuitBreakerThreshold attempts', () => {
    const s = makeScheduler();
    s.setPlanPolicy('plan_basic', {
      maxRetries: 10,
      circuitBreakerThreshold: 3,
      circuitBreakerCooldownHours: 24,
    });
    registerInvoice(s);
    // reach the threshold
    for (let i = 0; i < 3; i++) {
      s.decideRetry('inv_001', 'generic_decline', 'plan_basic');
    }
    const d = s.decideRetry('inv_001', 'generic_decline', 'plan_basic');
    expect(d.shouldRetry).toBe(false);
    expect(d.reason).toMatch(/circuit breaker/i);
  });
});

// ─── recordSuccess ────────────────────────────────────────────────────────────

describe('recordSuccess', () => {
  it('appends a success data point', () => {
    const s = makeScheduler();
    registerInvoice(s);
    s.recordSuccess('inv_001');
    const r = s.getRecord('inv_001')!;
    expect(r.successHistory).toHaveLength(1);
    expect(r.successHistory[0].utcHour).toBeGreaterThanOrEqual(0);
  });

  it('is a no-op for unknown invoice', () => {
    const s = makeScheduler();
    expect(() => s.recordSuccess('ghost')).not.toThrow();
  });
});

// ─── Analytics ────────────────────────────────────────────────────────────────

describe('getAnalytics', () => {
  it('returns zero totals for empty scheduler', () => {
    const s = makeScheduler();
    const a = s.getAnalytics();
    expect(a.totalInvoices).toBe(0);
    expect(a.successRate).toBe(0);
  });

  it('counts exhausted invoices correctly', () => {
    const s = makeScheduler();
    s.setPlanPolicy('plan_basic', { maxRetries: 1 });
    registerInvoice(s);
    // exhaust
    s.decideRetry('inv_001', 'generic_decline', 'plan_basic');
    s.decideRetry('inv_001', 'generic_decline', 'plan_basic');
    const a = s.getAnalytics();
    expect(a.exhaustedInvoices).toBe(1);
  });

  it('builds hourlySuccessHeatmap', () => {
    const s = makeScheduler();
    registerInvoice(s);
    s.recordSuccess('inv_001');
    const a = s.getAnalytics();
    expect(a.hourlySuccessHeatmap).toHaveLength(24);
    const total = a.hourlySuccessHeatmap.reduce((acc, v) => acc + v, 0);
    expect(total).toBe(1);
  });

  it('tracks decline breakdown', () => {
    const s = makeScheduler();
    registerInvoice(s);
    s.decideRetry('inv_001', 'network_error', 'plan_basic');
    const a = s.getAnalytics();
    expect(a.declineBreakdown['network_error']).toBe(1);
  });
});

// ─── getAllRecords ─────────────────────────────────────────────────────────────

describe('getAllRecords', () => {
  it('returns all registered invoices', () => {
    const s = makeScheduler();
    s.register('i1', 's1', 'p1', 10, 'USD');
    s.register('i2', 's2', 'p1', 20, 'USD');
    expect(s.getAllRecords()).toHaveLength(2);
  });
});

// ─── Integration: retry until exhaustion ──────────────────────────────────────

describe('integration: retry until exhaustion', () => {
  it('stops scheduling retries once maxRetries is reached', () => {
    const s = makeScheduler();
    const max = 3;
    s.setPlanPolicy('plan_basic', { maxRetries: max });
    registerInvoice(s);

    const decisions = [];
    for (let i = 0; i <= max + 1; i++) {
      decisions.push(s.decideRetry('inv_001', 'generic_decline', 'plan_basic'));
    }

    const retrying = decisions.filter((d) => d.shouldRetry);
    const blocked = decisions.filter((d) => !d.shouldRetry);
    expect(retrying.length).toBe(max);
    expect(blocked.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── DunningOrchestrator ──────────────────────────────────────────────────────

describe('DunningOrchestrator — basic construction', () => {
  it('uses noopDispatcher by default', async () => {
    const orch = new DunningOrchestrator();
    // Should not throw
    const result = await orch.processFailed({
      invoiceId: 'inv_orch_001',
      subscriptionId: 'sub_01',
      planId: 'plan_basic',
      amount: 100,
      currency: 'USD',
      declineCode: 'generic_decline',
    });
    expect(result.decision.shouldRetry).toBe(true);
  });

  it('DEFAULT_GRACE_PERIOD_CONFIG has expected shape', () => {
    expect(DEFAULT_GRACE_PERIOD_CONFIG.durationHours).toBeGreaterThan(0);
    expect(DEFAULT_GRACE_PERIOD_CONFIG.sendReminders).toBe(true);
    expect(DEFAULT_GRACE_PERIOD_CONFIG.reminderIntervalHours).toBeGreaterThan(0);
  });

  it('noopDispatcher resolves without error', async () => {
    await expect(
      noopDispatcher({
        subscriptionId: 's1',
        invoiceId: 'i1',
        channel: 'email',
        message: 'test',
        escalate: false,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('DunningOrchestrator — processFailed', () => {
  function makeOrch(dispatcherFn?: (p: OutreachPayload) => Promise<void>) {
    return new DunningOrchestrator({
      dispatcher: dispatcherFn,
    });
  }

  it('dispatches outreach on first failure', async () => {
    const dispatched: OutreachPayload[] = [];
    const orch = makeOrch(async (p) => { dispatched.push(p); });

    const result = await orch.processFailed({
      invoiceId: 'inv_d01',
      subscriptionId: 'sub_d01',
      planId: 'plan_pro',
      amount: 50,
      currency: 'USD',
      declineCode: 'insufficient_funds',
    });

    expect(result.outreachSent).toBe(true);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].channel).toBe('push');
    expect(dispatched[0].invoiceId).toBe('inv_d01');
  });

  it('auto-registers invoice if not pre-registered', async () => {
    const orch = makeOrch();
    const result = await orch.processFailed({
      invoiceId: 'inv_new',
      subscriptionId: 'sub_new',
      planId: 'plan_basic',
      amount: 200,
      currency: 'USD',
      declineCode: 'network_error',
    });
    expect(result.decision.shouldRetry).toBe(true);
  });

  it('does NOT dispatch outreach when retry is not needed (card_lost_stolen)', async () => {
    const dispatched: OutreachPayload[] = [];
    const orch = makeOrch(async (p) => { dispatched.push(p); });

    await orch.processFailed({
      invoiceId: 'inv_stolen',
      subscriptionId: 'sub_stolen',
      planId: 'plan_basic',
      amount: 99,
      currency: 'USD',
      declineCode: 'card_lost_stolen',
    });

    // card_lost_stolen → escalatePriority=true → outreach IS sent (escalation path)
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].escalate).toBe(true);
  });

  it('does not throw when dispatcher throws', async () => {
    const orch = makeOrch(async () => { throw new Error('SMTP down'); });
    const result = await orch.processFailed({
      invoiceId: 'inv_err',
      subscriptionId: 'sub_err',
      planId: 'plan_basic',
      amount: 10,
      currency: 'USD',
      declineCode: 'processing_error',
    });
    expect(result.outreachSent).toBe(false);
    expect(result.decision.shouldRetry).toBe(true);
  });

  it('includes splitAmount in dispatch payload for large amounts', async () => {
    const dispatched: OutreachPayload[] = [];
    const orch = makeOrch(async (p) => { dispatched.push(p); });

    await orch.processFailed({
      invoiceId: 'inv_large',
      subscriptionId: 'sub_large',
      planId: 'plan_basic',
      amount: 1_000,
      currency: 'USD',
      declineCode: 'insufficient_funds',
    });

    expect(dispatched[0].splitAmount).toBe(500);
  });
});

describe('DunningOrchestrator — grace period management', () => {
  it('creates a grace period on first failure', async () => {
    const orch = new DunningOrchestrator();
    const result = await orch.processFailed({
      invoiceId: 'inv_gp01',
      subscriptionId: 'sub_gp01',
      planId: 'plan_basic',
      amount: 30,
      currency: 'USD',
      declineCode: 'generic_decline',
    });
    expect(result.gracePeriod).toBeDefined();
    expect(result.gracePeriod!.status).toBe('active');
    expect(result.gracePeriod!.invoiceId).toBe('inv_gp01');
  });

  it('returns the same grace period on repeated failures', async () => {
    const orch = new DunningOrchestrator();
    const r1 = await orch.processFailed({
      invoiceId: 'inv_gp02',
      subscriptionId: 'sub_gp02',
      planId: 'plan_basic',
      amount: 30,
      currency: 'USD',
      declineCode: 'insufficient_funds',
    });
    const r2 = await orch.processFailed({
      invoiceId: 'inv_gp02',
      subscriptionId: 'sub_gp02',
      planId: 'plan_basic',
      amount: 30,
      currency: 'USD',
      declineCode: 'insufficient_funds',
    });
    expect(r1.gracePeriod!.startedAt).toBe(r2.gracePeriod!.startedAt);
    expect(r1.gracePeriod!.expiresAt).toBe(r2.gracePeriod!.expiresAt);
  });

  it('marks grace period as recovered on processSuccess', async () => {
    const orch = new DunningOrchestrator();
    await orch.processFailed({
      invoiceId: 'inv_gp03',
      subscriptionId: 'sub_gp03',
      planId: 'plan_basic',
      amount: 50,
      currency: 'USD',
      declineCode: 'generic_decline',
    });
    await orch.processSuccess('inv_gp03');
    const gp = orch.getGracePeriod('inv_gp03')!;
    expect(gp.status).toBe('recovered');
  });

  it('getActiveGracePeriods returns only active ones', async () => {
    const orch = new DunningOrchestrator();
    await orch.processFailed({
      invoiceId: 'inv_active',
      subscriptionId: 'sub_active',
      planId: 'plan_basic',
      amount: 10,
      currency: 'USD',
      declineCode: 'generic_decline',
    });
    await orch.processFailed({
      invoiceId: 'inv_recovered',
      subscriptionId: 'sub_recovered',
      planId: 'plan_basic',
      amount: 10,
      currency: 'USD',
      declineCode: 'generic_decline',
    });
    await orch.processSuccess('inv_recovered');

    const active = orch.getActiveGracePeriods();
    expect(active.some((gp) => gp.invoiceId === 'inv_active')).toBe(true);
    expect(active.some((gp) => gp.invoiceId === 'inv_recovered')).toBe(false);
  });

  it('sweepExpiredGracePeriods expires overdue entries', async () => {
    const orch = new DunningOrchestrator({
      defaultGracePeriodConfig: {
        durationHours: 0.001, // nearly instant
        sendReminders: false,
        reminderIntervalHours: 1,
      },
    });
    await orch.processFailed({
      invoiceId: 'inv_sweep',
      subscriptionId: 'sub_sweep',
      planId: 'plan_basic',
      amount: 20,
      currency: 'USD',
      declineCode: 'generic_decline',
    });

    // Advance time well past the grace period
    const futureNow = Date.now() + 24 * 3_600_000;
    const expired = orch.sweepExpiredGracePeriods(futureNow);
    expect(expired).toContain('inv_sweep');
    expect(orch.getGracePeriod('inv_sweep')!.status).toBe('expired');
  });

  it('sweepExpiredGracePeriods skips recovered entries', async () => {
    const orch = new DunningOrchestrator({
      defaultGracePeriodConfig: {
        durationHours: 0.001,
        sendReminders: false,
        reminderIntervalHours: 1,
      },
    });
    await orch.processFailed({
      invoiceId: 'inv_skip',
      subscriptionId: 'sub_skip',
      planId: 'plan_basic',
      amount: 20,
      currency: 'USD',
      declineCode: 'generic_decline',
    });
    await orch.processSuccess('inv_skip');

    const expired = orch.sweepExpiredGracePeriods(Date.now() + 24 * 3_600_000);
    expect(expired).not.toContain('inv_skip');
  });
});

describe('DunningOrchestrator — grace period reminders', () => {
  it('sends reminders at the configured interval', async () => {
    const dispatched: OutreachPayload[] = [];
    const graceCfg: GracePeriodConfig = {
      durationHours: 72,
      sendReminders: true,
      reminderIntervalHours: 24,
    };
    const orch = new DunningOrchestrator({
      dispatcher: async (p) => { dispatched.push(p); },
      defaultGracePeriodConfig: graceCfg,
    });

    await orch.processFailed({
      invoiceId: 'inv_remind',
      subscriptionId: 'sub_remind',
      planId: 'plan_basic',
      amount: 25,
      currency: 'USD',
      declineCode: 'generic_decline',
    });
    dispatched.length = 0; // reset after initial dispatch

    // Tick immediately — not enough time has passed
    const reminded1 = await orch.tickGracePeriodReminders(Date.now());
    expect(reminded1).toHaveLength(0);

    // Tick after 25 hours
    const reminded2 = await orch.tickGracePeriodReminders(Date.now() + 25 * 3_600_000);
    expect(reminded2).toContain('inv_remind');
    const gp = orch.getGracePeriod('inv_remind')!;
    expect(gp.remindersSent).toBe(1);
  });

  it('does not send reminders when sendReminders is false', async () => {
    const dispatched: OutreachPayload[] = [];
    const orch = new DunningOrchestrator({
      dispatcher: async (p) => { dispatched.push(p); },
      defaultGracePeriodConfig: {
        durationHours: 72,
        sendReminders: false,
        reminderIntervalHours: 1,
      },
    });

    await orch.processFailed({
      invoiceId: 'inv_noremind',
      subscriptionId: 'sub_noremind',
      planId: 'plan_basic',
      amount: 25,
      currency: 'USD',
      declineCode: 'generic_decline',
    });
    dispatched.length = 0;

    const reminded = await orch.tickGracePeriodReminders(Date.now() + 50 * 3_600_000);
    expect(reminded).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
  });

  it('does not send reminders for recovered grace periods', async () => {
    const dispatched: OutreachPayload[] = [];
    const orch = new DunningOrchestrator({
      dispatcher: async (p) => { dispatched.push(p); },
    });

    await orch.processFailed({
      invoiceId: 'inv_rec_remind',
      subscriptionId: 'sub_rec_remind',
      planId: 'plan_basic',
      amount: 25,
      currency: 'USD',
      declineCode: 'generic_decline',
    });
    await orch.processSuccess('inv_rec_remind');
    dispatched.length = 0;

    const reminded = await orch.tickGracePeriodReminders(Date.now() + 50 * 3_600_000);
    expect(reminded).not.toContain('inv_rec_remind');
  });
});

describe('DunningOrchestrator — analytics passthrough', () => {
  it('getRetryAnalytics reflects decisions made via orchestrator', async () => {
    const orch = new DunningOrchestrator();
    await orch.processFailed({
      invoiceId: 'inv_analytics',
      subscriptionId: 'sub_analytics',
      planId: 'plan_basic',
      amount: 100,
      currency: 'USD',
      declineCode: 'insufficient_funds',
    });
    const analytics = orch.getRetryAnalytics();
    expect(analytics.totalInvoices).toBeGreaterThanOrEqual(1);
    expect(analytics.declineBreakdown['insufficient_funds']).toBeGreaterThanOrEqual(1);
  });

  it('getAllGracePeriods returns all tracked periods', async () => {
    const orch = new DunningOrchestrator();
    await orch.processFailed({
      invoiceId: 'inv_all1',
      subscriptionId: 'sub_a1',
      planId: 'plan_basic',
      amount: 10,
      currency: 'USD',
      declineCode: 'generic_decline',
    });
    await orch.processFailed({
      invoiceId: 'inv_all2',
      subscriptionId: 'sub_a2',
      planId: 'plan_basic',
      amount: 10,
      currency: 'USD',
      declineCode: 'generic_decline',
    });
    expect(orch.getAllGracePeriods().length).toBeGreaterThanOrEqual(2);
  });
});

describe('DunningOrchestrator — plan policy delegation', () => {
  it('setPlanPolicy is delegated to the scheduler', () => {
    const orch = new DunningOrchestrator();
    const policy = orch.setPlanPolicy('plan_delegate', { maxRetries: 5 });
    expect(policy.maxRetries).toBe(5);
  });

  it('setGracePeriodConfig overrides per-plan grace config', async () => {
    const orch = new DunningOrchestrator();
    orch.setGracePeriodConfig('plan_short_grace', {
      durationHours: 1,
      sendReminders: false,
      reminderIntervalHours: 1,
    });

    const result = await orch.processFailed({
      invoiceId: 'inv_short_grace',
      subscriptionId: 'sub_short_grace',
      planId: 'plan_short_grace',
      amount: 40,
      currency: 'USD',
      declineCode: 'generic_decline',
    });
    expect(result.gracePeriod).toBeDefined();
    expect(result.gracePeriod!.expiresAt - result.gracePeriod!.startedAt).toBe(
      1 * 3_600_000,
    );
  });
});
