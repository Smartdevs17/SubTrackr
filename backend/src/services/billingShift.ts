/**
 * backend/src/services/billingShift.ts
 *
 * Issue #2252 — billing-day shifter. Consolidates charges that fall on
 * different days onto a single chosen weekday, so a subscriber's invoices
 * cluster into one predictable processing window. The module is pure and
 * dependency-free: it computes shifts and plans, never touches a database or
 * a payment gateway. Callers (the worker in workers/src/jobs/billingShift.ts)
 * own persistence and charging.
 */

export type BillingShiftErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_INPUT'
  | 'INVALID_DATE'
  | 'INVALID_WEEKDAY'
  | 'SHIFT_EXCEEDED'
  | 'INVALID_SUBSCRIPTION';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6] as const;

export const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

export function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

export class BillingShiftError extends Error {
  readonly code: BillingShiftErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: BillingShiftErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'BillingShiftError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, BillingShiftError.prototype);
  }

  static invalidConfig(message: string, details?: Record<string, unknown>): BillingShiftError {
    return new BillingShiftError('INVALID_CONFIG', message, details);
  }
  static invalidInput(message: string, details?: Record<string, unknown>): BillingShiftError {
    return new BillingShiftError('INVALID_INPUT', message, details);
  }
}

export interface BillingShiftConfig {
  /** Weekday (0=Sunday … 6=Saturday) every charge is consolidated onto. */
  targetWeekday: Weekday;
  /** Never shift an item more than this many days (default 6). */
  maxShiftDays: number;
  /** Extra minutes to add to the computed instant for the local timezone. */
  timezoneOffsetMinutes: number;
  /** When true, allow shifting earlier in the same week instead of only forward. */
  allowBackward: boolean;
}

export const DEFAULT_BILLING_SHIFT_CONFIG: Readonly<BillingShiftConfig> = Object.freeze({
  targetWeekday: 1,
  maxShiftDays: 6,
  timezoneOffsetMinutes: 0,
  allowBackward: false,
});

export interface BillingShiftMetrics {
  recordShift(original: string, shifted: string, days: number): void;
  recordRejected(code: BillingShiftErrorCode): void;
  recordPlan(size: number): void;
}

export interface BillingShiftLogger {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
}

export const noopBillingShiftMetrics: Readonly<BillingShiftMetrics> = Object.freeze({
  recordShift(): void {},
  recordRejected(): void {},
  recordPlan(): void {},
});

export const noopBillingShiftLogger: Readonly<BillingShiftLogger> = Object.freeze({
  info(): void {},
  warn(): void {},
});

export function validateBillingShiftConfig(config: Partial<BillingShiftConfig> = {}): BillingShiftConfig {
  if (config === null || typeof config !== 'object') {
    throw BillingShiftError.invalidConfig('config must be an object');
  }
  const merged: BillingShiftConfig = { ...DEFAULT_BILLING_SHIFT_CONFIG, ...config };
  if (!isWeekday(merged.targetWeekday)) {
    throw BillingShiftError.invalidConfig('targetWeekday must be 0-6', { targetWeekday: config.targetWeekday });
  }
  if (!Number.isInteger(merged.maxShiftDays) || merged.maxShiftDays < 0 || merged.maxShiftDays > 31) {
    throw BillingShiftError.invalidConfig('maxShiftDays must be an integer 0-31', { maxShiftDays: config.maxShiftDays });
  }
  if (!Number.isFinite(merged.timezoneOffsetMinutes) || Math.abs(merged.timezoneOffsetMinutes) > 1440) {
    throw BillingShiftError.invalidConfig('timezoneOffsetMinutes must be within +/-1440', {
      timezoneOffsetMinutes: config.timezoneOffsetMinutes,
    });
  }
  if (typeof merged.allowBackward !== 'boolean') {
    throw BillingShiftError.invalidConfig('allowBackward must be a boolean');
  }
  return Object.freeze(merged);
}

function parseDate(value: string, code: BillingShiftErrorCode): Date {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BillingShiftError('INVALID_DATE', 'date must be a non-empty string');
  }
  const t = Date.parse(value);
  if (!Number.isFinite(t)) {
    throw new BillingShiftError(code, 'date is not a valid ISO-8601 timestamp', { value });
  }
  return new Date(t);
}

function shiftToWeekday(date: Date, config: BillingShiftConfig): Date {
  const local = new Date(date.getTime() + config.timezoneOffsetMinutes * 60000);
  const current = local.getUTCDay();
  let delta = (config.targetWeekday - current + 7) % 7;
  if (delta === 0) return new Date(date.getTime());
  if (config.allowBackward && delta > 3) delta -= 7;
  return new Date(date.getTime() + delta * 86400000);
}

