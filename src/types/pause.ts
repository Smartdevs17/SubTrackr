/** Subscription pause / vacation types (Issue #563) */

export enum PauseState {
  ACTIVE = 'active',
  PAUSED = 'paused',
  RESUMING = 'resuming',
}

export enum PauseReason {
  VACATION = 'vacation',
  FINANCIAL_HARDSHIP = 'financial_hardship',
  TEMPORARY_NEED = 'temporary_need',
  OTHER = 'other',
}

/** Min/max durations and per-year cap are configurable per plan */
export interface PauseLimits {
  minDays: number; // default 7
  maxDays: number; // default 90
  maxPausesPerYear: number; // default 2
}

export const DEFAULT_PAUSE_LIMITS: PauseLimits = {
  minDays: 7,
  maxDays: 90,
  maxPausesPerYear: 2,
};

export interface PauseRecord {
  id: string;
  subscriptionId: string;
  state: PauseState;
  reason: PauseReason;
  /** User-supplied note */
  note?: string;
  pausedAt: Date;
  /** Scheduled resume date when pause was initiated */
  scheduledResumeAt: Date;
  /** Actual resume date (set on early/automatic resume) */
  resumedAt?: Date;
  /** Prorated credit issued for unused period, in subscription currency */
  creditAmount: number;
  currency: string;
  /** Credit remaining after early-resume consumption */
  creditRemaining: number;
  /** True once credit has been fully consumed or subscription cancelled */
  creditExpired: boolean;
  /** Days credit expires after resume (if subscription is cancelled after pause) */
  creditExpiryDays: number;
}

export interface PauseValidationResult {
  valid: boolean;
  reason?: string;
}

export interface PausePreview {
  subscriptionId: string;
  pauseDays: number;
  creditAmount: number;
  currency: string;
  scheduledResumeAt: Date;
  /** Amount that would be credited back on early resume */
  earlyResumeCredit: number;
}
