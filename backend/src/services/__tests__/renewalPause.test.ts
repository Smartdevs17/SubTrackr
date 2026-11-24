import {
  DEFAULT_RENEWAL_PAUSE_CONFIG,
  RenewalPauseError,
  createRenewalPauseService,
  determineRenewalPause,
  shouldPause,
  summarizeUsage,
  validateRenewalPauseConfig,
  type ActivePause,
  type UsageSample,
} from '../renewalPause';

const NOW = Date.parse('2026-11-24T12:00:00.000Z');

function samples(units: number[], start = '2026-11-18T12:00:00.000Z'): UsageSample[] {
  const base = Date.parse(start);
  return units.map((u, i) => ({
    at: new Date(base + i * 86400000).toISOString(),
    units: u,
  }));
}

describe('renewalPause service (issue #2251)', () => {
  describe('validateRenewalPauseConfig', () => {
    it('returns frozen defaults', () => {
      const c = validateRenewalPauseConfig();
      expect(c.usageFloor).toBe(DEFAULT_RENEWAL_PAUSE_CONFIG.usageFloor);
      expect(Object.isFrozen(c)).toBe(true);
    });

    it('rejects invalid usageFloor', () => {
      expect(() => validateRenewalPauseConfig({ usageFloor: -1 })).toThrow(RenewalPauseError);
      expect(() => validateRenewalPauseConfig({ usageFloor: Number.NaN })).toThrow(RenewalPauseError);
    });

    it('rejects invalid windowDays and minSamples', () => {
      expect(() => validateRenewalPauseConfig({ windowDays: 0 })).toThrow(RenewalPauseError);
      expect(() => validateRenewalPauseConfig({ windowDays: 400 })).toThrow(RenewalPauseError);
      expect(() => validateRenewalPauseConfig({ minSamples: 40 })).toThrow(RenewalPauseError);
    });

    it('rejects pause duration exceeding the cap', () => {
      expect(() =>
        validateRenewalPauseConfig({ pauseDurationDays: 100, maxPauseDays: 90 }),
      ).toThrow(RenewalPauseError);
    });

    it('rejects non-object config', () => {
      expect(() => validateRenewalPauseConfig(null as never)).toThrow(RenewalPauseError);
    });
  });

  describe('summarizeUsage', () => {
    it('summarises samples in the trailing window', () => {
      const signal = summarizeUsage(samples([2, 2, 2, 2]), {}, NOW);
      expect(signal.sampleCount).toBe(4);
      expect(signal.total).toBe(8);
      expect(signal.average).toBe(2);
      expect(signal.belowFloor).toBe(false);
      expect(Object.isFrozen(signal)).toBe(true);
    });

    it('flags usage below the floor', () => {
      const signal = summarizeUsage(samples([0, 0, 0]), { usageFloor: 1 }, NOW);
      expect(signal.belowFloor).toBe(true);
      expect(signal.average).toBe(0);
    });

    it('ignores samples outside the window', () => {
      const old = [{ at: '2020-01-01T00:00:00.000Z', units: 100 }];
      expect(summarizeUsage(old, {}, NOW).sampleCount).toBe(0);
      expect(summarizeUsage(old, {}, NOW).belowFloor).toBe(false);
    });

    it('rejects malformed samples with stable codes', () => {
      try {
        summarizeUsage([{ at: '2026-11-20T00:00:00Z', units: -1 }], {}, NOW);
        throw new Error('expected failure');
      } catch (err) {
        expect(err).toBeInstanceOf(RenewalPauseError);
        expect((err as RenewalPauseError).code).toBe('INVALID_USAGE');
      }
      try {
        summarizeUsage([{ at: 'nope', units: 1 }], {}, NOW);
        throw new Error('expected failure');
      } catch (err) {
        expect((err as RenewalPauseError).code).toBe('INVALID_DATE');
      }
    });

    it('rejects a non-array sample list', () => {
      expect(() => summarizeUsage('nope' as never, {}, NOW)).toThrow(RenewalPauseError);
    });
  });

  describe('determineRenewalPause', () => {
    it('pauses when usage is below the floor with enough samples', () => {
      const signal = summarizeUsage(samples([0, 0, 0, 0, 0, 0, 0]), {}, NOW);
      const decision = determineRenewalPause(signal, {}, undefined, NOW);
      expect(decision.action).toBe('pause');
      expect(decision.reason).toBe('USAGE_BELOW_FLOOR');
      expect(decision.pausedUntil).not.toBeNull();
      expect(shouldPause(decision)).toBe(true);
      expect(Object.isFrozen(decision)).toBe(true);
    });

    it('fails open with no signal or too few samples', () => {
      const empty = summarizeUsage([], {}, NOW);
      expect(determineRenewalPause(empty, {}, undefined, NOW).reason).toBe('NO_SIGNAL');
      const thin = summarizeUsage(samples([0, 0]), {}, NOW);
      expect(determineRenewalPause(thin, {}, undefined, NOW).reason).toBe('INSUFFICIENT_SAMPLES');
      expect(determineRenewalPause(thin, {}, undefined, NOW).action).toBe('keep');
    });

    it('keeps a subscription whose usage is above the floor', () => {
      const signal = summarizeUsage(samples([3, 3, 3, 3, 3, 3, 3]), {}, NOW);
      expect(determineRenewalPause(signal, {}, undefined, NOW).reason).toBe('USAGE_ABOVE_FLOOR');
    });

    it('keeps an active pause and resumes when it expires', () => {
      const signal = summarizeUsage(samples([0, 0, 0, 0, 0, 0, 0]), {}, NOW);
      const active: ActivePause = { pausedUntil: '2026-12-10T00:00:00.000Z', pausedDays: 10 };
      const kept = determineRenewalPause(signal, {}, active, NOW);
      expect(kept.action).toBe('keep');
      expect(kept.reason).toBe('PAUSE_ACTIVE');
      const expired: ActivePause = { pausedUntil: '2026-11-20T00:00:00.000Z', pausedDays: 30 };
      expect(determineRenewalPause(signal, {}, expired, NOW).reason).toBe('PAUSE_EXPIRED');
    });

    it('rejects an invalid active pause', () => {
      const signal = summarizeUsage(samples([0, 0]), {}, NOW);
      expect(() =>
        determineRenewalPause(
          signal,
          {},
          { pausedUntil: 'bad', pausedDays: 0 },
          NOW,
        ),
      ).toThrow(RenewalPauseError);
    });
  });

  describe('createRenewalPauseService', () => {
    it('builds a frozen plan and fires metrics/logger hooks', () => {
      const events: string[] = [];
      let kept = 0;
      const service = createRenewalPauseService(
        { usageFloor: 1 },
        {
          recordPaused() { events.push('paused'); },
          recordResumed() { events.push('resumed'); },
          recordKept() { kept += 1; },
          recordRejected() { events.push('rejected'); },
          recordEvaluated() { events.push('evaluated'); },
        },
        {
          warn() { events.push('warn'); },
          info() { events.push('info'); },
        },
      );
      const plan = service.plan(
        [
          { subscriptionId: 'low', samples: samples([0, 0, 0, 0, 0, 0, 0]) },
          { subscriptionId: 'high', samples: samples([5, 5, 5, 5, 5, 5, 5]) },
        ],
        NOW,
      );
      expect(plan.total).toBe(2);
      expect(plan.paused).toBe(1);
      expect(plan.decisions[0].subscriptionId).toBe('low');
      expect(plan.decisions[0].action).toBe('pause');
      expect(plan.decisions[1].action).toBe('keep');
      expect(kept).toBe(1);
      expect(events).toContain('paused');
      expect(events).toContain('evaluated');
      expect(events).toContain('warn');
      expect(Object.isFrozen(plan)).toBe(true);
      expect(Object.isFrozen(service)).toBe(true);
    });

    it('reports rejections per item without aborting the batch', () => {
      const service = createRenewalPauseService({}, {
        recordRejected() { /* observed */ },
      });
      const plan = service.plan(
        [
          { subscriptionId: 'ok', samples: samples([1, 1, 1, 1, 1, 1, 1]) },
          { subscriptionId: 'bad', samples: [{ at: 'x', units: 1 }] },
          { subscriptionId: '', samples: [] },
        ],
        NOW,
      );
      expect(plan.decisions.length).toBe(1);
      expect(plan.rejected.length).toBe(2);
      expect(plan.rejected.map((r) => r.code)).toContain('INVALID_DATE');
      expect(plan.rejected.map((r) => r.code)).toContain('INVALID_INPUT');
    });

    it('rejects a non-array plan input', () => {
      const service = createRenewalPauseService();
      expect(() => service.plan('nope' as never, NOW)).toThrow(RenewalPauseError);
    });
  });
});
