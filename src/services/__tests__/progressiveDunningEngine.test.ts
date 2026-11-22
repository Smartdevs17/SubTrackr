/**
 * Unit tests for ProgressiveDunningEngine — Issue #775
 *
 * Covers:
 *  - Rule matching (attempts / hours / recovery probability)
 *  - Progressive-only forward escalation
 *  - Batch processDueEscalations
 *  - Analytics (funnel, time-in-stage, paths)
 *  - optimizePolicy suggestions
 *  - Template rendering
 */

import { ProgressiveDunningEngine } from '../progressiveDunningEngine';
import type { DunningEntry } from '../../types/dunning';
import type { EscalationPolicy, EscalationRule } from '../../types/dunningEscalation';
import {
  createDefaultEscalationPolicy,
  isForwardEscalation,
  STAGE_ORDER,
} from '../../types/dunningEscalation';

const ONE_HOUR_MS = 3_600_000;

function makeEntry(overrides: Partial<DunningEntry> = {}): DunningEntry {
  const ts = overrides.createdAt ?? Date.now();
  return {
    id: 'dun_test',
    subscriptionId: 'sub_1',
    subscriberId: 'user_1',
    merchantId: 'merch_1',
    planId: 'default',
    currentStage: 'retry',
    failedAttempts: 0,
    totalFailedCharges: 0,
    firstFailureAt: ts,
    lastFailureAt: ts,
    lastAttemptAt: ts,
    nextActionAt: ts + ONE_HOUR_MS,
    isPaused: false,
    communicationLog: [],
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function makeEngine(policy?: EscalationPolicy): ProgressiveDunningEngine {
  const engine = new ProgressiveDunningEngine(false);
  engine.configurePolicy(policy ?? createDefaultEscalationPolicy('default'));
  return engine;
}

describe('isForwardEscalation / STAGE_ORDER', () => {
  it('orders stages progressively', () => {
    expect(STAGE_ORDER).toEqual(['retry', 'warn', 'suspend', 'cancel']);
  });

  it('allows only forward moves', () => {
    expect(isForwardEscalation('retry', 'warn')).toBe(true);
    expect(isForwardEscalation('warn', 'cancel')).toBe(true);
    expect(isForwardEscalation('warn', 'retry')).toBe(false);
    expect(isForwardEscalation('suspend', 'suspend')).toBe(false);
  });
});

describe('createDefaultEscalationPolicy', () => {
  it('builds progressive rules matching default stages', () => {
    const policy = createDefaultEscalationPolicy('pro');
    expect(policy.planId).toBe('pro');
    expect(policy.enabled).toBe(true);
    expect(policy.rules).toHaveLength(3);
    expect(policy.rules.map((r) => `${r.fromStage}->${r.toStage}`)).toEqual([
      'retry->warn',
      'warn->suspend',
      'suspend->cancel',
    ]);
  });
});

describe('ProgressiveDunningEngine.configurePolicy', () => {
  it('drops non-progressive rules', () => {
    const engine = new ProgressiveDunningEngine(false);
    const policy = engine.configurePolicy({
      planId: 'x',
      enabled: true,
      maxEscalations: 3,
      rules: [
        {
          id: 'bad',
          fromStage: 'warn',
          toStage: 'retry',
          channels: ['email'],
          templateId: 'payment_retry',
          priority: 1,
        },
        {
          id: 'good',
          fromStage: 'retry',
          toStage: 'warn',
          afterFailedAttempts: 1,
          channels: ['email'],
          templateId: 'payment_warning',
          priority: 10,
        },
      ],
    });
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0].id).toBe('good');
  });
});

