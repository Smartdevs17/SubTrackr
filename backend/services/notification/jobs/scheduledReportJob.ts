/**
 * scheduledReportJob
 *
 * Wires ScheduledReportService into the JobScheduler so that due report
 * schedules are fired automatically on a configurable cadence.
 *
 * Design notes
 * ────────────
 * The job only triggers `service.runDue()`; all scheduling logic (which
 * schedules are due, what to send) lives entirely in the service. This keeps
 * the job file thin and the service independently testable.
 *
 * The `snapshotFactory` is injected so callers can plug in the live
 * SubscriptionAnalyticsService or a test stub.
 *
 * Registration
 * ────────────
 * Call `registerScheduledReportJob(scheduler, service, snapshotFactory)` once
 * at server boot (see server.ts). The job is registered under the name
 * `'scheduled-reports:run-due'` so it can be manually triggered via
 * `scheduler.fireNow('scheduled-reports:run-due')` in maintenance scripts.
 */

import type { JobScheduler } from '../../shared/queue/jobScheduler';
import type {
  ScheduledReportService,
  ReportAnalyticsSnapshot,
  RunDueSummary,
} from '../scheduledReportService';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Factory that returns an analytics snapshot for a given merchant. */
export type SnapshotFactory = (
  merchantId: string
) => ReportAnalyticsSnapshot | Promise<ReportAnalyticsSnapshot>;

export interface ScheduledReportJobOptions {
  /**
   * 6-field cron expression for the polling tick.
   * Defaults to every 15 minutes: '0 0/15 * * * *'
   */
  cron?: string;
  /** Skip the tick if the previous one is still running. Default: true. */
  skipIfRunning?: boolean;
}

export interface ScheduledReportJobHandle {
  /** Job name used with the scheduler — useful for fireNow() calls. */
  readonly jobName: string;
  /** Manually trigger a run-due pass — useful in tests and maintenance scripts. */
  runNow(): Promise<RunDueSummary>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const SCHEDULED_REPORT_JOB_NAME = 'scheduled-reports:run-due';
/** Poll every 15 minutes; fine-grained enough without hammering the DB. */
export const DEFAULT_REPORT_JOB_CRON = '0 0/15 * * * *';

// ─── Registration helper ──────────────────────────────────────────────────────

/**
 * Register the scheduled-report job with a JobScheduler.
 *
 * The enqueued payload is `{ triggeredAt: string }` — lightweight so the
 * WeightedFairQueue is not loaded with large analytics objects. The actual
 * work is done inside the queue handler (see `createScheduledReportHandler`).
 *
 * Returns a handle with `runNow()` for ad-hoc manual invocations.
 */
export function registerScheduledReportJob(
  scheduler: JobScheduler,
  service: ScheduledReportService,
  snapshotFactory: SnapshotFactory,
  options: ScheduledReportJobOptions = {}
): ScheduledReportJobHandle {
  const cron = options.cron ?? DEFAULT_REPORT_JOB_CRON;
  const skipIfRunning = options.skipIfRunning ?? true;

  scheduler.register<{ triggeredAt: string }>({
    name: SCHEDULED_REPORT_JOB_NAME,
    cron,
    priority: 'normal',
    jobName: SCHEDULED_REPORT_JOB_NAME,
    dataFactory: () => ({ triggeredAt: new Date().toISOString() }),
    description: 'Fire all scheduled email reports that are currently due',
    skipIfRunning,
  });

  return {
    jobName: SCHEDULED_REPORT_JOB_NAME,
    runNow: () => service.runDue(snapshotFactory),
  };
}

// ─── Lightweight poller (no queue dependency) ─────────────────────────────────

/**
 * Create a self-contained setInterval-based polling loop that calls
 * `service.runDue()` directly. Useful when a full WeightedFairQueue is not
 * set up (lightweight deployments, integration tests).
 *
 * Returns `{ stop, runNow }`.
 */
export function createScheduledReportPoller(
  service: ScheduledReportService,
  snapshotFactory: SnapshotFactory,
  intervalMs: number = 15 * 60 * 1_000
): { stop: () => void; runNow: () => Promise<RunDueSummary> } {
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const runNow = async (): Promise<RunDueSummary> => {
    if (running) {
      return { considered: 0, fired: 0, skipped: 0, results: [] };
    }
    running = true;
    try {
      const summary = await service.runDue(snapshotFactory);
      if (summary.fired > 0 || summary.skipped > 0) {
        console.info(
          `[ScheduledReportJob] fired=${summary.fired} skipped=${summary.skipped} considered=${summary.considered}`
        );
      }
      return summary;
    } catch (err) {
      console.error('[ScheduledReportJob] runDue error:', err);
      return { considered: 0, fired: 0, skipped: 0, results: [] };
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void runNow(), intervalMs);
  // Allow the process to exit cleanly even when the timer is live.
  timer.unref();

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    runNow,
  };
}

// ─── WeightedFairQueue handler factory ───────────────────────────────────────

/**
 * Build a queue handler for `SCHEDULED_REPORT_JOB_NAME`.
 *
 * Usage in server bootstrap:
 *   queue.registerHandler(
 *     SCHEDULED_REPORT_JOB_NAME,
 *     createScheduledReportHandler(service, snapshotFactory)
 *   );
 */
export function createScheduledReportHandler(
  service: ScheduledReportService,
  snapshotFactory: SnapshotFactory
): (data: { triggeredAt: string }) => Promise<void> {
  return async (data) => {
    console.info(`[ScheduledReportJob] processing due reports (triggered at ${data.triggeredAt})`);
    const summary = await service.runDue(snapshotFactory);
    console.info(
      `[ScheduledReportJob] done — fired=${summary.fired} skipped=${summary.skipped} considered=${summary.considered}`
    );
  };
}
