/**
 * Tests for scripts/queue-backoff-tune.js (issue #1286).
 *
 * Exercised through the root Jest project (`npm run test`), which picks up
 * `scripts/__tests__` via the `**\/__tests__/**` testMatch glob.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tool = require('../queue-backoff-tune');

const {
  DEFAULT_POLICY,
  PRIORITY_ORDER,
  TUNING_BOUNDS,
  TUNING_RULES,
  classifyDemand,
  demandFactor,
  deriveSignals,
  normalizePolicy,
  parseArgs,
  roundTo,
  run,
  stepValue,
  tuneBackoff,
} = tool;

function queue(overrides) {
  return Object.assign(
    {
      priority: 'normal',
      depth: 0,
      paused: false,
      avgWaitMs: 0,
      totalEnqueued: 1_000,
      totalProcessed: 1_000,
    },
    overrides
  );
}

/** A snapshot that is comfortably inside the tuning dead-band. */
const HEALTHY = {
  maxQueueSize: 10_000,
  queues: [queue({ totalEnqueued: 1_000, totalProcessed: 1_000, depth: 10 })],
  dlq: { total: 0 },
};

/** A snapshot where retries are clearly too aggressive. */
const OVERLOADED = {
  maxQueueSize: 10_000,
  queues: [
    queue({
      priority: 'critical',
      depth: 9_000,
      avgWaitMs: 60_000,
      totalEnqueued: 5_000,
      totalProcessed: 2_000,
    }),
  ],
  dlq: { total: 800 },
};

describe('queue-backoff-tune :: helpers', () => {
  it('snaps values to a stable grid without float noise', () => {
    expect(roundTo(2.3000000000000003, 0.1)).toBe(2.3);
    expect(roundTo(1_357, 50)).toBe(1_350);
    expect(roundTo(1_375, 50)).toBe(1_400);
    expect(roundTo(0, 50)).toBe(50);
  });

  it('caps a single tuning step at maxStep', () => {
    expect(stepValue(1_000, 10)).toBe(1_500);
    expect(stepValue(1_000, 0)).toBe(500);
    expect(stepValue(1_000, 1.35)).toBe(1_350);
  });

  it('classifies demand with a hysteresis dead-band', () => {
    expect(classifyDemand(1.5)).toBe('increase');
    expect(classifyDemand(1.05)).toBe('hold');
    expect(classifyDemand(1)).toBe('hold');
    expect(classifyDemand(0.95)).toBe('hold');
    expect(classifyDemand(0.1)).toBe('decrease');
  });

  it('takes the worst of the three signals as the demand factor', () => {
    const hot = deriveSignals(OVERLOADED);
    const healthy = deriveSignals(HEALTHY);
    expect(demandFactor(hot)).toBeGreaterThan(1);
    expect(demandFactor(healthy)).toBeLessThan(1);
  });
});

describe('queue-backoff-tune :: signals', () => {
  it('blends outstanding work and DLQ depth into the failure rate', () => {
    const signals = deriveSignals(OVERLOADED);
    // 3000 outstanding of 5000 enqueued, plus 800 dead-lettered.
    expect(signals.enqueued).toBe(5_000);
    expect(signals.dlqTotal).toBe(800);
    expect(signals.failureRate).toBeCloseTo(0.76, 5);
  });

  it('normalises queue depth against maxQueueSize', () => {
    expect(deriveSignals(OVERLOADED).pressure).toBeCloseTo(0.9, 5);
    expect(deriveSignals(HEALTHY).pressure).toBeCloseTo(0.001, 5);
  });

  it('measures mean wait time against the per-priority latency SLO', () => {
    const critical = deriveSignals({
      queues: [queue({ priority: 'critical', totalEnqueued: 200, avgWaitMs: 30_000 })],
    });
    expect(critical.latencyUtilisation).toBeCloseTo(1, 5);
  });

  it('treats the unbounded low-priority SLO as zero utilisation', () => {
    const low = deriveSignals({
      queues: [queue({ priority: 'low', totalEnqueued: 200, avgWaitMs: 900_000 })],
    });
    expect(low.latencyUtilisation).toBe(0);
  });

  it('falls back to the normal priority for an unknown class', () => {
    const signals = deriveSignals({ queues: [queue({ priority: 'urgent' })] });
    expect(signals.queues[0].priority).toBe('normal');
  });

  it('tolerates an empty or malformed snapshot', () => {
    const empty = deriveSignals({});
    expect(empty.enqueued).toBe(0);
    expect(empty.failureRate).toBe(0);
    expect(empty.pressure).toBe(0);
    expect(empty.sufficientData).toBe(false);
    expect(deriveSignals(null).queues).toEqual([]);
  });

  it('refuses to tune on a sample smaller than minSampleSize', () => {
    const tiny = { queues: [queue({ totalEnqueued: TUNING_RULES.minSampleSize - 1 })] };
    const result = tuneBackoff(tiny, DEFAULT_POLICY);
    expect(result.status).toBe('insufficient-data');
    expect(result.changes).toEqual([]);
    expect(result.policy.critical.baseDelayMs).toBe(DEFAULT_POLICY.baseDelayMs);
  });
});

