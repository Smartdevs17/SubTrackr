import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PauseRecord,
  PauseState,
  PauseReason,
  PauseLimits,
  PauseValidationResult,
  PausePreview,
  DEFAULT_PAUSE_LIMITS,
} from '../types/pause';
import { Subscription } from '../types/subscription';
import { getPeriodDays } from '../utils/proration';

const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

// ---------------------------------------------------------------------------
// ProrationCalculator – pure credit calculation for pause
// ---------------------------------------------------------------------------

/**
 * Calculate credit for pausing: credit = (pauseDays / periodDays) * monthlyPrice
 */
export function calculatePauseCredit(subscription: Subscription, pauseDays: number): number {
  const periodDays = getPeriodDays(subscription.billingCycle);
  const credit = (pauseDays / periodDays) * subscription.price;
  return Math.round(credit * 100) / 100;
}

/**
 * Calculate remaining credit when user resumes early.
 * Consumed credit = (daysUsed / totalPauseDays) * originalCredit
 */
export function calculateEarlyResumeCredit(record: PauseRecord): number {
  const now = new Date();
  const scheduledResume = new Date(record.scheduledResumeAt);
  const pausedAt = new Date(record.pausedAt);

  const totalPauseDays = Math.max(
    1,
    Math.ceil((scheduledResume.getTime() - pausedAt.getTime()) / (1000 * 60 * 60 * 24))
  );
  const daysElapsed = Math.max(
    0,
    Math.ceil((now.getTime() - pausedAt.getTime()) / (1000 * 60 * 60 * 24))
  );
  const daysRemaining = Math.max(0, totalPauseDays - daysElapsed);
  const remainingCredit = (daysRemaining / totalPauseDays) * record.creditAmount;
  return Math.round(remainingCredit * 100) / 100;
}

// ---------------------------------------------------------------------------
// PauseService – validation and state machine
// ---------------------------------------------------------------------------

/**
 * Validate a pause request against configured limits.
 */
export function validatePauseRequest(
  subscriptionId: string,
  pauseDays: number,
  existingRecords: PauseRecord[],
  limits: PauseLimits = DEFAULT_PAUSE_LIMITS
): PauseValidationResult {
  if (pauseDays < limits.minDays) {
    return { valid: false, reason: `Minimum pause duration is ${limits.minDays} days.` };
  }
  if (pauseDays > limits.maxDays) {
    return { valid: false, reason: `Maximum pause duration is ${limits.maxDays} days.` };
  }

  // Count pauses for this subscription in the current calendar year
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const pausesThisYear = existingRecords.filter(
    (r) =>
      r.subscriptionId === subscriptionId &&
      r.state !== PauseState.ACTIVE && // completed pauses
      new Date(r.pausedAt) >= yearStart
  ).length;

  // Also check if there's an active pause
  const activePause = existingRecords.find(
    (r) => r.subscriptionId === subscriptionId && r.state === PauseState.PAUSED
  );
  if (activePause) {
    return { valid: false, reason: 'This subscription is already paused.' };
  }

  if (pausesThisYear >= limits.maxPausesPerYear) {
    return {
      valid: false,
      reason: `Maximum of ${limits.maxPausesPerYear} pauses per year reached.`,
    };
  }

  return { valid: true };
}

/**
 * Preview what credit a pause would generate before confirming.
 */
export function previewPause(subscription: Subscription, pauseDays: number): PausePreview {
  const scheduledResumeAt = new Date(Date.now() + pauseDays * 24 * 60 * 60 * 1000);
  const creditAmount = calculatePauseCredit(subscription, pauseDays);

  return {
    subscriptionId: subscription.id,
    pauseDays,
    creditAmount,
    currency: subscription.currency,
    scheduledResumeAt,
    earlyResumeCredit: creditAmount, // Full credit available before any time passes
  };
}

/**
 * Initiate a pause – returns a new PauseRecord.
 * Edge case: if pause overlaps a renewal date, credit is still calculated from
 * the current period price; the billing engine must skip renewal while paused.
 */
