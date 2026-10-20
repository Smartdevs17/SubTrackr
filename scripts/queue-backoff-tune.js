#!/usr/bin/env node
/**
 * scripts/queue-backoff-tune.js
 *
 * Issue #1286 — Implement queue backoff tuning automation.
 *
 * The backend retry policy (backend/shared/queue/retryPolicy.ts) uses a fixed
 * exponential backoff: base 1s, multiplier 2, capped at 60s. Those numbers are
 * correct on an average day and badly wrong on a bad one — when a downstream
 * dependency is failing, the queue keeps hammering it with an ever-shorter
 * effective interval, which extends the outage.
 *
 * This tool closes the loop. It consumes a queue metrics snapshot (the JSON
 * emitted by JobMonitoringDashboard, or any object with the same shape),
 * derives a pressure signal, and emits a tuned backoff policy per priority
 * class within hard safety bounds.
 *
 * Signals
 *   failureRate  - (enqueued - processed) / enqueued, blended with DLQ depth
 *   pressure     - worst queue depth as a fraction of maxQueueSize
 *   latency      - mean wait time against the per-priority latency SLO
 *
 * Direction of travel
 *   Under pressure / failing  -> back off harder (longer base, steeper curve)
 *   Healthy and idle          -> relax toward the floor (faster recovery)
 *
 * Stability guarantees
 *   - Every recommendation is clamped to [min, max] safety bounds.
 *   - Per-run movement is capped by maxStep, so the policy cannot oscillate.
 *   - A dead-band (hysteresis) suppresses changes for signals near the target.
 *   - Tuning is refused outright when the sample is too small to be meaningful.
 *
 * Usage:
 *   node scripts/queue-backoff-tune.js --input snapshot.json
 *   node scripts/queue-backoff-tune.js --input snapshot.json --apply --config backoff.json
 *   cat snapshot.json | node scripts/queue-backoff-tune.js
 *   node scripts/queue-backoff-tune.js --input snapshot.json --json
 *   node scripts/queue-backoff-tune.js --input snapshot.json --fail-on-change
 *
 * Exit codes:
 *   0  a tuned policy was produced (or already optimal / insufficient data)
 *   1  a change was recommended and --fail-on-change was passed
 *   2  usage error
 *   3  unexpected failure
 */

'use strict';

const fs = require('fs');

// ── Defaults (mirrors backend/shared/queue/retryPolicy.ts) ───────────────────

/** Default backoff configuration, kept in sync with retryPolicy.ts. */
const DEFAULT_POLICY = {
  baseDelayMs: 1_000,
  backoffMultiplier: 2,
  maxDelayMs: 60_000,
  maxAttempts: { critical: 10, high: 7, normal: 5, low: 3 },
};

/** Latency SLO per priority class, mirrored from backend/shared/queue/types.ts. */
const LATENCY_SLO_MS = {
  critical: 30_000,
  high: 120_000,
  normal: 600_000,
  low: Infinity,
};

const PRIORITY_ORDER = ['critical', 'high', 'normal', 'low'];

/** Hard safety bounds. A recommendation can never leave these ranges. */
const TUNING_BOUNDS = {
  minBaseDelayMs: 250,
  maxBaseDelayMs: 60_000,
  minBackoffMultiplier: 1.5,
  maxBackoffMultiplier: 4,
  minMaxDelayMs: 5_000,
  maxMaxDelayMs: 900_000,
};

/** Tuning behaviour. */
const TUNING_RULES = {
  /** Below this many enqueued jobs the snapshot is not statistically useful. */
  minSampleSize: 50,
  /** Queue depth, as a fraction of maxQueueSize, treated as "full". */
  pressureCeiling: 0.8,
  /** Failure rate treated as "the downstream is unhealthy". */
  failureCeiling: 0.25,
  /** Latency utilisation against the SLO treated as "breached". */
  latencyCeiling: 1,
  /** Dead-band half-width around each ceiling before a change is made. */
  hysteresis: 0.1,
  /** Maximum permitted relative movement per tuning run. */
  maxStep: 0.5,
  /** Per-priority attempt cap, which is never tuned. */
  tuneAttempts: false,
};

// ── Signal extraction ────────────────────────────────────────────────────────

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Round to a stable, human-friendly grid so recommendations do not jitter. */
function roundTo(value, step) {
  const snapped = Math.round(value / step) * step;
  return Math.max(step, Number(snapped.toFixed(4)));
}

