/**
 * Tests for subscription dunning email sequences with A/B testing (issue #956)
 * Technical scope: backend/services/notification/dunningEmailSequences.ts
 */

import { DunningEmailSequenceService } from '../dunningEmailSequences';
import type { DunningStage } from '../../../../src/types/dunning';

// ─────────────────────────────────────────────────────────────────────────────
// Helper factory
// ─────────────────────────────────────────────────────────────────────────────

function makeService() {
  return new DunningEmailSequenceService();
}

function addTwoVariants(
  svc: DunningEmailSequenceService,
  stage: DunningStage = 'retry',
) {
  const a = svc.createVariant({
    name: 'Variant A',
    subject: 'Your payment failed – here is what to do',
    body: 'Hi {{name}}, please update your payment method.',
    stage,
    weight: 50,
  });
  const b = svc.createVariant({
    name: 'Variant B',
    subject: 'Action needed: renew your subscription',
    body: 'Hi {{name}}, your subscription needs attention.',
    stage,
    weight: 50,
  });
  return { a, b };
}

// ─────────────────────────────────────────────────────────────────────────────
// Email Variant Management
// ─────────────────────────────────────────────────────────────────────────────

describe('DunningEmailSequenceService – variant management', () => {
  it('creates a variant with all required fields', () => {
    const svc = makeService();
    const v = svc.createVariant({
      name: 'Soft reminder',
      subject: 'Quick note about your account',
      body: 'Please update your card.',
      stage: 'retry',
    });

    expect(v.id).toBeTruthy();
    expect(v.name).toBe('Soft reminder');
    expect(v.stage).toBe('retry');
    expect(v.weight).toBe(50); // default weight
    expect(v.isActive).toBe(true);
    expect(v.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('accepts a custom weight', () => {
    const svc = makeService();
    const v = svc.createVariant({
      name: 'Heavy A',
      subject: 's',
      body: 'b',
      stage: 'warn',
      weight: 70,
    });
    expect(v.weight).toBe(70);
  });

  it('updates a variant', () => {
    const svc = makeService();
    const v = svc.createVariant({ name: 'Old', subject: 's', body: 'b', stage: 'retry' });
    const updated = svc.updateVariant(v.id, { name: 'New', weight: 30 });
    expect(updated.name).toBe('New');
    expect(updated.weight).toBe(30);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(v.createdAt);
  });

  it('throws when updating a non-existent variant', () => {
    const svc = makeService();
    expect(() => svc.updateVariant('ghost_id', { name: 'X' })).toThrow();
  });

  it('lists variants filtered by stage', () => {
    const svc = makeService();
    svc.createVariant({ name: 'R1', subject: 's', body: 'b', stage: 'retry' });
    svc.createVariant({ name: 'W1', subject: 's', body: 'b', stage: 'warn' });
    svc.createVariant({ name: 'R2', subject: 's', body: 'b', stage: 'retry' });

    const retryVariants = svc.listVariants('retry');
    expect(retryVariants).toHaveLength(2);
    retryVariants.forEach((v) => expect(v.stage).toBe('retry'));
  });

  it('returns only active variants for a stage', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc, 'warn');
    svc.updateVariant(b.id, { isActive: false });

    const active = svc.getActiveVariantsForStage('warn');
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(a.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A/B Test Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('DunningEmailSequenceService – A/B test lifecycle', () => {
  it('creates a test in draft status', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc);
    const test = svc.createABTest({
      name: 'Subject line test',
      stage: 'retry',
      variantIds: [a.id, b.id],
    });

    expect(test.id).toBeTruthy();
    expect(test.status).toBe('draft');
    expect(test.variants).toHaveLength(2);
    expect(test.winningVariantId).toBeUndefined();
  });

  it('throws when creating A/B test with fewer than 2 variants', () => {
    const svc = makeService();
    const { a } = addTwoVariants(svc);
    expect(() =>
      svc.createABTest({ name: 'Bad test', stage: 'retry', variantIds: [a.id] }),
    ).toThrow();
  });

  it('transitions draft → running on startABTest', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc);
    const test = svc.createABTest({ name: 'T1', stage: 'retry', variantIds: [a.id, b.id] });
    const running = svc.startABTest(test.id);

    expect(running.status).toBe('running');
    expect(running.startedAt).toBeDefined();
  });

  it('transitions running → paused on pauseABTest', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc);
    const test = svc.createABTest({ name: 'T2', stage: 'retry', variantIds: [a.id, b.id] });
    svc.startABTest(test.id);
    const paused = svc.pauseABTest(test.id);
    expect(paused.status).toBe('paused');
  });

  it('can resume a paused test', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc);
    const test = svc.createABTest({ name: 'T3', stage: 'retry', variantIds: [a.id, b.id] });
    svc.startABTest(test.id);
    svc.pauseABTest(test.id);
    const resumed = svc.startABTest(test.id);
    expect(resumed.status).toBe('running');
  });

  it('completes a test and picks the winning variant by recovery rate', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc);
    const test = svc.createABTest({ name: 'T4', stage: 'retry', variantIds: [a.id, b.id] });
    svc.startABTest(test.id);

    // Log deliveries: variant A gets more opens → higher recovery rate
    for (let i = 0; i < 5; i++) {
      const log = svc.logDelivery({
        subscriberId: `sub_a_${i}`,
        subscriptionId: `subs_a_${i}`,
        variantId: a.id,
        stage: 'retry',
        testId: test.id,
        status: 'delivered',
      });
      svc.updateDeliveryStatus(log.id, 'opened', { openedAt: Date.now() });
    }
    for (let i = 0; i < 2; i++) {
      svc.logDelivery({
        subscriberId: `sub_b_${i}`,
        subscriptionId: `subs_b_${i}`,
        variantId: b.id,
        stage: 'retry',
        testId: test.id,
        status: 'delivered',
      });
    }

    const completed = svc.completeABTest(test.id);
    expect(completed.status).toBe('completed');
    expect(completed.winningVariantId).toBe(a.id);
    expect(completed.completedAt).toBeDefined();
  });

  it('accepts an explicit winning variant override', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc);
    const test = svc.createABTest({ name: 'T5', stage: 'retry', variantIds: [a.id, b.id] });
    svc.startABTest(test.id);
    const completed = svc.completeABTest(test.id, b.id);
    expect(completed.winningVariantId).toBe(b.id);
  });

  it('cannot start a completed test', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc);
    const test = svc.createABTest({ name: 'T6', stage: 'retry', variantIds: [a.id, b.id] });
    svc.startABTest(test.id);
    svc.completeABTest(test.id, a.id);
    expect(() => svc.startABTest(test.id)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Variant Assignment
// ─────────────────────────────────────────────────────────────────────────────

describe('DunningEmailSequenceService – variant assignment', () => {
  it('assigns a variant to a subscriber from a running test', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc);
    const test = svc.createABTest({ name: 'Assign test', stage: 'retry', variantIds: [a.id, b.id] });
    svc.startABTest(test.id);

    const variant = svc.assignVariant(test.id, 'subscriber_001');
    expect([a.id, b.id]).toContain(variant.id);
  });

  it('returns the same variant for the same subscriber (sticky assignment)', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc);
    const test = svc.createABTest({ name: 'Sticky test', stage: 'retry', variantIds: [a.id, b.id] });
    svc.startABTest(test.id);

    const first = svc.assignVariant(test.id, 'sticky_sub');
    const second = svc.assignVariant(test.id, 'sticky_sub');
    expect(first.id).toBe(second.id);
  });

  it('throws when assigning from a non-running test', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc);
    const test = svc.createABTest({ name: 'Draft test', stage: 'retry', variantIds: [a.id, b.id] });
    // Still in draft
    expect(() => svc.assignVariant(test.id, 'sub_x')).toThrow();
  });

  it('distributes across many subscribers roughly according to weights', () => {
    const svc = makeService();
    const a = svc.createVariant({ name: 'A', subject: 's', body: 'b', stage: 'retry', weight: 70 });
    const b = svc.createVariant({ name: 'B', subject: 's', body: 'b', stage: 'retry', weight: 30 });
    const test = svc.createABTest({ name: 'Weight test', stage: 'retry', variantIds: [a.id, b.id] });
    svc.startABTest(test.id);

    const counts: Record<string, number> = { [a.id]: 0, [b.id]: 0 };
    for (let i = 0; i < 1000; i++) {
      const assigned = svc.assignVariant(test.id, `unique_sub_${i}`);
      counts[assigned.id] = (counts[assigned.id] ?? 0) + 1;
    }

    // With 70/30 split over 1000 we expect A to be between 60-80%
    const aShare = counts[a.id] / 1000;
    expect(aShare).toBeGreaterThan(0.58);
    expect(aShare).toBeLessThan(0.82);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delivery Logging & Analytics
// ─────────────────────────────────────────────────────────────────────────────

describe('DunningEmailSequenceService – delivery logging and analytics', () => {
  it('logs a delivery and retrieves it', () => {
    const svc = makeService();
    const { a } = addTwoVariants(svc);
    const entry = svc.logDelivery({
      subscriberId: 'sub_1',
      subscriptionId: 'subs_1',
      variantId: a.id,
      stage: 'retry',
      status: 'delivered',
    });

    const logs = svc.getDeliveryLogs({ subscriberId: 'sub_1' });
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBe(entry.id);
    expect(logs[0].status).toBe('delivered');
  });

  it('updates delivery status to opened', () => {
    const svc = makeService();
    const { a } = addTwoVariants(svc);
    const entry = svc.logDelivery({
      subscriberId: 'sub_2',
      subscriptionId: 'subs_2',
      variantId: a.id,
      stage: 'warn',
      status: 'delivered',
    });

    svc.updateDeliveryStatus(entry.id, 'opened', { openedAt: Date.now() });
    const logs = svc.getDeliveryLogs({ subscriberId: 'sub_2' });
    expect(logs[0].status).toBe('opened');
    expect(logs[0].openedAt).toBeDefined();
  });

  it('computes correct A/B test results (opens, clicks, recovery rates)', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc);
    const test = svc.createABTest({ name: 'Results test', stage: 'retry', variantIds: [a.id, b.id] });
    svc.startABTest(test.id);

    // 4 sends for A, 2 opened
    for (let i = 0; i < 4; i++) {
      const log = svc.logDelivery({ subscriberId: `sa_${i}`, subscriptionId: `ss_${i}`, variantId: a.id, stage: 'retry', testId: test.id, status: 'delivered' });
      if (i < 2) svc.updateDeliveryStatus(log.id, 'opened', { openedAt: Date.now() });
    }
    // 4 sends for B, 3 opened
    for (let i = 0; i < 4; i++) {
      const log = svc.logDelivery({ subscriberId: `sb_${i}`, subscriptionId: `sb_${i}`, variantId: b.id, stage: 'retry', testId: test.id, status: 'delivered' });
      if (i < 3) svc.updateDeliveryStatus(log.id, 'opened', { openedAt: Date.now() });
    }

    const results = svc.getABTestResults(test.id);
    const aResult = results.find((r) => r.variantId === a.id)!;
    const bResult = results.find((r) => r.variantId === b.id)!;

    expect(aResult.sends).toBe(4);
    expect(aResult.opens).toBe(2);
    expect(aResult.openRate).toBeCloseTo(0.5, 2);

    expect(bResult.sends).toBe(4);
    expect(bResult.opens).toBe(3);
    expect(bResult.openRate).toBeCloseTo(0.75, 2);
  });

  it('filters delivery logs by stage', () => {
    const svc = makeService();
    const { a } = addTwoVariants(svc, 'retry');
    const { b } = addTwoVariants(svc, 'warn');

    svc.logDelivery({ subscriberId: 's1', subscriptionId: 'ss1', variantId: a.id, stage: 'retry', status: 'delivered' });
    svc.logDelivery({ subscriberId: 's2', subscriptionId: 'ss2', variantId: b.id, stage: 'warn', status: 'delivered' });
    svc.logDelivery({ subscriberId: 's3', subscriptionId: 'ss3', variantId: a.id, stage: 'retry', status: 'delivered' });

    const retryLogs = svc.getDeliveryLogs({ stage: 'retry' });
    expect(retryLogs).toHaveLength(2);
  });

  it('respects the limit filter on getDeliveryLogs', () => {
    const svc = makeService();
    const { a } = addTwoVariants(svc);
    for (let i = 0; i < 10; i++) {
      svc.logDelivery({ subscriberId: `s${i}`, subscriptionId: `ss${i}`, variantId: a.id, stage: 'retry', status: 'delivered' });
    }
    const limited = svc.getDeliveryLogs({ limit: 3 });
    expect(limited).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deliverability Metrics
// ─────────────────────────────────────────────────────────────────────────────

describe('DunningEmailSequenceService – deliverability metrics', () => {
  it('returns zero metrics when no logs exist', () => {
    const svc = makeService();
    const metrics = svc.getDeliverabilityMetrics();
    expect(metrics.totalSent).toBe(0);
    expect(metrics.deliveryRate).toBe(0);
    expect(metrics.bounceRate).toBe(0);
  });

  it('calculates delivery and bounce rates correctly', () => {
    const svc = makeService();
    const { a, b } = addTwoVariants(svc);

    // 8 delivered, 2 bounced → delivery rate 0.8, bounce rate 0.2
    for (let i = 0; i < 8; i++) {
      svc.logDelivery({ subscriberId: `sd_${i}`, subscriptionId: `ss_${i}`, variantId: a.id, stage: 'retry', status: 'delivered' });
    }
    for (let i = 0; i < 2; i++) {
      svc.logDelivery({ subscriberId: `sb_${i}`, subscriptionId: `ssb_${i}`, variantId: b.id, stage: 'retry', status: 'bounced' });
    }

    const metrics = svc.getDeliverabilityMetrics();
    expect(metrics.totalSent).toBe(10);
    expect(metrics.bounceRate).toBeCloseTo(0.2, 2);
    expect(metrics.deliveryRate).toBeGreaterThanOrEqual(0.5);
  });

  it('groups metrics by stage', () => {
    const svc = makeService();
    const { a } = addTwoVariants(svc, 'retry');
    const { b } = addTwoVariants(svc, 'cancel');

    svc.logDelivery({ subscriberId: 'r1', subscriptionId: 'sr1', variantId: a.id, stage: 'retry', status: 'delivered' });
    svc.logDelivery({ subscriberId: 'c1', subscriptionId: 'sc1', variantId: b.id, stage: 'cancel', status: 'delivered' });

    const metrics = svc.getDeliverabilityMetrics();
    expect(metrics.byStage['retry'].sent).toBe(1);
    expect(metrics.byStage['cancel'].sent).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sequence Management
// ─────────────────────────────────────────────────────────────────────────────

describe('DunningEmailSequenceService – sequence management', () => {
  it('creates a sequence', () => {
    const svc = makeService();
    const { a } = addTwoVariants(svc, 'retry');
    const seq = svc.createSequence({
      name: 'Standard dunning',
      stages: [
        { stage: 'retry', delayDays: 1, emailTemplateId: 'tpl_retry', maxAttempts: 3 },
        { stage: 'warn', delayDays: 3, emailTemplateId: 'tpl_warn', maxAttempts: 2 },
      ],
      fallbackVariantIds: {
        retry: a.id,
        warn: a.id,
        suspend: a.id,
        cancel: a.id,
      },
    });

    expect(seq.id).toBeTruthy();
    expect(seq.name).toBe('Standard dunning');
    expect(seq.isActive).toBe(true);
    expect(seq.stages).toHaveLength(2);
  });

  it('can find the active sequence for a given stage', () => {
    const svc = makeService();
    const { a } = addTwoVariants(svc, 'retry');
    svc.createSequence({
      name: 'Active seq',
      stages: [{ stage: 'retry', delayDays: 1, emailTemplateId: 'tpl', maxAttempts: 3 }],
      fallbackVariantIds: { retry: a.id, warn: a.id, suspend: a.id, cancel: a.id },
    });

    const found = svc.getActiveSequenceForStage('retry');
    expect(found).toBeDefined();
    expect(found?.name).toBe('Active seq');
  });

  it('deactivates a sequence and cannot find it for stage lookup', () => {
    const svc = makeService();
    const { a } = addTwoVariants(svc, 'retry');
    const seq = svc.createSequence({
      name: 'Soon inactive',
      stages: [{ stage: 'retry', delayDays: 1, emailTemplateId: 'tpl', maxAttempts: 3 }],
      fallbackVariantIds: { retry: a.id, warn: a.id, suspend: a.id, cancel: a.id },
    });

    svc.updateSequence(seq.id, { isActive: false });
    const found = svc.getActiveSequenceForStage('retry');
    expect(found).toBeUndefined();
  });

  it('deletes a sequence', () => {
    const svc = makeService();
    const { a } = addTwoVariants(svc);
    const seq = svc.createSequence({
      name: 'To delete',
      stages: [{ stage: 'retry', delayDays: 1, emailTemplateId: 'tpl', maxAttempts: 3 }],
      fallbackVariantIds: { retry: a.id, warn: a.id, suspend: a.id, cancel: a.id },
    });

    svc.deleteSequence(seq.id);
    expect(svc.getSequence(seq.id)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Send-time optimisation
// ─────────────────────────────────────────────────────────────────────────────

describe('DunningEmailSequenceService – send-time optimisation', () => {
  it('returns the default hour when not enough data', () => {
    const svc = makeService();
    const result = svc.getOptimalSendTime('retry');
    expect(result.hour).toBe(10);
    expect(result.reason).toContain('Default');
  });

  it('returns a data-driven hour when sufficient opens exist', () => {
    const svc = makeService();
    const { a } = addTwoVariants(svc);

    // Log 15 opens all at hour 14
    const fixedTs = new Date();
    fixedTs.setHours(14, 0, 0, 0);

    for (let i = 0; i < 15; i++) {
      const log = svc.logDelivery({
        subscriberId: `sub_h_${i}`,
        subscriptionId: `ss_h_${i}`,
        variantId: a.id,
        stage: 'retry',
        status: 'delivered',
      });
      svc.updateDeliveryStatus(log.id, 'opened', { openedAt: fixedTs.getTime() });
    }

    const result = svc.getOptimalSendTime('retry');
    expect(result.hour).toBe(14);
    expect(result.reason).toContain('Data-driven');
  });
});
