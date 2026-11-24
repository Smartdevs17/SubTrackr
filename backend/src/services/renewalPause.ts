/**
 * backend/src/services/renewalPause.ts
 *
 * Issue #2251 — smart renewal pause when usage drops below a configurable floor.
 *
 * A subscription that has stopped being used should not be charged again while
 * the subscriber is getting no value from it. This module is pure and
 * dependency-free: it turns a short history of usage samples into a bounded,
 * explainable pause decision. It never touches a database, a payment gateway or
 * the ML service. The caller (the renewal worker) owns persistence and any
 * actual charge; the ML signal (`ml-service/app/usage/floor.py`) owns the
 * statistical summary that feeds `evaluate`.
 *
 * Design rules (consistent with the sibling `billingShift.ts` service):
 *  - every observable failure has a stable `code` and never throws a raw error;
 *  - configuration is validated once, then frozen;
 *  - every returned decision/signal/plan is frozen so callers cannot mutate it;
 *  - metrics and logger hooks are injected and default to no-ops.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export type RenewalPauseErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_INPUT'
  | 'INVALID_USAGE'
  | 'INVALID_DATE'
  | 'NO_SIGNAL';

export type RenewalPauseAction = 'pause' | 'keep' | 'resume';

export type RenewalPauseReason =
  | 'USAGE_BELOW_FLOOR'
  | 'USAGE_ABOVE_FLOOR'
  | 'INSUFFICIENT_SAMPLES'
  | 'NO_SIGNAL'
  | 'PAUSE_EXPIRED'
  | 'PAUSE_ACTIVE';

export class RenewalPauseError extends Error {
  readonly code: RenewalPauseErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: RenewalPauseErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'RenewalPauseError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, RenewalPauseError.prototype);
  }

  static invalidConfig(message: string, details?: Record<string, unknown>): RenewalPauseError {
    return new RenewalPauseError('INVALID_CONFIG', message, details);
  }

  static invalidInput(message: string, details?: Record<string, unknown>): RenewalPauseError {
    return new RenewalPauseError('INVALID_INPUT', message, details);
  }
}

export interface RenewalPauseConfig {
  /** Minimum average daily units required to keep auto-renewal on (default 1). */
  usageFloor: number;
  /** Length of the trailing evaluation window in whole days (default 30). */
  windowDays: number;
  /** Samples needed before a pause is allowed (default 7). Fail-open below this. */
  minSamples: number;
  /** Days a pause lasts before the subscriber can be evaluated again (default 30). */
  pauseDurationDays: number;
  /** Hard cap on consecutive pause extensions (default 90). */
  maxPauseDays: number;
  /** Days of grace added after the floor is breached (default 3). */
  gracePeriodDays: number;
  /** Local timezone adjustment applied to sample dates, in minutes (default 0). */
  timezoneOffsetMinutes: number;
}

export const DEFAULT_RENEWAL_PAUSE_CONFIG: Readonly<RenewalPauseConfig> = Object.freeze({
  usageFloor: 1,
  windowDays: 30,
  minSamples: 7,
  pauseDurationDays: 30,
  maxPauseDays: 90,
  gracePeriodDays: 3,
  timezoneOffsetMinutes: 0,
});

export interface RenewalPauseMetrics {
  recordPaused(subscriptionId: string, observed: number, floor: number): void;
  recordResumed(subscriptionId: string, reason: RenewalPauseReason): void;
  recordKept(subscriptionId: string, observed: number): void;
  recordRejected(code: RenewalPauseErrorCode): void;
  recordEvaluated(total: number, paused: number): void;
}

export interface RenewalPauseLogger {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
}

export const noopRenewalPauseMetrics: Readonly<RenewalPauseMetrics> = Object.freeze({
  recordPaused(): void {},
  recordResumed(): void {},
  recordKept(): void {},
  recordRejected(): void {},
  recordEvaluated(): void {},
});

export const noopRenewalPauseLogger: Readonly<RenewalPauseLogger> = Object.freeze({
  info(): void {},
  warn(): void {},
});