export function initiatePause(
  subscription: Subscription,
  pauseDays: number,
  reason: PauseReason,
  note?: string
): PauseRecord {
  const creditAmount = calculatePauseCredit(subscription, pauseDays);
  const now = new Date();
  const scheduledResumeAt = new Date(now.getTime() + pauseDays * 24 * 60 * 60 * 1000);

  return {
    id: generateId(),
    subscriptionId: subscription.id,
    state: PauseState.PAUSED,
    reason,
    note,
    pausedAt: now,
    scheduledResumeAt,
    creditAmount,
    currency: subscription.currency,
    creditRemaining: creditAmount,
    creditExpired: false,
    creditExpiryDays: 90,
  };
}

/**
 * Resume a pause (early or automatic).
 * Returns updated record with consumed credit if early.
 */
export function resumePause(record: PauseRecord, early = false): PauseRecord {
  const now = new Date();
  const earlyCredit = early ? calculateEarlyResumeCredit(record) : 0;
  return {
    ...record,
    state: PauseState.ACTIVE,
    resumedAt: now,
    creditRemaining: earlyCredit,
  };
}

/**
 * Expire credit when subscription is cancelled after a pause.
 */
export function expireCredit(record: PauseRecord): PauseRecord {
  return { ...record, creditExpired: true, creditRemaining: 0 };
}

// ---------------------------------------------------------------------------
// Zustand Store
// ---------------------------------------------------------------------------

interface PauseState2 {
  records: PauseRecord[];
  isLoading: boolean;
  error: string | null;

  pauseSubscription: (
    subscription: Subscription,
    pauseDays: number,
    reason: PauseReason,
    limits?: PauseLimits,
    note?: string
  ) => PauseRecord;
  resumeSubscription: (subscriptionId: string, early?: boolean) => PauseRecord | null;
  expireCreditForSubscription: (subscriptionId: string) => void;
  getActivePause: (subscriptionId: string) => PauseRecord | undefined;
  getPauseHistory: (subscriptionId: string) => PauseRecord[];
  validatePause: (
    subscriptionId: string,
    pauseDays: number,
    limits?: PauseLimits
  ) => PauseValidationResult;
  previewPause: (subscription: Subscription, pauseDays: number) => PausePreview;
}

export const usePauseStore = create<PauseState2>()(
  persist(
    (set, get) => ({
      records: [],
      isLoading: false,
      error: null,

      pauseSubscription: (subscription, pauseDays, reason, limits, note) => {
        const validation = validatePauseRequest(subscription.id, pauseDays, get().records, limits);
        if (!validation.valid) throw new Error(validation.reason);

        const record = initiatePause(subscription, pauseDays, reason, note);
        set((state) => ({ records: [...state.records, record], error: null }));
        return record;
      },

      resumeSubscription: (subscriptionId, early = false) => {
        const active = get().records.find(
          (r) => r.subscriptionId === subscriptionId && r.state === PauseState.PAUSED
        );
        if (!active) return null;

        const resumed = resumePause(active, early);
        set((state) => ({
          records: state.records.map((r) => (r.id === active.id ? resumed : r)),
          error: null,
        }));
        return resumed;
      },

      expireCreditForSubscription: (subscriptionId) => {
        set((state) => ({
          records: state.records.map((r) =>
            r.subscriptionId === subscriptionId && !r.creditExpired ? expireCredit(r) : r
          ),
        }));
      },

      getActivePause: (subscriptionId) =>
        get().records.find(
          (r) => r.subscriptionId === subscriptionId && r.state === PauseState.PAUSED
        ),

      getPauseHistory: (subscriptionId) =>
        get().records.filter((r) => r.subscriptionId === subscriptionId),

      validatePause: (subscriptionId, pauseDays, limits) =>
        validatePauseRequest(subscriptionId, pauseDays, get().records, limits),

      previewPause: (subscription, pauseDays) => previewPause(subscription, pauseDays),
    }),
    {
      name: 'subtrackr-pauses',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