describe('queue-backoff-tune :: tuning', () => {
  it('backs off harder when the downstream is failing', () => {
    const result = tuneBackoff(OVERLOADED, DEFAULT_POLICY);
    expect(result.status).toBe('tuned');
    expect(result.changes).toHaveLength(PRIORITY_ORDER.length);
    for (const change of result.changes) {
      expect(change.after.baseDelayMs).toBeGreaterThan(change.before.baseDelayMs);
      expect(change.after.backoffMultiplier).toBeGreaterThan(change.before.backoffMultiplier);
      expect(change.after.maxDelayMs).toBeGreaterThan(change.before.maxDelayMs);
    }
  });

  it('relaxes backoff when the queue is healthy and idle', () => {
    const result = tuneBackoff(HEALTHY, DEFAULT_POLICY);
    const first = result.changes[0];
    expect(first.after.baseDelayMs).toBeLessThan(first.before.baseDelayMs);
    expect(first.after.backoffMultiplier).toBeLessThan(first.before.backoffMultiplier);
    expect(first.after.maxDelayMs).toBeLessThan(first.before.maxDelayMs);
    expect(result.recommendations[0].reason).toContain('healthy');
  });

  it('holds steady inside the hysteresis dead-band', () => {
    const steady = {
      maxQueueSize: 10_000,
      queues: [queue({ depth: 8_000, totalEnqueued: 10_000, totalProcessed: 10_000 })],
      dlq: { total: 0 },
    };
    const result = tuneBackoff(steady, DEFAULT_POLICY);
    expect(result.status).toBe('optimal');
    expect(result.changes).toEqual([]);
  });

  it('never recommends a value outside the safety bounds', () => {
    let policy = DEFAULT_POLICY;
    for (let i = 0; i < 30; i += 1) {
      const result = tuneBackoff(OVERLOADED, policy);
      for (const priority of PRIORITY_ORDER) {
        const tuned = result.policy[priority];
        expect(tuned.baseDelayMs).toBeGreaterThanOrEqual(TUNING_BOUNDS.minBaseDelayMs);
        expect(tuned.baseDelayMs).toBeLessThanOrEqual(TUNING_BOUNDS.maxBaseDelayMs);
        expect(tuned.backoffMultiplier).toBeGreaterThanOrEqual(TUNING_BOUNDS.minBackoffMultiplier);
        expect(tuned.backoffMultiplier).toBeLessThanOrEqual(TUNING_BOUNDS.maxBackoffMultiplier);
        expect(tuned.maxDelayMs).toBeGreaterThanOrEqual(TUNING_BOUNDS.minMaxDelayMs);
        expect(tuned.maxDelayMs).toBeLessThanOrEqual(TUNING_BOUNDS.maxMaxDelayMs);
      }
      policy = result.policy;
    }
  });

  it('converges to the bounds and then stops changing', () => {
    let policy = DEFAULT_POLICY;
    for (let i = 0; i < 40; i += 1) {
      policy = tuneBackoff(OVERLOADED, policy).policy;
    }
    const settled = tuneBackoff(OVERLOADED, policy);
    expect(settled.status).toBe('optimal');
    expect(settled.changes).toEqual([]);
  });

  it('never tunes the per-priority attempt cap', () => {
    const result = tuneBackoff(OVERLOADED, DEFAULT_POLICY);
    for (const priority of PRIORITY_ORDER) {
      expect(result.policy[priority].maxAttempts).toBe(DEFAULT_POLICY.maxAttempts[priority]);
    }
  });

  it('explains why each priority was changed', () => {
    const result = tuneBackoff(OVERLOADED, DEFAULT_POLICY);
    expect(result.recommendations).toHaveLength(PRIORITY_ORDER.length);
    for (const recommendation of result.recommendations) {
      expect(recommendation.reason).toContain('back off');
    }
  });
});

describe('queue-backoff-tune :: policy normalisation', () => {
  it('expands a flat RetryPolicyConfig across all priority classes', () => {
    const policy = normalizePolicy({ baseDelayMs: 2_000, backoffMultiplier: 3 });
    for (const priority of PRIORITY_ORDER) {
      expect(policy[priority].baseDelayMs).toBe(2_000);
      expect(policy[priority].backoffMultiplier).toBe(3);
    }
  });

  it('falls back to the shipped defaults for an empty policy', () => {
    const policy = normalizePolicy({});
    expect(policy.normal.baseDelayMs).toBe(DEFAULT_POLICY.baseDelayMs);
    expect(policy.low.maxAttempts).toBe(DEFAULT_POLICY.maxAttempts.low);
  });

  it('accepts a per-priority policy with per-class attempt caps', () => {
    const policy = normalizePolicy({ critical: { baseDelayMs: 5_000, maxAttempts: 2 } });
    expect(policy.critical.baseDelayMs).toBe(5_000);
    expect(policy.critical.maxAttempts).toBe(2);
    expect(policy.normal.maxAttempts).toBe(DEFAULT_POLICY.maxAttempts.normal);
  });

  it('ignores non-numeric garbage', () => {
    const policy = normalizePolicy({ baseDelayMs: 'soon' });
    expect(policy.normal.baseDelayMs).toBe(DEFAULT_POLICY.baseDelayMs);
  });
});

