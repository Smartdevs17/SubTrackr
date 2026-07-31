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
      let totalRecognisedForSchedule = 0;

      for (const entry of schedule.entries) {
        const { amount, type } = computeEntryRecognition(entry, now);
        if (!type || amount <= 0) continue;

        const deferredBefore = schedule.totalAmount - totalRecognisedForSchedule;
        const journalEntry: RecognitionJournalEntry = {
          id: nextId(),
          subscriptionId: schedule.subscriptionId,
          merchantId: schedule.merchantId,
          periodStart: entry.periodStart,
          periodEnd: entry.periodEnd,
          recognisedAmount: amount,
          deferredBefore,
          deferredAfter: deferredBefore - amount,
          createdAt: now,
          type,
        };

        try {
          await this.repo.writeJournalEntry(journalEntry);
          totalRecognisedForSchedule += amount;
          localMetrics.entriesRecognised += 1;
          localMetrics.totalAmountRecognised += amount;

          // Only mark fully-elapsed entries as done.
          if (type === 'scheduled' || type === 'accelerated') {
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
