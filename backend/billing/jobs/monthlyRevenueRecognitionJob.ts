/**
 * Monthly Revenue Recognition Job (ASC 606 / IFRS 15)
 *
 * Runs once per day (configurable). For each active subscription that has
 * a pending revenue schedule:
 *  1. Computes how much revenue has moved from deferred → recognised.
 *  2. Writes a recognition journal entry to the audit log.
 *  3. Updates the subscription's deferred / recognised balances in the DB.
 *  4. Emits a Prometheus metric for observability.
 *
 * Edge cases handled:
 *  - Free trials: entries with amount = 0 are skipped.
 *  - Early termination: accelerated entries (periodEnd ≤ now) are fully recognised.
 *  - Contract modifications: the schedule is rebuilt; old entries are closed.
 */

export interface RevenueScheduleEntry {
  periodStart: number; // Unix ms
  periodEnd: number; // Unix ms
  recognisedAmount: number;
  isRecognised: boolean;
  /**
   * Cumulative amount already recognised for this entry across all prior
   * runs. Optional so schedules persisted before progress tracking existed
   * still load; treat a missing value as 0.
   */
  recognisedToDate?: number;
}

export interface RevenueSchedule {
  subscriptionId: string;
  merchantId: string;
  totalAmount: number;
  chargeDate: number;
  entries: RevenueScheduleEntry[];
}

export interface RecognitionJournalEntry {
  id: string;
  subscriptionId: string;
  merchantId: string;
  periodStart: number;
  periodEnd: number;
  recognisedAmount: number;
  deferredBefore: number;
  deferredAfter: number;
  createdAt: number;
  type: 'scheduled' | 'accelerated' | 'partial';
}

/** Per-entry cumulative recognition progress recorded by a run. */
export interface EntryRecognitionProgress {
  periodStart: number;
  recognisedToDate: number;
}

export interface RevenueRecognitionRepository {
  /** Return all schedules where at least one entry is not yet recognised. */
  getPendingSchedules(): Promise<RevenueSchedule[]>;
  /** Persist a recognition journal entry. */
  writeJournalEntry(entry: RecognitionJournalEntry): Promise<void>;
  /** Update the deferred / recognised balances for a merchant. */
  updateMerchantBalances(
    merchantId: string,
    delta: { recognisedDelta: number; deferredDelta: number }
  ): Promise<void>;
  /** Mark individual schedule entries as recognised. */
  markEntriesRecognised(subscriptionId: string, entryPeriodStarts: number[]): Promise<void>;
  /**
   * Persist cumulative per-entry recognition progress.
   *
   * Optional. Without it a partially-elapsed entry cannot record how much of
   * itself it has already recognised, and the next run re-recognises the whole
   * elapsed portion — inflating recognised revenue on every run. When the
   * method is absent the job degrades to recognising each entry only once,
   * at its full amount, which is slower but never over-counts.
   */
  recordEntryProgress?(
    subscriptionId: string,
    progress: EntryRecognitionProgress[]
  ): Promise<void>;
}

export interface RecognitionJobMetrics {
  schedulesProcessed: number;
  entriesRecognised: number;
  totalAmountRecognised: number;
  errorCount: number;
  durationMs: number;
}

/** Monotonically increasing ID sequence (in-process only; use UUID in production). */
let _seq = 0;
function nextId(): string {
  return `rev-${Date.now().toString(36)}-${(++_seq).toString(36)}`;
}

/** Rounds to minor units, mapping non-finite input to zero. */
function roundMoney(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON * Math.sign(amount)) * 100) / 100;
}

/**
 * Determine how much of a single schedule entry to recognise as of `now`.
 * Returns 0 for entries that haven't started yet or amount = 0 (free trial).
 */
