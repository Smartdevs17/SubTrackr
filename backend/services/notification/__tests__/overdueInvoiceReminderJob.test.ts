/**
 * Unit tests for overdueInvoiceReminderJob.ts (#1737)
 *
 * Covers:
 *  - registerOverdueReminderJob: registers with the scheduler and returns a
 *    handle whose runNow() delegates to the service
 *  - createOverdueReminderPoller: interval ticking, re-entrancy guard, error
 *    containment, stop()
 *  - createOverdueReminderHandler: runs a pass for the scheduled payload
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { JobScheduler } from '../../../shared/queue/jobScheduler';
import type {
  OverdueInvoiceReminderService,
  OverdueReminderRunSummary,
} from '../overdueInvoiceReminderService';
import {
  registerOverdueReminderJob,
  createOverdueReminderPoller,
  createOverdueReminderHandler,
  OVERDUE_REMINDER_JOB_NAME,
  DEFAULT_OVERDUE_REMINDER_JOB_CRON,
} from '../jobs/overdueInvoiceReminderJob';

function summary(overrides: Partial<OverdueReminderRunSummary> = {}): OverdueReminderRunSummary {
  return {
    now: new Date().toISOString(),
    invoicesConsidered: 0,
    entriesCreated: 0,
    remindersSent: 0,
    entriesStopped: 0,
    skipped: 0,
    errors: [],
    ...overrides,
  };
}

function fakeService(
  runDue: jest.Mock<Promise<OverdueReminderRunSummary>, [unknown]>
): OverdueInvoiceReminderService {
  return { runDue } as unknown as OverdueInvoiceReminderService;
}

// ─── registerOverdueReminderJob ───────────────────────────────────────────────

describe('registerOverdueReminderJob', () => {
  it('registers a high-priority job with the default cron and returns a handle', () => {
    const registered: Array<Record<string, unknown>> = [];
    const scheduler = {
      register: jest.fn((def: Record<string, unknown>) => {
        registered.push(def);
      }),
    } as unknown as JobScheduler;
    const runDue = jest.fn(async () => summary({ remindersSent: 1 }));
    const service = fakeService(runDue);
    const source = () => [];

    const handle = registerOverdueReminderJob(scheduler, service, source);

    expect(handle.jobName).toBe(OVERDUE_REMINDER_JOB_NAME);
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      name: OVERDUE_REMINDER_JOB_NAME,
      cron: DEFAULT_OVERDUE_REMINDER_JOB_CRON,
      priority: 'high',
      skipIfRunning: true,
    });
  });

  it('honours custom cron and skipIfRunning options', () => {
    const registered: Array<Record<string, unknown>> = [];
    const scheduler = {
      register: jest.fn((def: Record<string, unknown>) => {
        registered.push(def);
      }),
    } as unknown as JobScheduler;

    registerOverdueReminderJob(
      scheduler,
      fakeService(jest.fn(async () => summary())),
      () => [],
      { cron: '0 0 9 * * *', skipIfRunning: false }
    );

    expect(registered[0]).toMatchObject({ cron: '0 0 9 * * *', skipIfRunning: false });
  });

  it('runNow delegates to the service with the configured source', async () => {
    const runDue = jest.fn(async () => summary({ remindersSent: 2 }));
    const source = () => [];
    const handle = registerOverdueReminderJob(
      { register: jest.fn() } as unknown as JobScheduler,
      fakeService(runDue),
      source
    );

    const result = await handle.runNow();
    expect(result.remindersSent).toBe(2);
    expect(runDue).toHaveBeenCalledTimes(1);
    expect(runDue).toHaveBeenCalledWith(source);
  });
});

// ─── createOverdueReminderPoller ──────────────────────────────────────────────

describe('createOverdueReminderPoller', () => {
  it('runs on demand and stops cleanly', async () => {
    const runDue = jest.fn(async () => summary({ entriesCreated: 1 }));
    const poller = createOverdueReminderPoller(fakeService(runDue), () => [], 60_000);

    const result = await poller.runNow();
    expect(result.entriesCreated).toBe(1);
    expect(runDue).toHaveBeenCalledTimes(1);

    poller.stop();
  });

  it('ticks on the interval', async () => {
    jest.useFakeTimers();
    try {
      const runDue = jest.fn(async () => summary());
      const poller = createOverdueReminderPoller(fakeService(runDue), () => [], 1_000);

      await jest.advanceTimersByTimeAsync(3_500);
      expect(runDue).toHaveBeenCalledTimes(3);

      poller.stop();
      await jest.advanceTimersByTimeAsync(5_000);
      expect(runDue).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('guards against re-entrant runs', async () => {
    let release: (value: OverdueReminderRunSummary) => void = () => undefined;
    const runDue = jest.fn(
      () =>
        new Promise<OverdueReminderRunSummary>((resolve) => {
          release = resolve;
        })
    );
    const poller = createOverdueReminderPoller(fakeService(runDue), () => [], 60_000);

    const first = poller.runNow();
    const second = await poller.runNow();
    expect(second.remindersSent).toBe(0);
    expect(runDue).toHaveBeenCalledTimes(1);

    release(summary({ remindersSent: 1 }));
    const firstResult = await first;
    expect(firstResult.remindersSent).toBe(1);
    poller.stop();
  });

  it('contains runDue failures in the summary shape', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const runDue = jest.fn(async () => {
        throw new Error('db down');
      });
      const poller = createOverdueReminderPoller(fakeService(runDue), () => [], 60_000);

      const result = await poller.runNow();
      expect(result).toMatchObject({ invoicesConsidered: 0, errors: [] });
    } finally {
      jest.restoreAllMocks();
    }
  });
});

// ─── createOverdueReminderHandler ─────────────────────────────────────────────

describe('createOverdueReminderHandler', () => {
  it('runs a pass for the scheduled payload', async () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const runDue = jest.fn(async () => summary({ remindersSent: 3 }));
      const handler = createOverdueReminderHandler(fakeService(runDue), () => []);

      await handler({ triggeredAt: '2026-03-15T09:00:00.000Z' });

      expect(runDue).toHaveBeenCalledTimes(1);
    } finally {
      jest.restoreAllMocks();
    }
  });
});