describe('queue-backoff-tune :: CLI', () => {
  let dir;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtrackr-tune-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeSnapshot(name, value) {
    const target = path.join(dir, name);
    fs.writeFileSync(target, JSON.stringify(value), 'utf8');
    return target;
  }

  it('parses documented flags', () => {
    const options = parseArgs(['--input', 'a.json', '--apply', '--config', 'b.json', '--json']);
    expect(options.input).toBe('a.json');
    expect(options.apply).toBe(true);
    expect(options.config).toBe('b.json');
    expect(options.json).toBe(true);
  });

  it('supports short flags and rejects unknown arguments', () => {
    expect(parseArgs(['-i', 'a.json', '-c', 'b.json']).config).toBe('b.json');
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--input'])).toThrow(/requires/);
  });

  it('returns exit code 2 without a snapshot', () => {
    expect(run([], '')).toBe(2);
  });

  it('returns exit code 2 for malformed JSON', () => {
    expect(run([], '{not json')).toBe(2);
  });

  it('returns exit code 0 when a change is recommended but not applied', () => {
    const snapshot = writeSnapshot('hot.json', OVERLOADED);
    expect(run(['--input', snapshot])).toBe(0);
  });

  it('returns exit code 1 for a pending change with --fail-on-change', () => {
    const snapshot = writeSnapshot('hot.json', OVERLOADED);
    expect(run(['--input', snapshot, '--fail-on-change'])).toBe(1);
  });

  it('converges over repeated runs, then --fail-on-change passes', () => {
    const snapshot = writeSnapshot('hot.json', OVERLOADED);
    const config = path.join(dir, 'backoff.json');
    let convergedAfter = 0;
    for (let i = 0; i < 20; i += 1) {
      run(['--input', snapshot, '--apply', '--config', config]);
      if (run(['--input', snapshot, '--config', config, '--fail-on-change']) === 0) {
        convergedAfter = i + 1;
        break;
      }
    }
    // Bounded movement per run: more than one pass is required, and the cap
    // still guarantees it terminates well inside the loop bound.
    expect(convergedAfter).toBeGreaterThan(1);
    expect(convergedAfter).toBeLessThan(20);
  });

  it('reads a snapshot from stdin', () => {
    expect(run([], JSON.stringify(OVERLOADED))).toBe(0);
  });

  it('persists the tuned policy with --apply and reports success', () => {
    const snapshot = writeSnapshot('hot.json', OVERLOADED);
    const config = path.join(dir, 'backoff.json');
    expect(run(['--input', snapshot, '--apply', '--config', config])).toBe(0);
    const written = JSON.parse(fs.readFileSync(config, 'utf8'));
    expect(written.critical.baseDelayMs).toBeGreaterThan(DEFAULT_POLICY.baseDelayMs);
    expect(written.critical.maxAttempts).toBe(DEFAULT_POLICY.maxAttempts.critical);
  });

  it('refuses --apply without --config', () => {
    const snapshot = writeSnapshot('hot.json', OVERLOADED);
    expect(run(['--input', snapshot, '--apply'])).toBe(2);
  });

  it('re-reads an existing config so tuning is incremental', () => {
    const snapshot = writeSnapshot('hot.json', OVERLOADED);
    const config = path.join(dir, 'backoff.json');
    run(['--input', snapshot, '--apply', '--config', config]);
    const first = JSON.parse(fs.readFileSync(config, 'utf8'));
    run(['--input', snapshot, '--apply', '--config', config]);
    const second = JSON.parse(fs.readFileSync(config, 'utf8'));
    expect(second.critical.baseDelayMs).toBeGreaterThan(first.critical.baseDelayMs);
  });

  it('returns exit code 0 for an already-optimal policy', () => {
    const config = path.join(dir, 'backoff.json');
    let policy = DEFAULT_POLICY;
    for (let i = 0; i < 40; i += 1) {
      policy = tuneBackoff(OVERLOADED, policy).policy;
    }
    fs.writeFileSync(config, JSON.stringify(policy), 'utf8');
    const snapshot = writeSnapshot('hot.json', OVERLOADED);
    expect(run(['--input', snapshot, '--config', config])).toBe(0);
  });

  it('emits a machine-readable report with --json', () => {
    const snapshot = writeSnapshot('hot.json', OVERLOADED);
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      run(['--input', snapshot, '--json']);
      const payload = JSON.parse(write.mock.calls[0][0]);
      expect(payload.status).toBe('tuned');
      expect(payload.signals.dlqTotal).toBe(800);
    } finally {
      write.mockRestore();
    }
  });
});