export interface ShiftResult {
  readonly id: string;
  readonly originalDate: string;
  readonly shiftedDate: string;
  readonly shiftDays: number;
  readonly weekday: Weekday;
}

export interface ShiftInput {
  readonly id: string;
  readonly dueDate: string;
  readonly amountMinor?: number;
  readonly currency?: string;
}

export interface ShiftPlan<T extends ShiftInput = ShiftInput> {
  readonly shifts: readonly ShiftResult[];
  readonly rejected: readonly { id: string; code: BillingShiftErrorCode; reason: string }[];
  readonly total: number;
  readonly shifted: number;
}

export function shiftDueDate(dueDate: string, config: Partial<BillingShiftConfig> = {}): ShiftResult {
  const cfg = validateBillingShiftConfig(config);
  const parsed = parseDate(dueDate, 'INVALID_DATE');
  const shifted = shiftToWeekday(parsed, cfg);
  const shiftDays = Math.round((shifted.getTime() - parsed.getTime()) / 86400000);
  if (Math.abs(shiftDays) > cfg.maxShiftDays) {
    throw new BillingShiftError('SHIFT_EXCEEDED', 'required shift exceeds maxShiftDays', {
      shiftDays,
      maxShiftDays: cfg.maxShiftDays,
    });
  }
  const local = new Date(shifted.getTime() + cfg.timezoneOffsetMinutes * 60000);
  return Object.freeze({
    id: '',
    originalDate: parsed.toISOString(),
    shiftedDate: shifted.toISOString(),
    shiftDays,
    weekday: local.getUTCDay() as Weekday,
  });
}

export function daysBetween(from: string, to: string): number {
  const a = parseDate(from, 'INVALID_DATE');
  const b = parseDate(to, 'INVALID_DATE');
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function nextBillingDate(anchor: string, targetWeekday: Weekday): string {
  if (!isWeekday(targetWeekday)) {
    throw new BillingShiftError('INVALID_WEEKDAY', 'targetWeekday must be 0-6');
  }
  const cfg = validateBillingShiftConfig({ targetWeekday, maxShiftDays: 6 });
  return shiftDueDate(anchor, cfg).shiftedDate;
}

export interface BillingShifter {
  shift(dueDate: string): ShiftResult;
  plan(items: readonly ShiftInput[]): ShiftPlan;
  readonly config: Readonly<BillingShiftConfig>;
}

export function createBillingShifter(
  config: Partial<BillingShiftConfig> = {},
  metrics: Partial<BillingShiftMetrics> = {},
  logger: Partial<BillingShiftLogger> = {},
): BillingShifter {
  const cfg = validateBillingShiftConfig(config);
  const m: BillingShiftMetrics = { ...noopBillingShiftMetrics, ...metrics };
  const log: BillingShiftLogger = { ...noopBillingShiftLogger, ...logger };

  function shift(dueDate: string): ShiftResult {
    try {
      const base = shiftDueDate(dueDate, cfg);
      const result: ShiftResult = Object.freeze({ ...base });
      m.recordShift(result.originalDate, result.shiftedDate, result.shiftDays);
      return result;
    } catch (err) {
      if (err instanceof BillingShiftError) m.recordRejected(err.code);
      throw err;
    }
  }

  function plan(items: readonly ShiftInput[]): ShiftPlan {
    if (!Array.isArray(items)) {
      throw BillingShiftError.invalidInput('items must be an array');
    }
    const shifts: ShiftResult[] = [];
    const rejected: ShiftPlan['rejected'] = [];
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || item.id.trim() === '') {
        rejected.push({ id: '', code: 'INVALID_SUBSCRIPTION', reason: 'missing id' });
        continue;
      }
      try {
        const s = shift(item.dueDate);
        shifts.push(Object.freeze({ ...s, id: item.id }));
      } catch (err) {
        if (err instanceof BillingShiftError) {
          rejected.push({ id: item.id, code: err.code, reason: err.message });
        } else {
          throw err;
        }
      }
    }
    const result: ShiftPlan = Object.freeze({
      shifts: Object.freeze(shifts),
      rejected: Object.freeze(rejected),
      total: items.length,
      shifted: shifts.length,
    });
    m.recordPlan(items.length);
    log.info('billing shift plan completed', { total: result.total, shifted: result.shifted });
    return result;
  }

  return Object.freeze({ shift, plan, config: cfg });
}