export function computeEntryRecognition(
  entry: RevenueScheduleEntry,
  now: number
): { amount: number; type: 'scheduled' | 'accelerated' | 'partial' | null } {
  if (entry.isRecognised) return { amount: 0, type: null };
  if (entry.recognisedAmount === 0) return { amount: 0, type: null }; // free trial
  if (now < entry.periodStart) return { amount: 0, type: null };

  if (now >= entry.periodEnd) {
    return { amount: entry.recognisedAmount, type: 'scheduled' };
  }

  // Pro-rate for partial periods.
  const elapsed = now - entry.periodStart;
  const duration = entry.periodEnd - entry.periodStart;
  const partial = (entry.recognisedAmount * elapsed) / duration;
  return { amount: Math.round(partial * 100) / 100, type: 'partial' };
}

export class MonthlyRevenueRecognitionJob {
  private repo: RevenueRecognitionRepository;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  // Prometheus-style counters.
  private metrics: RecognitionJobMetrics = {
    schedulesProcessed: 0,
    entriesRecognised: 0,
    totalAmountRecognised: 0,
    errorCount: 0,
    durationMs: 0,
  };

  constructor(
    repo: RevenueRecognitionRepository,
    options: { intervalMs?: number } = {}
  ) {
    this.repo = repo;
    this.intervalMs = options.intervalMs ?? 24 * 60 * 60 * 1000; // default: daily
  }