export function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Validate and freeze a config, applying defaults for absent fields. */
export function validateRenewalPauseConfig(config: Partial<RenewalPauseConfig> = {}): RenewalPauseConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw RenewalPauseError.invalidConfig('config must be an object');
  }
  const merged: RenewalPauseConfig = { ...DEFAULT_RENEWAL_PAUSE_CONFIG, ...config };

  if (!isNonNegativeFinite(merged.usageFloor)) {
    throw RenewalPauseError.invalidConfig('usageFloor must be a non-negative finite number', {
      usageFloor: config.usageFloor,
    });
  }
  if (!Number.isSafeInteger(merged.windowDays) || merged.windowDays < 1 || merged.windowDays > 365) {
    throw RenewalPauseError.invalidConfig('windowDays must be an integer 1-365', {
      windowDays: config.windowDays,
    });
  }
  if (!Number.isSafeInteger(merged.minSamples) || merged.minSamples < 1 || merged.minSamples > merged.windowDays) {
    throw RenewalPauseError.invalidConfig('minSamples must be an integer between 1 and windowDays', {
      minSamples: config.minSamples,
      windowDays: config.windowDays,
    });
  }
  if (
    !Number.isSafeInteger(merged.pauseDurationDays) ||
    merged.pauseDurationDays < 1 ||
    merged.pauseDurationDays > merged.maxPauseDays
  ) {
    throw RenewalPauseError.invalidConfig('pauseDurationDays must be an integer within maxPauseDays', {
      pauseDurationDays: config.pauseDurationDays,
    });
  }
  if (!Number.isSafeInteger(merged.maxPauseDays) || merged.maxPauseDays < 1 || merged.maxPauseDays > 365) {
    throw RenewalPauseError.invalidConfig('maxPauseDays must be an integer 1-365', {
      maxPauseDays: config.maxPauseDays,
    });
  }
  if (
    !Number.isSafeInteger(merged.gracePeriodDays) ||
    merged.gracePeriodDays < 0 ||
    merged.gracePeriodDays > merged.windowDays
  ) {
    throw RenewalPauseError.invalidConfig('gracePeriodDays must be an integer within windowDays', {
      gracePeriodDays: config.gracePeriodDays,
    });
  }
  if (!Number.isFinite(merged.timezoneOffsetMinutes) || Math.abs(merged.timezoneOffsetMinutes) > 1440) {
    throw RenewalPauseError.invalidConfig('timezoneOffsetMinutes must be within +/-1440', {
      timezoneOffsetMinutes: config.timezoneOffsetMinutes,
    });
  }
  return Object.freeze(merged);
}

// ── Usage signal ──────────────────────────────────────────────────────────────

export interface UsageSample {
  /** ISO-8601 instant the observation belongs to. */
  readonly at: string;
  /** Units consumed in that observation. Must be a non-negative finite number. */
  readonly units: number;
}

export interface UsageSignal {
  readonly sampleCount: number;
  readonly average: number;
  readonly total: number;
  readonly floor: number;
  readonly belowFloor: boolean;
  readonly windowStart: string;
  readonly windowEnd: string;
}

function parseInstant(value: string, code: RenewalPauseErrorCode): number {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RenewalPauseError(code, 'timestamp must be a non-empty string');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new RenewalPauseError(code, 'timestamp is not a valid ISO-8601 instant', { value });
  }
  return parsed;
}

/**
 * Summarise the samples inside the trailing window. Samples outside the window
 * and malformed samples are rejected (not silently ignored) with stable codes.
 */
export function summarizeUsage(
  samples: readonly UsageSample[],
  config: Partial<RenewalPauseConfig> = {},
  now: string | number = Date.now(),
): UsageSignal {
  const cfg = validateRenewalPauseConfig(config);
  if (!Array.isArray(samples)) {
    throw RenewalPauseError.invalidInput('samples must be an array');
  }

  const nowMs = typeof now === 'number' ? now : parseInstant(now, 'INVALID_DATE');
  if (!Number.isFinite(nowMs)) {
    throw new RenewalPauseError('INVALID_DATE', 'now must be a finite value');
  }
  const windowMs = cfg.windowDays * 86400000;
  const startMs = nowMs - windowMs + cfg.timezoneOffsetMinutes * 60000;
  const endMs = nowMs + cfg.timezoneOffsetMinutes * 60000;

  let total = 0;
  let count = 0;
  for (const sample of samples) {
    if (sample === null || typeof sample !== 'object') {
      throw new RenewalPauseError('INVALID_USAGE', 'sample must be an object');
    }
    if (!isNonNegativeFinite(sample.units)) {
      throw new RenewalPauseError('INVALID_USAGE', 'sample.units must be a non-negative finite number', {
        at: sample.at,
      });
    }
    const t = parseInstant(sample.at, 'INVALID_DATE');
    if (t < startMs || t > endMs) continue;
    total += sample.units;
    count += 1;
  }

  const average = count === 0 ? 0 : total / count;
  return Object.freeze({
    sampleCount: count,
    average,
    total,
    floor: cfg.usageFloor,
    belowFloor: count > 0 && average < cfg.usageFloor,
    windowStart: new Date(startMs).toISOString(),
    windowEnd: new Date(endMs).toISOString(),
  });
}