describe('evaluateEscalation / rule matching', () => {
  it('returns null when thresholds are not met', () => {
    const engine = makeEngine();
    const entry = makeEntry({ failedAttempts: 0 });
    engine.trackStageEntry(entry);
    expect(engine.evaluateEscalation(entry)).toBeNull();
  });

  it('escalates retry → warn after failed attempts', () => {
    const engine = makeEngine();
    const entry = makeEntry({ failedAttempts: 3 });
    engine.trackStageEntry(entry);
    expect(engine.evaluateEscalation(entry)).toBe('warn');
  });

  it('escalates after hours in stage', () => {
    const engine = makeEngine();
    const started = Date.now() - 10 * ONE_HOUR_MS;
    const entry = makeEntry({
      failedAttempts: 0,
      createdAt: started,
      updatedAt: started,
    });
    engine.trackStageEntry(entry, started);
    // default retry→warn afterHours = 1 * 3 = 3
    expect(engine.evaluateEscalation(entry, started + 4 * ONE_HOUR_MS)).toBe('warn');
  });

  it('respects minRecoveryProbability', () => {
    const rule: EscalationRule = {
      id: 'gated',
      fromStage: 'retry',
      toStage: 'warn',
      afterFailedAttempts: 1,
      minRecoveryProbability: 0.7,
      channels: ['email'],
      templateId: 'payment_warning',
      priority: 50,
    };
    const engine = makeEngine({
      planId: 'default',
      enabled: true,
      maxEscalations: 3,
      rules: [rule],
    });
    const entry = makeEntry({ failedAttempts: 2 });
    engine.trackStageEntry(entry);
    engine.setRecoveryEstimate('sub_1', 0.4);
    expect(engine.evaluateEscalation(entry)).toBeNull();

    engine.setRecoveryEstimate('sub_1', 0.8);
    expect(engine.evaluateEscalation(entry)).toBe('warn');
  });

  it('picks higher priority rule when multiple match', () => {
    const engine = makeEngine({
      planId: 'default',
      enabled: true,
      maxEscalations: 3,
      rules: [
        {
          id: 'low',
          fromStage: 'retry',
          toStage: 'warn',
          afterFailedAttempts: 1,
          channels: ['email'],
          templateId: 'payment_warning',
          priority: 10,
        },
        {
          id: 'high',
          fromStage: 'retry',
          toStage: 'suspend',
          afterFailedAttempts: 1,
          channels: ['email', 'support'],
          templateId: 'service_suspension',
          priority: 99,
        },
      ],
    });
    const entry = makeEntry({ failedAttempts: 2 });
    expect(engine.findMatchingRule(entry)?.id).toBe('high');
    expect(engine.evaluateEscalation(entry)).toBe('suspend');
  });

  it('returns null when paused or policy disabled', () => {
    const engine = makeEngine();
    const paused = makeEntry({ failedAttempts: 5, isPaused: true });
    expect(engine.evaluateEscalation(paused)).toBeNull();

    engine.configurePolicy({
      ...createDefaultEscalationPolicy('default'),
      enabled: false,
    });
    expect(engine.evaluateEscalation(makeEntry({ failedAttempts: 5 }))).toBeNull();
  });
});

describe('applyEscalation progressive-only', () => {
  it('updates entry and emits EscalationEvent', () => {
    const engine = makeEngine();
    const entry = makeEntry({ failedAttempts: 3 });
    engine.trackStageEntry(entry);
    const rule = engine.findMatchingRule(entry)!;
    const { entry: updated, event } = engine.applyEscalation(entry, rule);

    expect(updated.currentStage).toBe('warn');
    expect(updated.failedAttempts).toBe(0);
    expect(event.fromStage).toBe('retry');
    expect(event.toStage).toBe('warn');
    expect(event.ruleId).toBe(rule.id);
    expect(engine.getEvents('sub_1')).toHaveLength(1);
  });

  it('throws on non-progressive apply', () => {
    const engine = makeEngine();
    const entry = makeEntry({ currentStage: 'warn' });
    const bad: EscalationRule = {
      id: 'back',
      fromStage: 'warn',
      toStage: 'retry',
      channels: ['email'],
      templateId: 'payment_retry',
      priority: 1,
    };
    expect(() => engine.applyEscalation(entry, bad)).toThrow(/Non-progressive/);
  });

  it('throws when fromStage mismatches entry', () => {
    const engine = makeEngine();
    const entry = makeEntry({ currentStage: 'retry' });
    const rule: EscalationRule = {
      id: 'mismatch',
      fromStage: 'warn',
      toStage: 'suspend',
      channels: ['email'],
      templateId: 'service_suspension',
      priority: 1,
    };
    expect(() => engine.applyEscalation(entry, rule)).toThrow(/does not match/);
  });

  it('respects maxEscalations', () => {
    const engine = makeEngine({
      planId: 'default',
      enabled: true,
      maxEscalations: 1,
      rules: createDefaultEscalationPolicy().rules,
    });
    let entry = makeEntry({ failedAttempts: 3 });
    engine.trackStageEntry(entry);
    const first = engine.applyEscalation(entry, engine.findMatchingRule(entry)!);
    entry = { ...first.entry, failedAttempts: 5 };
    expect(engine.evaluateEscalation(entry)).toBeNull();
  });
});

describe('processDueEscalations', () => {
  it('batch-processes matching entries and skips others', () => {
    const engine = makeEngine();
    const due = makeEntry({
      subscriptionId: 'sub_due',
      failedAttempts: 3,
    });
    const skip = makeEntry({
      subscriptionId: 'sub_skip',
      failedAttempts: 0,
    });
    engine.trackStageEntry(due);
    engine.trackStageEntry(skip);

    const result = engine.processDueEscalations([due, skip]);
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0].entry.subscriptionId).toBe('sub_due');
    expect(result.processed[0].entry.currentStage).toBe('warn');
    expect(result.skipped).toContain('sub_skip');
  });
});

