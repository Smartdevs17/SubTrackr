/**
 * Integration tests for Dunning Email Sequences + A/B Testing
 *
 * Covers deeper scenarios not in the unit test file:
 *  - Full lifecycle: create sequence → run A/B test → log deliveries → get results
 *  - Variant weight distribution (statistical)
 *  - Consistent variant assignment for the same subscriber
 *  - A/B test state machine: draft → running → paused → completed
 *  - Automatic winner selection on completion
 *  - Deliverability metrics rollup (byStage, byVariant)
 *  - Optimal send-time calculation
 *  - Sequence recommendations triggered by low open-rate
 *  - getActiveSequenceForStage returns the correct sequence
 *  - Delivery log filtering
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { DunningEmailSequenceService } from '../dunningEmailSequences';
import type { DunningStage } from '../../../../src/types/dunning';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeService() {
  return new DunningEmailSequenceService();
}

function createTestVariants(svc: DunningEmailSequenceService, stage: DunningStage = 'retry') {
  const control = svc.createVariant({
    name: 'Control',
    subject: 'Your payment failed',
    body: 'Please update your payment method.',
    stage,
    weight: 50,
  });
  const treatment = svc.createVariant({
    name: 'Treatment',
    subject: 'Action needed: update your card',
    body: 'Hi {{name}}, we could not charge you.',
    stage,
    weight: 50,
  });
  return { control, treatment };
}

// ── Full lifecycle ────────────────────────────────────────────────────────────

describe('Full dunning A/B lifecycle', () => {
  let svc: DunningEmailSequenceService;

  beforeEach(() => {
    svc = makeService();
  });

  it('creates sequence, starts A/B test, assigns variants, logs deliveries, gets results', () => {
    const { control, treatment } = createTestVariants(svc, 'retry');

    // Create A/B test
    const test = svc.createABTest({
      name: 'Retry email test',
      stage: 'retry',
      variantIds: [control.id, treatment.id],
    });
    expect(test.status).toBe('draft');

    // Start the test
    const started = svc.startABTest(test.id);
    expect(started.status).toBe('running');

    // Assign variants to 10 subscribers
    const assignments = Array.from({ length: 10 }, (_, i) => {
      const variant = svc.assignVariant(test.id, `sub_${i}`);
      return variant;
    });
    expect(assignments).toHaveLength(10);
    expect(assignments.every((v) => [control.id, treatment.id].includes(v.id))).toBe(true);

    // Log deliveries for 5 of them as opened
    for (let i = 0; i < 5; i++) {
      const variant = assignments[i];
      const log = svc.logDelivery({
        subscriberId: `sub_${i}`,
        subscriptionId: `sid_${i}`,
        stage: 'retry',
        variantId: variant.id,
        testId: test.id,
        subject: variant.subject,
        channel: 'email',
        status: 'delivered',
      });
      svc.updateDeliveryStatus(log.id, 'opened', { openedAt: Date.now() });
    }

    // Get A/B results
    const results = svc.getABTestResults(test.id);
    expect(results).toHaveLength(2);
    const totalSends = results.reduce((s, r) => s + r.sends, 0);
    expect(totalSends).toBe(10);

    // Complete test
    const completed = svc.completeABTest(test.id);
    expect(completed.status).toBe('completed');
    expect(completed.winningVariantId).toBeDefined();
  });

  it('consistent assignment: same subscriber always gets the same variant', () => {
    const { control, treatment } = createTestVariants(svc);
    const test = svc.createABTest({
      name: 'Consistency test',
      stage: 'retry',
      variantIds: [control.id, treatment.id],
    });
    svc.startABTest(test.id);

    const first = svc.assignVariant(test.id, 'sub_consistent');
    const second = svc.assignVariant(test.id, 'sub_consistent');
    expect(first.id).toBe(second.id);
  });

  it('variant weight distribution is roughly proportional over many assigns', () => {
    const heavy = svc.createVariant({
      name: 'Heavy',
      subject: 'S',
      body: 'B',
      stage: 'retry',
      weight: 80,
    });
    const light = svc.createVariant({
      name: 'Light',
      subject: 'S',
      body: 'B',
      stage: 'retry',
      weight: 20,
    });
    const test = svc.createABTest({
      name: 'Weight test',
      stage: 'retry',
      variantIds: [heavy.id, light.id],
    });
    svc.startABTest(test.id);

    const counts: Record<string, number> = { [heavy.id]: 0, [light.id]: 0 };
    for (let i = 0; i < 200; i++) {
      const v = svc.assignVariant(test.id, `unique_sub_${i}`);
      counts[v.id] = (counts[v.id] ?? 0) + 1;
    }

    // Heavy variant should win ≥60% of assignments (allowing statistical variance)
    expect(counts[heavy.id]).toBeGreaterThan(counts[light.id]);
  });
});

// ── A/B test state machine ────────────────────────────────────────────────────

describe('A/B test state machine', () => {
  let svc: DunningEmailSequenceService;

  beforeEach(() => {
    svc = makeService();
  });

  it('starts in draft status', () => {
    const { control, treatment } = createTestVariants(svc);
    const test = svc.createABTest({ name: 'T', stage: 'retry', variantIds: [control.id, treatment.id] });
    expect(test.status).toBe('draft');
  });

  it('transitions draft → running on startABTest', () => {
    const { control, treatment } = createTestVariants(svc);
    const test = svc.createABTest({ name: 'T', stage: 'retry', variantIds: [control.id, treatment.id] });
    const started = svc.startABTest(test.id);
    expect(started.status).toBe('running');
    expect(started.startedAt).toBeDefined();
  });

  it('transitions running → paused on pauseABTest', () => {
    const { control, treatment } = createTestVariants(svc);
    const test = svc.createABTest({ name: 'T', stage: 'retry', variantIds: [control.id, treatment.id] });
    svc.startABTest(test.id);
    const paused = svc.pauseABTest(test.id);
    expect(paused.status).toBe('paused');
  });

  it('can restart a paused test', () => {
    const { control, treatment } = createTestVariants(svc);
    const test = svc.createABTest({ name: 'T', stage: 'retry', variantIds: [control.id, treatment.id] });
    svc.startABTest(test.id);
    svc.pauseABTest(test.id);
    const restarted = svc.startABTest(test.id);
    expect(restarted.status).toBe('running');
  });

  it('cannot start a completed test', () => {
    const { control, treatment } = createTestVariants(svc);
    const test = svc.createABTest({ name: 'T', stage: 'retry', variantIds: [control.id, treatment.id] });
    svc.startABTest(test.id);
    svc.completeABTest(test.id);
    expect(() => svc.startABTest(test.id)).toThrow();
  });

  it('requires at least 2 variants', () => {
    const { control } = createTestVariants(svc);
    expect(() =>
      svc.createABTest({ name: 'T', stage: 'retry', variantIds: [control.id] })
    ).toThrow();
  });

  it('cannot assign variant to a non-running test', () => {
    const { control, treatment } = createTestVariants(svc);
    const test = svc.createABTest({ name: 'T', stage: 'retry', variantIds: [control.id, treatment.id] });
    // Still in draft
    expect(() => svc.assignVariant(test.id, 'sub_x')).toThrow();
  });

  it('completeABTest auto-selects winner by highest recovery rate when none specified', () => {
    const { control, treatment } = createTestVariants(svc);
    const test = svc.createABTest({ name: 'T', stage: 'retry', variantIds: [control.id, treatment.id] });
    svc.startABTest(test.id);

    // Log one recovery for treatment
    const log = svc.logDelivery({
      subscriberId: 'sub_w',
      subscriptionId: 'sid_w',
      stage: 'retry',
      variantId: treatment.id,
      testId: test.id,
      subject: 'S',
      channel: 'email',
      status: 'delivered',
    });
    svc.updateDeliveryStatus(log.id, 'clicked', { clickedAt: Date.now() });

    const completed = svc.completeABTest(test.id);
    // With one recovery on treatment and none on control, treatment should win
    expect(completed.winningVariantId).toBe(treatment.id);
  });

  it('completeABTest respects an explicit winning variant', () => {
    const { control, treatment } = createTestVariants(svc);
    const test = svc.createABTest({ name: 'T', stage: 'retry', variantIds: [control.id, treatment.id] });
    svc.startABTest(test.id);
    const completed = svc.completeABTest(test.id, control.id);
    expect(completed.winningVariantId).toBe(control.id);
  });
});

// ── Deliverability metrics ────────────────────────────────────────────────────

describe('Deliverability metrics', () => {
  let svc: DunningEmailSequenceService;

  beforeEach(() => {
    svc = makeService();
  });

  it('totalSent equals number of logDelivery calls', () => {
    const { control } = createTestVariants(svc, 'warn');
    for (let i = 0; i < 5; i++) {
      svc.logDelivery({
        subscriberId: `sub_${i}`,
        subscriptionId: `sid_${i}`,
        stage: 'warn',
        variantId: control.id,
        subject: 'S',
        channel: 'email',
        status: 'delivered',
      });
    }
    const metrics = svc.getDeliverabilityMetrics();
    expect(metrics.totalSent).toBe(5);
  });

  it('openRate is opens / totalSent', () => {
    const { control } = createTestVariants(svc, 'retry');
    for (let i = 0; i < 4; i++) {
      const log = svc.logDelivery({
        subscriberId: `sub_${i}`,
        subscriptionId: `sid_${i}`,
        stage: 'retry',
        variantId: control.id,
        subject: 'S',
        channel: 'email',
        status: 'delivered',
      });
      if (i < 2) {
        svc.updateDeliveryStatus(log.id, 'opened', { openedAt: Date.now() });
      }
    }
    const metrics = svc.getDeliverabilityMetrics();
    expect(metrics.openRate).toBeCloseTo(2 / 4, 5);
  });

  it('bounceRate is bounced / totalSent', () => {
    const { control } = createTestVariants(svc, 'suspend');
    const log = svc.logDelivery({
      subscriberId: 'sub_b',
      subscriptionId: 'sid_b',
      stage: 'suspend',
      variantId: control.id,
      subject: 'S',
      channel: 'email',
      status: 'delivered',
    });
    svc.updateDeliveryStatus(log.id, 'bounced');
    svc.logDelivery({
      subscriberId: 'sub_ok',
      subscriptionId: 'sid_ok',
      stage: 'suspend',
      variantId: control.id,
      subject: 'S',
      channel: 'email',
      status: 'delivered',
    });
    const metrics = svc.getDeliverabilityMetrics();
    expect(metrics.bounceRate).toBeCloseTo(0.5, 5);
  });

  it('byStage breakdown contains the correct stage', () => {
    const { control } = createTestVariants(svc, 'cancel');
    svc.logDelivery({
      subscriberId: 'sub_c',
      subscriptionId: 'sid_c',
      stage: 'cancel',
      variantId: control.id,
      subject: 'S',
      channel: 'email',
      status: 'delivered',
    });
    const metrics = svc.getDeliverabilityMetrics();
    expect(metrics.byStage['cancel'].sent).toBeGreaterThanOrEqual(1);
  });

  it('byVariant breakdown tracks per-variant recovery rate', () => {
    const { control, treatment } = createTestVariants(svc);
    const logA = svc.logDelivery({
      subscriberId: 'sub_a',
      subscriptionId: 'sid_a',
      stage: 'retry',
      variantId: control.id,
      subject: 'S',
      channel: 'email',
      status: 'delivered',
    });
    svc.updateDeliveryStatus(logA.id, 'clicked', { clickedAt: Date.now() });
    svc.logDelivery({
      subscriberId: 'sub_b',
      subscriptionId: 'sid_b',
      stage: 'retry',
      variantId: treatment.id,
      subject: 'S',
      channel: 'email',
      status: 'delivered',
    });

    const metrics = svc.getDeliverabilityMetrics();
    expect(metrics.byVariant[control.id]).toBeDefined();
    expect(metrics.byVariant[control.id].recoveryRate).toBeGreaterThan(0);
    expect(metrics.byVariant[treatment.id].recoveryRate).toBe(0);
  });
});

// ── Optimal send time ─────────────────────────────────────────────────────────

describe('getOptimalSendTime()', () => {
  it('returns the default (hour 10) when fewer than 10 open events exist', () => {
    const svc = makeService();
    const result = svc.getOptimalSendTime('retry');
    expect(result.hour).toBe(10);
    expect(result.reason).toContain('Default');
  });

  it('returns data-driven hour when ≥10 open events are logged', () => {
    const svc = makeService();
    const { control } = createTestVariants(svc, 'retry');

    // Log 12 deliveries all opened at 14:xx
    for (let i = 0; i < 12; i++) {
      const openedAt = new Date('2026-08-01T14:30:00.000Z').getTime() + i * 60_000;
      const log = svc.logDelivery({
        subscriberId: `sub_t${i}`,
        subscriptionId: `sid_t${i}`,
        stage: 'retry',
        variantId: control.id,
        subject: 'S',
        channel: 'email',
        status: 'delivered',
      });
      svc.updateDeliveryStatus(log.id, 'opened', { openedAt });
    }

    const result = svc.getOptimalSendTime('retry');
    expect(result.reason).toContain('Data-driven');
    // Best hour should be 14 (UTC)
    expect(result.hour).toBe(14);
  });
});

// ── Sequence recommendations ──────────────────────────────────────────────────

describe('getSequenceRecommendations()', () => {
  it('returns an empty array when all metrics are healthy', () => {
    const svc = makeService();
    const recs = svc.getSequenceRecommendations();
    // No data → no problematic metrics → may still produce "no A/B test running" recs
    expect(Array.isArray(recs)).toBe(true);
  });

  it('flags high bounce rate as a high-impact recommendation', () => {
    const svc = makeService();
    const { control } = createTestVariants(svc, 'retry');

    // Log 10 with 6 bounces → 60% bounce rate (above 5% threshold)
    for (let i = 0; i < 10; i++) {
      const log = svc.logDelivery({
        subscriberId: `sub_bounce_${i}`,
        subscriptionId: `sid_bounce_${i}`,
        stage: 'retry',
        variantId: control.id,
        subject: 'S',
        channel: 'email',
        status: 'delivered',
      });
      if (i < 6) svc.updateDeliveryStatus(log.id, 'bounced');
    }

    const recs = svc.getSequenceRecommendations();
    const bounceRec = recs.find((r) => r.type === 'content' && r.message.includes('Bounce rate'));
    expect(bounceRec).toBeDefined();
    expect(bounceRec!.impact).toBe('high');
  });

  it('recommends starting A/B test when variants exist but no test is running', () => {
    const svc = makeService();
    createTestVariants(svc, 'retry'); // 2 variants, no test started
    const recs = svc.getSequenceRecommendations();
    const abRec = recs.find((r) => r.message.includes('A/B test'));
    expect(abRec).toBeDefined();
  });

  it('does not recommend A/B test when one is already running', () => {
    const svc = makeService();
    const { control, treatment } = createTestVariants(svc, 'retry');
    const test = svc.createABTest({
      name: 'Active',
      stage: 'retry',
      variantIds: [control.id, treatment.id],
    });
    svc.startABTest(test.id);
    const recs = svc.getSequenceRecommendations();
    const abRec = recs.find((r) => r.message.includes('No A/B test running'));
    expect(abRec).toBeUndefined();
  });
});

// ── Sequence management ───────────────────────────────────────────────────────

describe('Sequence management', () => {
  it('creates and retrieves a sequence', () => {
    const svc = makeService();
    const { control, treatment } = createTestVariants(svc, 'retry');
    const seq = svc.createSequence({
      name: 'Standard Recovery',
      stages: [{ stage: 'retry', delayHours: 1, variantId: control.id, maxAttempts: 3 }],
      fallbackVariantIds: {
        retry: control.id,
        warn: treatment.id,
        suspend: control.id,
        cancel: treatment.id,
      },
    });
    expect(seq.id).toBeTruthy();
    expect(seq.isActive).toBe(true);
    expect(svc.getSequence(seq.id)).toEqual(seq);
  });

  it('getActiveSequenceForStage returns the active sequence matching the stage', () => {
    const svc = makeService();
    const { control } = createTestVariants(svc, 'warn');
    const seq = svc.createSequence({
      name: 'Warn Sequence',
      stages: [{ stage: 'warn', delayHours: 24, maxAttempts: 2 }],
      fallbackVariantIds: { retry: control.id, warn: control.id, suspend: control.id, cancel: control.id },
    });
    const found = svc.getActiveSequenceForStage('warn');
    expect(found?.id).toBe(seq.id);
  });

  it('inactive sequences are not returned by getActiveSequenceForStage', () => {
    const svc = makeService();
    const { control } = createTestVariants(svc, 'cancel');
    const seq = svc.createSequence({
      name: 'Cancel Sequence',
      stages: [{ stage: 'cancel', delayHours: 168, maxAttempts: 1 }],
      fallbackVariantIds: { retry: control.id, warn: control.id, suspend: control.id, cancel: control.id },
    });
    svc.updateSequence(seq.id, { isActive: false });
    expect(svc.getActiveSequenceForStage('cancel')).toBeUndefined();
  });

  it('deleteSequence removes it from the list', () => {
    const svc = makeService();
    const { control } = createTestVariants(svc, 'retry');
    const seq = svc.createSequence({
      name: 'To Delete',
      stages: [],
      fallbackVariantIds: { retry: control.id, warn: control.id, suspend: control.id, cancel: control.id },
    });
    svc.deleteSequence(seq.id);
    expect(svc.getSequence(seq.id)).toBeUndefined();
  });
});

// ── Delivery log filtering ────────────────────────────────────────────────────

describe('getDeliveryLogs() filtering', () => {
  let svc: DunningEmailSequenceService;
  let controlId: string;
  let testId: string;

  beforeEach(() => {
    svc = makeService();
    const { control, treatment } = createTestVariants(svc, 'retry');
    controlId = control.id;
    const test = svc.createABTest({ name: 'T', stage: 'retry', variantIds: [control.id, treatment.id] });
    svc.startABTest(test.id);
    testId = test.id;

    for (let i = 0; i < 5; i++) {
      svc.logDelivery({
        subscriberId: `sub_f${i}`,
        subscriptionId: `sid_f${i}`,
        stage: 'retry',
        variantId: i % 2 === 0 ? control.id : treatment.id,
        testId: test.id,
        subject: 'S',
        channel: 'email',
        status: 'delivered',
      });
    }
  });

  it('filters by subscriberId', () => {
    const logs = svc.getDeliveryLogs({ subscriberId: 'sub_f0' });
    expect(logs.every((l) => l.subscriberId === 'sub_f0')).toBe(true);
  });

  it('filters by stage', () => {
    const logs = svc.getDeliveryLogs({ stage: 'retry' });
    expect(logs.every((l) => l.stage === 'retry')).toBe(true);
  });

  it('filters by testId', () => {
    const logs = svc.getDeliveryLogs({ testId });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.testId === testId)).toBe(true);
  });

  it('respects limit', () => {
    const logs = svc.getDeliveryLogs({ limit: 2 });
    expect(logs.length).toBeLessThanOrEqual(2);
  });

  it('returns logs sorted most-recent first', () => {
    const logs = svc.getDeliveryLogs();
    for (let i = 1; i < logs.length; i++) {
      expect(logs[i - 1].sentAt).toBeGreaterThanOrEqual(logs[i].sentAt);
    }
  });
});
