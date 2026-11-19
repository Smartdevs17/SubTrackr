/**
 * overdueInvoiceReminderJob (#1737)
 *
 * Wires OverdueInvoiceReminderService into the JobScheduler and provides a
 * lightweight setInterval poller, mirroring scheduledReportJob.ts.
 *
 * The job only triggers `service.runDue(source)`; stage selection, escalation
 * and stop-on-payment decisions all live in the service.
 *
 * The reminder cadence itself is configured on the schedule (stages), while
 * the poll interval only controls how promptly a due stage is picked up.
 */

import type { JobScheduler } from '../../shared/queue/jobScheduler';
import type {
  OverdueInvoiceReminderService,
  OverdueInvoiceSource,
  OverdueReminderRunSummary,
} from '../overdueInvoiceReminderService';

export interface OverdueReminderJobOptions {
  /** 6-field cron expression for the polling tick. Defaults to every 30 minutes. */
  cron?: string;
  /** Skip the tick if the previous one is still running. Default: true. */
  skipIfRunning?: boolean;
}

export interface OverdueReminderJobHandle {
  readonly jobName: string;
  runNow(): Promise<OverdueReminderRunSummary>;
}

export const OVERDUE_REMINDER_JOB_NAME = 'overdue-invoices:send-reminders';
export const DEFAULT_OVERDUE_REMINDER_JOB_CRON = '0 0/30 * * * *';
export const DEFAULT_OVERDUE_REMINDER_POLL_MS = 30 * 60 * 1_000;

export function registerOverdueReminderJob(
  scheduler: JobScheduler,
  service: OverdueInvoiceReminderService,
  source: OverdueInvoiceSource,
  options: OverdueReminderJobOptions = {}
): OverdueReminderJobHandle {
  const cron = options.cron ?? DEFAULT_OVERDUE_REMINDER_JOB_CRON;
  const skipIfRunning = options.skipIfRunning ?? true;

  scheduler.register<{ triggeredAt: string }>({
    name: OVERDUE_REMINDER_JOB_NAME,
    cron,
    priority: 'high',
    jobName: OVERDUE_REMINDER_JOB_NAME,
    dataFactory: () => ({ triggeredAt: new Date().toISOString() }),
    description: 'Send escalating reminders for invoices that are past due',
    skipIfRunning,
  });

  return {
    jobName: OVERDUE_REMINDER_JOB_NAME,
    runNow: () => service.runDue(source),
  };
}

export function createOverdueReminderPoller(
  service: OverdueInvoiceReminderService,
  source: OverdueInvoiceSource,
  intervalMs: number = DEFAULT_OVERDUE_REMINDER_POLL_MS
): { stop: () => void; runNow: () => Promise<OverdueReminderRunSummary> } {
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const runNow = async (): Promise<OverdueReminderRunSummary> => {
    if (running) {
      return {
        now: new Date().toISOString(),
        invoicesConsidered: 0,
        entriesCreated: 0,
        remindersSent: 0,
        entriesStopped: 0,
        skipped: 0,
        errors: [],
      };
    }
    running = true;
    try {
      const summary = await service.runDue(source);
      if (summary.remindersSent > 0 || summary.entriesStopped > 0 || summary.errors.length > 0) {
        console.info(
          `[OverdueInvoiceReminder] sent=${summary.remindersSent} stopped=${summary.entriesStopped} ` +
            `created=${summary.entriesCreated} considered=${summary.invoicesConsidered} errors=${summary.errors.length}`
        );
      }
      return summary;
    } catch (err) {
      console.error('[OverdueInvoiceReminder] runDue error:', err);
      return {
        now: new Date().toISOString(),
        invoicesConsidered: 0,
        entriesCreated: 0,
        remindersSent: 0,
        entriesStopped: 0,
        skipped: 0,
        errors: [],
      };
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void runNow(), intervalMs);
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

export function createOverdueReminderHandler(
  service: OverdueInvoiceReminderService,
  source: OverdueInvoiceSource
): (data: { triggeredAt: string }) => Promise<void> {
  return async (data) => {
    console.info(
      `[OverdueInvoiceReminder] processing due reminders (triggered at ${data.triggeredAt})`
    );
    const summary = await service.runDue(source);
    console.info(
      `[OverdueInvoiceReminder] done — sent=${summary.remindersSent} stopped=${summary.entriesStopped} ` +
        `created=${summary.entriesCreated} considered=${summary.invoicesConsidered}`
    );
  };
}