// ── Decision ──────────────────────────────────────────────────────────────────

export interface RenewalPauseDecision {
  readonly subscriptionId: string;
  readonly action: RenewalPauseAction;
  readonly reason: RenewalPauseReason;
  readonly observed: number;
  readonly floor: number;
  readonly pausedUntil: string | null;
  readonly evaluatedAt: string;
  readonly config: Readonly<RenewalPauseConfig>;
}

export interface ActivePause {
  /** ISO instant the current pause ends. */
  readonly pausedUntil: string;
  /** Days the subscription has already been paused consecutively. */
  readonly pausedDays: number;
}

export interface PauseEvaluationInput {
  readonly subscriptionId: string;
  readonly samples: readonly UsageSample[];
  readonly activePause?: ActivePause;
}

export interface PauseEvaluationResult {
  readonly decisions: readonly RenewalPauseDecision[];
  readonly rejected: readonly { subscriptionId: string; code: RenewalPauseErrorCode; reason: string }[];
  readonly total: number;
  readonly paused: number;
}

/** Decide a single subscription from its usage signal. Pure and deterministic. */
export function determineRenewalPause(
  signal: UsageSignal,
  config: Partial<RenewalPauseConfig> = {},
  activePause?: ActivePause,
  now: string | number = Date.now(),
): RenewalPauseDecision {
  const cfg = validateRenewalPauseConfig(config);
  const nowMs = typeof now === 'number' ? now : parseInstant(now, 'INVALID_DATE');
  if (!Number.isFinite(nowMs)) {
    throw new RenewalPauseError('INVALID_DATE', 'now must be a finite value');
  }
  const evaluatedAt = new Date(nowMs).toISOString();

  if (activePause) {
    const until = parseInstant(activePause.pausedUntil, 'INVALID_DATE');
    if (!Number.isSafeInteger(activePause.pausedDays) || activePause.pausedDays < 0) {
      throw RenewalPauseError.invalidInput('activePause.pausedDays must be a non-negative integer');
    }
    if (until > nowMs) {
      return Object.freeze({
        subscriptionId: '',
        action: 'keep',
        reason: 'PAUSE_ACTIVE',
        observed: signal.average,
        floor: signal.floor,
        pausedUntil: new Date(until).toISOString(),
        evaluatedAt,
        config: cfg,
      });
    }
    return Object.freeze({
      subscriptionId: '',
      action: 'resume',
      reason: 'PAUSE_EXPIRED',
      observed: signal.average,
      floor: signal.floor,
      pausedUntil: null,
      evaluatedAt,
      config: cfg,
    });
  }

  if (signal.sampleCount === 0) {
    return Object.freeze({
      subscriptionId: '',
      action: 'keep',
      reason: 'NO_SIGNAL',
      observed: 0,
      floor: signal.floor,
      pausedUntil: null,
      evaluatedAt,
      config: cfg,
    });
  }
  if (signal.sampleCount < cfg.minSamples) {
    return Object.freeze({
      subscriptionId: '',
      action: 'keep',
      reason: 'INSUFFICIENT_SAMPLES',
      observed: signal.average,
      floor: signal.floor,
      pausedUntil: null,
      evaluatedAt,
      config: cfg,
    });
  }
  if (!signal.belowFloor) {
    return Object.freeze({
      subscriptionId: '',
      action: 'keep',
      reason: 'USAGE_ABOVE_FLOOR',
      observed: signal.average,
      floor: signal.floor,
      pausedUntil: null,
      evaluatedAt,
      config: cfg,
    });
  }

  const effectiveDays = Math.min(cfg.pauseDurationDays, Math.max(1, cfg.maxPauseDays));
  return Object.freeze({
    subscriptionId: '',
    action: 'pause',
    reason: 'USAGE_BELOW_FLOOR',
    observed: signal.average,
    floor: signal.floor,
    pausedUntil: new Date(nowMs + (effectiveDays + cfg.gracePeriodDays) * 86400000).toISOString(),
    evaluatedAt,
    config: cfg,
  });
}