/** Normalise one entry of the dashboard `queues` array. */
function normalizeQueue(entry) {
  const enqueued = Math.max(0, toNumber(entry.totalEnqueued, 0));
  const processed = Math.max(0, toNumber(entry.totalProcessed, 0));
  const wait = Math.max(0, toNumber(entry.avgWaitMs, 0));
  const priority = PRIORITY_ORDER.includes(entry.priority) ? entry.priority : 'normal';
  const slo = LATENCY_SLO_MS[priority];
  return {
    priority,
    depth: Math.max(0, toNumber(entry.depth, 0)),
    paused: entry.paused === true,
    enqueued,
    processed,
    avgWaitMs: wait,
    latencyUtilisation: Number.isFinite(slo) && slo > 0 ? wait / slo : 0,
  };
}

/**
 * Derive the tuning signals from a queue metrics snapshot.
 *
 * Accepts either a raw JobMonitoringDashboard snapshot or a hand-written stub
 * with the same field names. `maxQueueSize` is optional and defaults to the
 * 10 000-job PriorityQueue capacity.
 */
function deriveSignals(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const queues = Array.isArray(source.queues) ? source.queues.map(normalizeQueue) : [];

  const enqueued = queues.reduce((sum, q) => sum + q.enqueued, 0);
  const processed = queues.reduce((sum, q) => sum + q.processed, 0);
  const dlqTotal = Math.max(0, toNumber(source.dlq && source.dlq.total, 0));

  const outstanding = Math.max(0, enqueued - processed);
  const backlogRate = enqueued > 0 ? outstanding / enqueued : 0;
  const dlqRate = enqueued > 0 ? dlqTotal / enqueued : 0;
  // Dead-lettered work is the strongest single signal that retries are too hot.
  const failureRate = clamp(backlogRate + dlqRate, 0, 1);

  const maxQueueSize = toNumber(source.maxQueueSize, 10_000);
  const peakDepth = queues.reduce((max, q) => Math.max(max, q.depth), 0);
  const pressure = maxQueueSize > 0 ? clamp(peakDepth / maxQueueSize, 0, 1) : 0;

  const latencyUtilisation = queues.reduce((max, q) => Math.max(max, q.latencyUtilisation), 0);

  return {
    enqueued,
    processed,
    dlqTotal,
    peakDepth,
    failureRate,
    pressure,
    latencyUtilisation,
    sufficientData: enqueued >= TUNING_RULES.minSampleSize,
    minSampleSize: TUNING_RULES.minSampleSize,
    queues,
  };
}

// ── Tuning ───────────────────────────────────────────────────────────────────

/**
 * Combine the three signals into a single demand factor.
 *
 *   0.0  the system is idle and healthy
 *   1.0  exactly at the tuning ceiling
 *   >1.0 over the ceiling — back off hard
 */
function demandFactor(signals) {
  const byFailure = signals.failureRate / TUNING_RULES.failureCeiling;
  const byPressure = signals.pressure / TUNING_RULES.pressureCeiling;
  const byLatency = signals.latencyUtilisation / TUNING_RULES.latencyCeiling;
  return Math.max(byFailure, byPressure, byLatency);
}

/**
 * Classify the demand factor into a discrete action.
 * The hysteresis dead-band keeps a factor of 0.95 from flip-flopping the policy.
 */
function classifyDemand(factor) {
  const band = TUNING_RULES.hysteresis;
  if (factor > 1 + band) return 'increase';
  if (factor < 1 - band) return 'decrease';
  return 'hold';
}

/** Apply a multiplicative step, clamped so a single run cannot overshoot. */
function stepValue(current, factor) {
  const maxStep = TUNING_RULES.maxStep;
  const bounded = clamp(factor, 1 - maxStep, 1 + maxStep);
  return current * bounded;
}

/**
 * Produce a tuned backoff policy for every priority class.
 *
 * @param snapshot - queue metrics snapshot
 * @param current   - the policy in force today (flat or per-priority)
 * @returns {{ status, signals, demand, policy, changes, recommendations }}
 */