describe('analytics & recovery', () => {
  it('tracks funnel, time-in-stage, and path recovery', () => {
    const engine = makeEngine();
    const t0 = Date.now() - 5 * ONE_HOUR_MS;
    let entry = makeEntry({
      failedAttempts: 3,
      createdAt: t0,
      updatedAt: t0,
    });
    engine.trackStageEntry(entry, t0);

    const { entry: escalated } = engine.applyEscalation(
      entry,
      engine.findMatchingRule(entry, t0 + 5 * ONE_HOUR_MS)!
    );
    entry = escalated;
    engine.recordRecovery(entry);

    const analytics = engine.getAnalytics();
    expect(analytics.totalEscalations).toBe(1);
    expect(analytics.stageFunnel.find((s) => s.stage === 'retry')?.escalated).toBe(1);
    expect(analytics.stageFunnel.find((s) => s.stage === 'warn')?.recovered).toBe(1);
    expect(analytics.timeInStage.find((s) => s.stage === 'retry')?.sampleSize).toBeGreaterThan(0);
    expect(analytics.recoveryByEscalationPath.some((p) => p.path === 'retry->warn')).toBe(true);
    expect(analytics.averageEscalationsBeforeRecovery).toBe(1);
  });
});

describe('optimizePolicy', () => {
  it('suggests missing policy', () => {
    const engine = new ProgressiveDunningEngine(false);
    const tips = engine.optimizePolicy('missing');
    expect(tips[0].type).toBe('under_escalation');
    expect(tips[0].title).toMatch(/No escalation policy/);
  });

  it('suggests template_gap and channel_mix', () => {
    const engine = makeEngine({
      planId: 'default',
      enabled: true,
      maxEscalations: 3,
      rules: [
        {
          id: 'gap',
          fromStage: 'retry',
          toStage: 'warn',
          afterFailedAttempts: 1,
          channels: ['email'],
          templateId: 'does_not_exist',
          priority: 10,
        },
      ],
    });
    const tips = engine.optimizePolicy('default');
    expect(tips.some((t) => t.type === 'template_gap')).toBe(true);
    expect(tips.some((t) => t.type === 'channel_mix')).toBe(true);
  });

  it('suggests low_recovery for weak paths', () => {
    const engine = makeEngine({
      planId: 'default',
      enabled: true,
      maxEscalations: 3,
      rules: [
        {
          id: 'r',
          fromStage: 'retry',
          toStage: 'warn',
          afterFailedAttempts: 1,
          channels: ['email', 'push'],
          templateId: 'payment_warning',
          priority: 10,
        },
      ],
    });

    for (let i = 0; i < 3; i++) {
      const entry = makeEntry({
        subscriptionId: `sub_${i}`,
        failedAttempts: 2,
      });
      engine.trackStageEntry(entry);
      engine.applyEscalation(entry, engine.findMatchingRule(entry)!);
    }

    const tips = engine.optimizePolicy('default');
    expect(tips.some((t) => t.type === 'low_recovery')).toBe(true);
  });

  it('suggests slow_stage when dwell exceeds threshold', () => {
    const engine = makeEngine({
      planId: 'default',
      enabled: true,
      maxEscalations: 3,
      rules: [
        {
          id: 'slow',
          fromStage: 'retry',
          toStage: 'warn',
          afterFailedAttempts: 1,
          afterHours: 1,
          channels: ['email', 'push'],
          templateId: 'payment_warning',
          priority: 10,
        },
      ],
    });

    for (let i = 0; i < 3; i++) {
      const started = Date.now() - 10 * ONE_HOUR_MS;
      const entry = makeEntry({
        subscriptionId: `slow_${i}`,
        failedAttempts: 2,
        createdAt: started,
        updatedAt: started,
      });
      engine.trackStageEntry(entry, started);
      engine.applyEscalation(entry, engine.findMatchingRule(entry)!);
    }

    const tips = engine.optimizePolicy('default');
    expect(tips.some((t) => t.type === 'slow_stage')).toBe(true);
  });
});

describe('renderTemplate', () => {
  it('substitutes placeholders from DUNNING_TEMPLATES', () => {
    const engine = makeEngine();
    const rendered = engine.renderTemplate('payment_warning', {
      subscription_name: 'Pro Plan',
      amount: '42.00',
      currency: 'USD',
      attempts: 3,
      subscription_id: 'sub_abc',
    });
    expect(rendered).not.toBeNull();
    expect(rendered!.subject).toContain('Pro Plan');
    expect(rendered!.body).toContain('42.00');
    expect(rendered!.body).toContain('USD');
    expect(rendered!.body).toContain('3');
    expect(rendered!.actionUrl).toContain('sub_abc');
  });

  it('returns null for unknown template', () => {
    const engine = makeEngine();
    expect(engine.renderTemplate('nope', {})).toBeNull();
  });

  it('lists built-in templates', () => {
    const engine = makeEngine();
    expect(engine.listTemplates().length).toBeGreaterThanOrEqual(4);
  });
});