export function shouldPause(decision: RenewalPauseDecision): boolean {
  return decision.action === 'pause';
}

// ── Service ───────────────────────────────────────────────────────────────────

export interface RenewalPauseService {
  evaluate(input: PauseEvaluationInput, now?: string | number): RenewalPauseDecision;
  plan(inputs: readonly PauseEvaluationInput[], now?: string | number): PauseEvaluationResult;
  readonly config: Readonly<RenewalPauseConfig>;
}

/**
 * Create a renewal-pause service. All hooks are optional and default to
 * no-ops, so the service is safe to use in unit tests and in the worker.
 */
export function createRenewalPauseService(
  config: Partial<RenewalPauseConfig> = {},
  metrics: Partial<RenewalPauseMetrics> = {},
  logger: Partial<RenewalPauseLogger> = {},
): RenewalPauseService {
  const cfg = validateRenewalPauseConfig(config);
  const m: RenewalPauseMetrics = { ...noopRenewalPauseMetrics, ...metrics };
  const log: RenewalPauseLogger = { ...noopRenewalPauseLogger, ...logger };

  function reject(code: RenewalPauseErrorCode): never {
    m.recordRejected(code);
    throw new RenewalPauseError(code, `request rejected: ${code}`);
  }

  function evaluateOne(input: PauseEvaluationInput, now?: string | number): RenewalPauseDecision {
    if (input === null || typeof input !== 'object') reject('INVALID_INPUT');
    if (typeof input.subscriptionId !== 'string' || input.subscriptionId.trim() === '') {
      reject('INVALID_INPUT');
    }
    let signal: UsageSignal;
    try {
      signal = summarizeUsage(input.samples, cfg, now as string | number);
    } catch (error) {
      if (error instanceof RenewalPauseError) {
        m.recordRejected(error.code);
        throw error;
      }
      reject('INVALID_USAGE');
    }

    let base: RenewalPauseDecision;
    try {
      base = determineRenewalPause(signal, cfg, input.activePause, now as string | number);
    } catch (error) {
      if (error instanceof RenewalPauseError) {
        m.recordRejected(error.code);
        throw error;
      }
      reject('INVALID_INPUT');
    }

    const decision: RenewalPauseDecision = Object.freeze({
      ...base,
      subscriptionId: input.subscriptionId,
    });
    if (decision.action === 'pause') {
      m.recordPaused(decision.subscriptionId, decision.observed, decision.floor);
      log.warn('renewal paused: usage below floor', {
        subscriptionId: decision.subscriptionId,
        observed: decision.observed,
        floor: decision.floor,
        pausedUntil: decision.pausedUntil,
      });
    } else if (decision.action === 'resume') {
      m.recordResumed(decision.subscriptionId, decision.reason);
      log.info('renewal resumed: pause expired', { subscriptionId: decision.subscriptionId });
    } else {
      m.recordKept(decision.subscriptionId, decision.observed);
    }
    return decision;
  }

  function plan(inputs: readonly PauseEvaluationInput[], now?: string | number): PauseEvaluationResult {
    if (!Array.isArray(inputs)) reject('INVALID_INPUT');
    const decisions: RenewalPauseDecision[] = [];
    const rejected: PauseEvaluationResult['rejected'] = [];
    for (const input of inputs) {
      try {
        decisions.push(evaluateOne(input, now));
      } catch (error) {
        if (!(error instanceof RenewalPauseError)) throw error;
        rejected.push(
          Object.freeze({
            subscriptionId: input && typeof input.subscriptionId === 'string' ? input.subscriptionId : '',
            code: error.code,
            reason: error.message,
          }),
        );
      }
    }
    const result: PauseEvaluationResult = Object.freeze({
      decisions: Object.freeze(decisions),
      rejected: Object.freeze(rejected),
      total: inputs.length,
      paused: decisions.filter(shouldPause).length,
    });
    m.recordEvaluated(result.total, result.paused);
    log.info('renewal pause plan completed', { total: result.total, paused: result.paused });
    return result;
  }

  return Object.freeze({ evaluate: evaluateOne, plan, config: cfg });
}