function tuneBackoff(snapshot, current) {
  const base = normalizePolicy(current);
  const signals = deriveSignals(snapshot);
  const demand = demandFactor(signals);

  if (!signals.sufficientData) {
    return {
      status: 'insufficient-data',
      signals,
      demand,
      policy: base,
      changes: [],
      recommendations: [],
    };
  }

  const action = classifyDemand(demand);
  const direction = action === 'increase' ? 1 : action === 'decrease' ? -1 : 0;

  const policy = {};
  const changes = [];
  const recommendations = [];

  for (const priority of PRIORITY_ORDER) {
    const before = {
      baseDelayMs: base[priority].baseDelayMs,
      backoffMultiplier: base[priority].backoffMultiplier,
      maxDelayMs: base[priority].maxDelayMs,
    };

    if (direction === 0) {
      policy[priority] = { ...before, maxAttempts: base[priority].maxAttempts };
      continue;
    }

    const baseDelayMs = roundTo(stepValue(before.baseDelayMs, 1 + direction * 0.35), 50);
    const backoffMultiplier = roundTo(
      stepValue(before.backoffMultiplier, 1 + direction * 0.15),
      0.1
    );
    const maxDelayMs = roundTo(stepValue(before.maxDelayMs, 1 + direction * 0.5), 1_000);

    const after = {
      baseDelayMs: clamp(baseDelayMs, TUNING_BOUNDS.minBaseDelayMs, TUNING_BOUNDS.maxBaseDelayMs),
      backoffMultiplier: clamp(
        backoffMultiplier,
        TUNING_BOUNDS.minBackoffMultiplier,
        TUNING_BOUNDS.maxBackoffMultiplier
      ),
      maxDelayMs: clamp(maxDelayMs, TUNING_BOUNDS.minMaxDelayMs, TUNING_BOUNDS.maxMaxDelayMs),
      maxAttempts: base[priority].maxAttempts,
    };

    policy[priority] = after;

    const changed =
      after.baseDelayMs !== before.baseDelayMs ||
      after.backoffMultiplier !== before.backoffMultiplier ||
      after.maxDelayMs !== before.maxDelayMs;

    if (changed) {
      changes.push({ priority, before, after });
      recommendations.push({ priority, reason: buildReason(direction, signals, action) });
    }
  }

  return {
    status: changes.length > 0 ? 'tuned' : 'optimal',
    signals,
    demand,
    policy,
    changes,
    recommendations,
  };
}

/** Human-readable justification for a change. */
function buildReason(direction, signals, action) {
  const drivers = [];
  if (signals.failureRate > TUNING_RULES.failureCeiling) {
    drivers.push(`failure rate ${(signals.failureRate * 100).toFixed(1)}%`);
  }
  if (signals.pressure > TUNING_RULES.pressureCeiling) {
    drivers.push(`queue pressure ${(signals.pressure * 100).toFixed(1)}%`);
  }
  if (signals.latencyUtilisation > TUNING_RULES.latencyCeiling) {
    drivers.push(`latency ${(signals.latencyUtilisation * 100).toFixed(0)}% of SLO`);
  }
  if (drivers.length === 0) {
    return action === 'increase' ? 'elevated pressure' : 'queue is healthy and idle';
  }
  const verb = direction > 0 ? 'back off' : 'relax';
  return `${verb}: ${drivers.join(', ')}`;
}

/**
 * Expand a flat or per-priority policy into a complete per-priority policy.
 * A flat policy (the shape used by RetryPolicyConfig) applies to every class.
 */
function normalizePolicy(policy) {
  const source = policy && typeof policy === 'object' ? policy : {};
  const perPriority = PRIORITY_ORDER.some(
    (priority) => source[priority] && typeof source[priority] === 'object'
  );
  const result = {};

  for (const priority of PRIORITY_ORDER) {
    const scope = perPriority ? source[priority] || {} : source;
    const attempts = scope.maxAttempts;
    const attemptsForClass =
      attempts !== undefined && typeof attempts === 'object' ? attempts[priority] : attempts;
    result[priority] = {
      baseDelayMs: toNumber(scope.baseDelayMs, DEFAULT_POLICY.baseDelayMs),
      backoffMultiplier: toNumber(scope.backoffMultiplier, DEFAULT_POLICY.backoffMultiplier),
      maxDelayMs: toNumber(scope.maxDelayMs, DEFAULT_POLICY.maxDelayMs),
      maxAttempts: toNumber(attemptsForClass, DEFAULT_POLICY.maxAttempts[priority]),
    };
  }

  return result;
}

// ── Reporting ────────────────────────────────────────────────────────────────