  start(): void {
    if (this.timer) return;
    void this.run();
    this.timer = setInterval(() => void this.run(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(now: number = Date.now()): Promise<RecognitionJobMetrics> {
    const start = Date.now();
    const localMetrics: RecognitionJobMetrics = {
      schedulesProcessed: 0,
      entriesRecognised: 0,
      totalAmountRecognised: 0,
      errorCount: 0,
      durationMs: 0,
    };

    let schedules: RevenueSchedule[] = [];
    try {
      schedules = await this.repo.getPendingSchedules();
    } catch (err) {
      console.error('[RevenueRecognitionJob] Failed to load schedules:', err);
      localMetrics.errorCount += 1;
      return localMetrics;
    }

    for (const schedule of schedules) {
      localMetrics.schedulesProcessed += 1;
      const recognisedPeriodStarts: number[] = [];
      const progressUpdates: EntryRecognitionProgress[] = [];
      let totalRecognisedForSchedule = 0;

      // Deferred revenue is what was contractually billed but not yet
      // recognised, i.e. the schedule total minus everything recognised on
      // prior runs and earlier in *this* run. Ignoring prior runs produced a
      // deferred balance that grew without bound.
      const previouslyRecognised = (schedule.entries ?? []).reduce(
        (sum, entry) => sum + (entry.recognisedToDate ?? 0),
        0
      );
      let recognisedSoFar = previouslyRecognised;

      const canTrackProgress = typeof this.repo.recordEntryProgress === 'function';

      for (const entry of schedule.entries) {
        const { amount: cumulativeTarget, type } = computeEntryRecognition(entry, now);
        if (!type || cumulativeTarget <= 0) continue;

        // Recognise only the increment since the last run. Recognising the
        // full elapsed portion again on every run is what compounded the
        // misstatement day after day.
        const alreadyRecognised = entry.recognisedToDate ?? 0;
        const amount = canTrackProgress
          ? roundMoney(Math.max(cumulativeTarget - alreadyRecognised, 0))
          : // Without progress tracking, only recognise an entry once its
            // period has fully elapsed, so it is never recognised twice.
            type === 'partial'
            ? 0
            : roundMoney(cumulativeTarget);

        if (amount <= 0) {
          if (type === 'scheduled' || type === 'accelerated') {
            // Already fully recognised on a prior run; close it out.
            recognisedPeriodStarts.push(entry.periodStart);
          }
          continue;
        }

        const deferredBefore = roundMoney(
          Math.max(schedule.totalAmount - recognisedSoFar, 0)
        );
        const journalEntry: RecognitionJournalEntry = {
          id: nextId(),
          subscriptionId: schedule.subscriptionId,
          merchantId: schedule.merchantId,
          periodStart: entry.periodStart,
          periodEnd: entry.periodEnd,
          recognisedAmount: amount,
          deferredBefore,
          // Deferred can never go negative: recognising more than was
          // deferred would be reported as an amount owed back to the merchant.
          deferredAfter: roundMoney(Math.max(deferredBefore - amount, 0)),
          createdAt: now,
          type,
        };

        try {
          await this.repo.writeJournalEntry(journalEntry);
          recognisedSoFar += amount;
          totalRecognisedForSchedule += amount;
          localMetrics.entriesRecognised += 1;
          localMetrics.totalAmountRecognised += amount;

          progressUpdates.push({
            periodStart: entry.periodStart,
            recognisedToDate: roundMoney(alreadyRecognised + amount),
          });

          // Only close out entries whose period has fully elapsed AND that
          // are now fully recognised.
          const recognisedTotal = roundMoney(alreadyRecognised + amount);
          if (
            type === 'scheduled' ||
            type === 'accelerated' ||
            recognisedTotal >= roundMoney(entry.recognisedAmount)
          ) {
            recognisedPeriodStarts.push(entry.periodStart);
          }
        } catch (err) {
          console.error(
            `[RevenueRecognitionJob] Journal write failed for ${schedule.subscriptionId}:`,
            err
          );
          localMetrics.errorCount += 1;
        }
      }

      if (totalRecognisedForSchedule > 0) {
        try {
          await this.repo.updateMerchantBalances(schedule.merchantId, {
            recognisedDelta: totalRecognisedForSchedule,
            deferredDelta: -totalRecognisedForSchedule,
          });
          if (progressUpdates.length > 0 && canTrackProgress) {
            await this.repo.recordEntryProgress!(
              schedule.subscriptionId,
              progressUpdates
            );
          }
          if (recognisedPeriodStarts.length > 0) {
            await this.repo.markEntriesRecognised(
              schedule.subscriptionId,
              recognisedPeriodStarts
            );
          }
        } catch (err) {
          console.error(
            `[RevenueRecognitionJob] Balance update failed for ${schedule.merchantId}:`,
            err
          );
          localMetrics.errorCount += 1;
        }
      }
    }

    localMetrics.durationMs = Date.now() - start;

    // Accumulate global metrics.
    this.metrics.schedulesProcessed += localMetrics.schedulesProcessed;
    this.metrics.entriesRecognised += localMetrics.entriesRecognised;
    this.metrics.totalAmountRecognised += localMetrics.totalAmountRecognised;
    this.metrics.errorCount += localMetrics.errorCount;
    this.metrics.durationMs = localMetrics.durationMs;

    console.info(
      `[RevenueRecognitionJob] Run complete: ${localMetrics.entriesRecognised} entries, $${localMetrics.totalAmountRecognised.toFixed(2)} recognised in ${localMetrics.durationMs}ms`
    );

    return localMetrics;
  }

  getMetrics(): RecognitionJobMetrics {
    return { ...this.metrics };
  }

  prometheusMetrics(): string {
    const lines = [
      '# HELP subtrackr_revenue_recognition_entries_total Total recognition journal entries written',
      '# TYPE subtrackr_revenue_recognition_entries_total counter',
      `subtrackr_revenue_recognition_entries_total ${this.metrics.entriesRecognised}`,
      '# HELP subtrackr_revenue_recognition_amount_total Total amount recognised in currency units',
      '# TYPE subtrackr_revenue_recognition_amount_total counter',
      `subtrackr_revenue_recognition_amount_total ${this.metrics.totalAmountRecognised.toFixed(2)}`,
      '# HELP subtrackr_revenue_recognition_errors_total Total errors during recognition runs',
      '# TYPE subtrackr_revenue_recognition_errors_total counter',
      `subtrackr_revenue_recognition_errors_total ${this.metrics.errorCount}`,
      '# HELP subtrackr_revenue_recognition_duration_ms Last job run duration in ms',
      '# TYPE subtrackr_revenue_recognition_duration_ms gauge',
      `subtrackr_revenue_recognition_duration_ms ${this.metrics.durationMs}`,
    ];
    return lines.join('\n');
  }
}