function printReport(result, options) {
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   SubTrackr Queue Backoff Autotuner     ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const s = result.signals;
  console.log(`[tune] Sample          : ${s.enqueued} enqueued / ${s.processed} processed`);
  console.log(`[tune] DLQ depth       : ${s.dlqTotal}`);
  console.log(`[tune] Failure rate    : ${(s.failureRate * 100).toFixed(1)}%`);
  console.log(`[tune] Queue pressure  : ${(s.pressure * 100).toFixed(1)}%`);
  console.log(`[tune] Latency vs SLO  : ${(s.latencyUtilisation * 100).toFixed(0)}%`);
  console.log(`[tune] Demand factor   : ${result.demand.toFixed(2)}`);

  if (result.status === 'insufficient-data') {
    console.log(
      `\n[tune] ⏸  Insufficient data — need at least ${s.minSampleSize} enqueued jobs.\n`
    );
    return;
  }

  console.log('');
  for (const change of result.changes) {
    const label = (text) => `${text.padEnd(18)}`;
    console.log(`  • ${change.priority}`);
    console.log(
      `      ${label('baseDelayMs')}${change.before.baseDelayMs} → ${change.after.baseDelayMs}`
    );
    console.log(
      `      ${label('backoffMultiplier')}` +
        `${change.before.backoffMultiplier} → ${change.after.backoffMultiplier}`
    );
    console.log(
      `      ${label('maxDelayMs')}${change.before.maxDelayMs} → ${change.after.maxDelayMs}`
    );
  }

  if (result.status === 'optimal') {
    console.log('\n[tune] ✓ Policy is already at the optimum for these signals.\n');
    return;
  }

  for (const recommendation of result.recommendations) {
    console.log(`[tune] ${recommendation.priority}: ${recommendation.reason}`);
  }

  if (!options.apply) {
    console.log('\n[tune] Re-run with --apply --config <file> to persist these values.\n');
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseArgs(argv) {
  const options = {
    input: null,
    config: null,
    apply: false,
    json: false,
    failOnChange: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--fail-on-change') options.failOnChange = true;
    else if (arg === '--input' || arg === '-i') {
      if (!argv[i + 1]) throw new Error('--input requires a path, or pipe JSON on stdin');
      options.input = argv[i + 1];
      i += 1;
    } else if (arg === '--config' || arg === '-c') {
      if (!argv[i + 1]) throw new Error('--config requires a path');
      options.config = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function loadJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err.message}`);
  }
}

function run(argv, stdinOverride) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    console.error(`[tune] ${err.message}`);
    console.error('[tune] Usage: node scripts/queue-backoff-tune.js --input <snapshot.json>');
    return 2;
  }

  if (options.help) {
    console.log('Usage: node scripts/queue-backoff-tune.js --input <snapshot.json> [--json]');
    console.log('       node scripts/queue-backoff-tune.js -i snapshot.json --apply -c cfg.json');
    console.log('       node scripts/queue-backoff-tune.js -i snapshot.json --fail-on-change');
    return 0;
  }

  let raw;
  try {
    if (options.input) {
      raw = fs.readFileSync(options.input, 'utf8');
    } else if (typeof stdinOverride === 'string') {
      raw = stdinOverride;
    } else {
      raw = readStdin();
    }
  } catch (err) {
    console.error(`[tune] Cannot read snapshot: ${err.message}`);
    return 2;
  }

  if (!raw || !raw.trim()) {
    console.error('[tune] No snapshot supplied. Pass --input <file> or pipe JSON on stdin.');
    return 2;
  }

  let snapshot;
  let current = DEFAULT_POLICY;
  try {
    snapshot = loadJson(raw, 'Snapshot');
    if (options.config && fs.existsSync(options.config)) {
      current = loadJson(fs.readFileSync(options.config, 'utf8'), 'Config');
    }
  } catch (err) {
    console.error(`[tune] ${err.message}`);
    return 2;
  }

  const result = tuneBackoff(snapshot, current);
  printReport(result, options);

  if (options.apply && result.changes.length > 0) {
    if (!options.config) {
      console.error('[tune] --apply requires --config <file> to write the tuned policy to.');
      return 2;
    }
    fs.writeFileSync(options.config, JSON.stringify(result.policy, null, 2) + '\n', 'utf8');
    console.log(`[tune] ✓ Wrote tuned policy to ${options.config}\n`);
  }

  // A recommendation is a successful run, not a tool failure: `npm run
  // queue:backoff:tune` must stay green. Pipelines that want to alert on
  // pending tuning opt in with --fail-on-change.
  if (options.failOnChange && result.status === 'tuned' && !options.apply) return 1;
  return 0;
}

if (require.main === module) {
  try {
    process.exit(run(process.argv.slice(2)));
  } catch (err) {
    console.error('[tune] Unexpected error:', err && err.message);
    process.exit(3);
  }
}

module.exports = {
  DEFAULT_POLICY,
  LATENCY_SLO_MS,
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
};
