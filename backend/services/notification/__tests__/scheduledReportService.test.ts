/**
 * Unit tests for scheduledReportService.ts
 *
 * Covers:
 *  - nextSendAt() for every frequency
 *  - createSchedule() validation and persistence
 *  - getSchedule / listSchedules
 *  - updateSchedule() including frequency-driven nextSendAt recompute
 *  - deleteSchedule()
 *  - addRecipients() / removeRecipients() management
 *  - buildReportEmail() rendering for each ReportType
 *  - sendReport() happy path, partial failures, and post-send timestamp advance
 *  - runDue() skips disabled / no-recipient schedules, collects results
 *  - InMemoryReportStore.findDue() respects enabled flag and nextSendAt
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  ScheduledReportService,
  InMemoryReportStore,
  nextSendAt,
  createScheduledReportService,
  REPORT_FREQUENCIES,
  REPORT_TYPES,
  type ReportAnalyticsSnapshot,
  type ScheduledReport,
  type CreateScheduledReportInput,
} from '../scheduledReportService';
import type { EmailMessage, EmailResult, EmailProvider } from '../emailProvider';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date('2026-03-15T09:00:00.000Z');

function makeSnapshot(overrides: Partial<ReportAnalyticsSnapshot> = {}): ReportAnalyticsSnapshot {
  return {
    merchantId: 'merch_1',
    merchantName: 'Acme Corp',
    mrr: 10_000,
    arr: 120_000,
    mrrGrowthRate: 0.05,
    activeSubscribers: 250,
    newSubscribersThisPeriod: 12,
    churned: 3,
    grossChurnRate: 0.012,
    netChurnRate: 0.008,
    arpu: 40,
    ltv: 480,
    currencySymbol: '$',
    periodStart: '2026-03-01T00:00:00Z',
    periodEnd: '2026-03-15T00:00:00Z',
    ...overrides,
  };
}

function makeInput(overrides: Partial<CreateScheduledReportInput> = {}): CreateScheduledReportInput {
  return {
    merchantId: 'merch_1',
    name: 'Weekly Summary',
    reportType: 'analytics_summary',
    frequency: 'weekly',
    recipients: ['alice@example.com'],
    ...overrides,
  };
}

let emailsSent: EmailMessage[];

function makeEmailProvider(alwaysSucceed = true): EmailProvider {
  return {
    providerName: 'stub',
    send: async (msg: EmailMessage): Promise<EmailResult> => {
      emailsSent.push(msg);
      if (!alwaysSucceed && emailsSent.length === 2) {
        return { success: false, provider: 'stub', error: 'Mailbox full' };
      }
      return { success: true, provider: 'stub', messageId: `mid_${emailsSent.length}` };
    },
  };
}

function makeService(opts: { succeed?: boolean; store?: InMemoryReportStore } = {}): ScheduledReportService {
  return createScheduledReportService({
    emailProvider: makeEmailProvider(opts.succeed ?? true),
    fromAddress: 'reports@subtrackr.io',
    store: opts.store,
    now: () => NOW,
  });
}

// ─── nextSendAt ───────────────────────────────────────────────────────────────

describe('nextSendAt', () => {
  it('adds 1 day for daily', () => {
    const next = nextSendAt(new Date('2026-03-15T09:30:00Z'), 'daily');
    expect(next.toISOString()).toBe('2026-03-16T09:00:00.000Z');
  });

  it('adds 7 days for weekly', () => {
    const next = nextSendAt(new Date('2026-03-15T09:30:00Z'), 'weekly');
    expect(next.toISOString()).toBe('2026-03-22T09:00:00.000Z');
  });

  it('adds 1 month for monthly', () => {
    const next = nextSendAt(new Date('2026-03-15T09:30:00Z'), 'monthly');
    expect(next.toISOString()).toBe('2026-04-15T09:00:00.000Z');
  });

  it('normalises to start of hour (zeroes minutes/seconds/ms)', () => {
    const next = nextSendAt(new Date('2026-03-15T09:59:59.999Z'), 'daily');
    expect(next.getUTCMinutes()).toBe(0);
    expect(next.getUTCSeconds()).toBe(0);
    expect(next.getUTCMilliseconds()).toBe(0);
  });
});

// ─── InMemoryReportStore ──────────────────────────────────────────────────────

describe('InMemoryReportStore', () => {
  let store: InMemoryReportStore;

  beforeEach(() => {
    store = new InMemoryReportStore();
  });

  function stubReport(overrides: Partial<ScheduledReport> = {}): ScheduledReport {
    return {
      id: 'sr_1',
      merchantId: 'merch_1',
      name: 'Test',
      reportType: 'analytics_summary',
      frequency: 'weekly',
      recipients: ['test@example.com'],
      lastSentAt: null,
      nextSendAt: '2026-03-15T08:00:00.000Z', // in the past relative to NOW
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('save and findById round-trip', () => {
    const r = stubReport();
    store.save(r);
    expect(store.findById('sr_1')).toEqual(r);
  });

  it('findByMerchant filters by merchantId', () => {
    store.save(stubReport({ id: 'sr_1', merchantId: 'merch_1' }));
    store.save(stubReport({ id: 'sr_2', merchantId: 'merch_2' }));
    expect(store.findByMerchant('merch_1')).toHaveLength(1);
    expect(store.findByMerchant('merch_1')[0]?.id).toBe('sr_1');
  });

  it('findDue returns schedules where nextSendAt <= now and enabled', () => {
    store.save(stubReport({ id: 'due', nextSendAt: '2026-03-15T08:00:00.000Z', enabled: true }));
    store.save(stubReport({ id: 'future', nextSendAt: '2026-03-20T00:00:00.000Z', enabled: true }));
    store.save(stubReport({ id: 'disabled', nextSendAt: '2026-03-01T00:00:00.000Z', enabled: false }));
    const due = store.findDue(NOW);
    expect(due.map((r) => r.id)).toEqual(['due']);
  });

  it('delete removes the record', () => {
    store.save(stubReport());
    expect(store.delete('sr_1')).toBe(true);
    expect(store.findById('sr_1')).toBeUndefined();
  });

  it('delete returns false for unknown id', () => {
    expect(store.delete('ghost')).toBe(false);
  });
});

// ─── createSchedule ───────────────────────────────────────────────────────────

describe('ScheduledReportService.createSchedule', () => {
  beforeEach(() => { emailsSent = []; });

  it('persists a new schedule with a future nextSendAt', () => {
    const svc = makeService();
    const schedule = svc.createSchedule(makeInput());
    expect(schedule.id).toBeTruthy();
    expect(schedule.enabled).toBe(true);
    expect(new Date(schedule.nextSendAt).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('normalises recipient emails to lowercase', () => {
    const svc = makeService();
    const schedule = svc.createSchedule(makeInput({ recipients: ['Alice@Example.COM'] }));
    expect(schedule.recipients).toEqual(['alice@example.com']);
  });

  it('deduplicates recipients', () => {
    const svc = makeService();
    const schedule = svc.createSchedule(
      makeInput({ recipients: ['a@example.com', 'a@example.com', 'b@example.com'] })
    );
    expect(schedule.recipients).toHaveLength(2);
  });

  it('throws for missing merchantId', () => {
    const svc = makeService();
    expect(() => svc.createSchedule(makeInput({ merchantId: '' }))).toThrow('merchantId is required');
  });

  it('throws for empty name', () => {
    const svc = makeService();
    expect(() => svc.createSchedule(makeInput({ name: '  ' }))).toThrow('name is required');
  });

  it('throws for invalid reportType', () => {
    const svc = makeService();
    expect(() =>
      svc.createSchedule(makeInput({ reportType: 'bad_type' as never }))
    ).toThrow('Invalid reportType');
  });

  it('throws for invalid frequency', () => {
    const svc = makeService();
    expect(() =>
      svc.createSchedule(makeInput({ frequency: 'hourly' as never }))
    ).toThrow('Invalid frequency');
  });

  it('throws for empty recipients array', () => {
    const svc = makeService();
    expect(() => svc.createSchedule(makeInput({ recipients: [] }))).toThrow('At least one recipient');
  });

  it('throws for invalid email in recipients', () => {
    const svc = makeService();
    expect(() =>
      svc.createSchedule(makeInput({ recipients: ['not-an-email'] }))
    ).toThrow('Invalid email address');
  });
});

// ─── getSchedule / listSchedules ─────────────────────────────────────────────

describe('ScheduledReportService get / list', () => {
  beforeEach(() => { emailsSent = []; });

  it('getSchedule returns null for unknown id', () => {
    const svc = makeService();
    expect(svc.getSchedule('nope')).toBeNull();
  });

  it("listSchedules returns only the merchant's schedules", () => {
    const svc = makeService();
    svc.createSchedule(makeInput({ merchantId: 'merch_1' }));
    svc.createSchedule(makeInput({ merchantId: 'merch_2' }));
    expect(svc.listSchedules('merch_1')).toHaveLength(1);
  });
});

// ─── updateSchedule ──────────────────────────────────────────────────────────

describe('ScheduledReportService.updateSchedule', () => {
  beforeEach(() => { emailsSent = []; });

  it('updates the name', () => {
    const svc = makeService();
    const { id } = svc.createSchedule(makeInput());
    const updated = svc.updateSchedule(id, { name: 'New Name' });
    expect(updated.name).toBe('New Name');
  });

  it('disables a schedule', () => {
    const svc = makeService();
    const { id } = svc.createSchedule(makeInput());
    const updated = svc.updateSchedule(id, { enabled: false });
    expect(updated.enabled).toBe(false);
  });

  it('recomputes nextSendAt when frequency changes', () => {
    const svc = makeService();
    const { id, nextSendAt: before } = svc.createSchedule(makeInput({ frequency: 'weekly' }));
    const updated = svc.updateSchedule(id, { frequency: 'monthly' });
    expect(updated.frequency).toBe('monthly');
    expect(updated.nextSendAt).not.toBe(before);
  });

  it('throws for unknown id', () => {
    const svc = makeService();
    expect(() => svc.updateSchedule('ghost', { name: 'X' })).toThrow('not found');
  });

  it('throws for invalid reportType', () => {
    const svc = makeService();
    const { id } = svc.createSchedule(makeInput());
    expect(() => svc.updateSchedule(id, { reportType: 'nope' as never })).toThrow('Invalid reportType');
  });
});

// ─── deleteSchedule ───────────────────────────────────────────────────────────

describe('ScheduledReportService.deleteSchedule', () => {
  beforeEach(() => { emailsSent = []; });

  it('returns true when found and deleted', () => {
    const svc = makeService();
    const { id } = svc.createSchedule(makeInput());
    expect(svc.deleteSchedule(id)).toBe(true);
    expect(svc.getSchedule(id)).toBeNull();
  });

  it('returns false when not found', () => {
    const svc = makeService();
    expect(svc.deleteSchedule('ghost')).toBe(false);
  });
});

// ─── Recipient management ─────────────────────────────────────────────────────

describe('ScheduledReportService recipient management', () => {
  beforeEach(() => { emailsSent = []; });

  it('addRecipients merges new addresses without duplicates', () => {
    const svc = makeService();
    const { id } = svc.createSchedule(makeInput({ recipients: ['a@example.com'] }));
    const updated = svc.addRecipients(id, ['b@example.com', 'a@example.com']);
    expect(updated.recipients).toHaveLength(2);
    expect(updated.recipients).toContain('b@example.com');
  });

  it('addRecipients silently drops invalid email formats', () => {
    const svc = makeService();
    const { id } = svc.createSchedule(makeInput({ recipients: ['a@example.com'] }));
    const updated = svc.addRecipients(id, ['not-valid', 'b@example.com']);
    expect(updated.recipients).not.toContain('not-valid');
    expect(updated.recipients).toContain('b@example.com');
  });

  it('addRecipients throws for unknown schedule id', () => {
    const svc = makeService();
    expect(() => svc.addRecipients('ghost', ['x@example.com'])).toThrow('not found');
  });

  it('removeRecipients removes specified addresses', () => {
    const svc = makeService();
    const { id } = svc.createSchedule(
      makeInput({ recipients: ['a@example.com', 'b@example.com'] })
    );
    const updated = svc.removeRecipients(id, ['a@example.com']);
    expect(updated.recipients).toEqual(['b@example.com']);
  });

  it('removeRecipients throws for unknown schedule id', () => {
    const svc = makeService();
    expect(() => svc.removeRecipients('ghost', ['x@example.com'])).toThrow('not found');
  });
});

// ─── buildReportEmail ────────────────────────────────────────────────────────

describe('ScheduledReportService.buildReportEmail', () => {
  beforeEach(() => { emailsSent = []; });

  const svc = makeService();

  function makeSchedule(overrides: Partial<ScheduledReport> = {}): ScheduledReport {
    return {
      id: 'sr_x',
      merchantId: 'merch_1',
      name: 'Test',
      reportType: 'analytics_summary',
      frequency: 'weekly',
      recipients: ['r@example.com'],
      lastSentAt: null,
      nextSendAt: '2026-03-22T09:00:00.000Z',
      enabled: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      ...overrides,
    };
  }

  it('includes a non-empty subject', () => {
    const { subject } = svc.buildReportEmail(makeSchedule(), makeSnapshot());
    expect(subject).toBeTruthy();
    expect(subject).toContain('SubTrackr');
  });

  it('subject contains the merchant name', () => {
    const { subject } = svc.buildReportEmail(makeSchedule(), makeSnapshot({ merchantName: 'Acme Corp' }));
    expect(subject).toContain('Acme Corp');
  });

  it('text and html are both populated', () => {
    const { text, html } = svc.buildReportEmail(makeSchedule(), makeSnapshot());
    expect(text.length).toBeGreaterThan(50);
    expect(html).toContain('<');
  });

  for (const reportType of REPORT_TYPES) {
    it(`renders valid content for reportType=${reportType}`, () => {
      const { text, html } = svc.buildReportEmail(makeSchedule({ reportType }), makeSnapshot());
      expect(text.length).toBeGreaterThan(10);
      expect(html.length).toBeGreaterThan(10);
    });
  }

  it('escapes HTML special characters in merchant name', () => {
    const { html } = svc.buildReportEmail(
      makeSchedule(),
      makeSnapshot({ merchantName: '<Evil & "Co">' })
    );
    expect(html).not.toContain('<Evil');
    expect(html).toContain('&lt;Evil');
  });
});

// ─── sendReport ───────────────────────────────────────────────────────────────

describe('ScheduledReportService.sendReport', () => {
  beforeEach(() => { emailsSent = []; });

  it('sends one email per recipient', async () => {
    const svc = makeService();
    const schedule = svc.createSchedule(
      makeInput({ recipients: ['a@example.com', 'b@example.com'] })
    );
    const result = await svc.sendReport(schedule, makeSnapshot());
    expect(emailsSent).toHaveLength(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('records partial failures without throwing', async () => {
    const svc = makeService({ succeed: false });
    const schedule = svc.createSchedule(
      makeInput({ recipients: ['a@example.com', 'b@example.com'] })
    );
    const result = await svc.sendReport(schedule, makeSnapshot());
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0]?.recipient).toBe('b@example.com');
  });

  it('advances lastSentAt and nextSendAt after sending', async () => {
    const store = new InMemoryReportStore();
    const svc = makeService({ store });
    const { id } = svc.createSchedule(makeInput());
    const before = svc.getSchedule(id)!;
    await svc.sendReport(before, makeSnapshot());
    const after = svc.getSchedule(id)!;
    expect(after.lastSentAt).toBe(NOW.toISOString());
    expect(new Date(after.nextSendAt).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('sets sentAt in the result', async () => {
    const svc = makeService();
    const schedule = svc.createSchedule(makeInput());
    const result = await svc.sendReport(schedule, makeSnapshot());
    expect(result.sentAt).toBe(NOW.toISOString());
  });
});

// ─── runDue ───────────────────────────────────────────────────────────────────

describe('ScheduledReportService.runDue', () => {
  beforeEach(() => { emailsSent = []; });

  const PAST = new Date(NOW.getTime() - 60_000); // 1 minute ago

  function makeServiceWithPastSchedules(): ScheduledReportService {
    return createScheduledReportService({
      emailProvider: makeEmailProvider(true),
      fromAddress: 'reports@subtrackr.io',
      now: () => NOW,
    });
  }

  it('fires all due and enabled schedules', async () => {
    const svc = makeServiceWithPastSchedules();
    // Create a schedule and manually back-date its nextSendAt so runDue picks it up.
    const { id } = svc.createSchedule(makeInput({ recipients: ['a@example.com'] }));
    // Mutate via updateSchedule — use a custom store to reach the record directly.
    const store = new InMemoryReportStore();
    const svc2 = createScheduledReportService({
      emailProvider: makeEmailProvider(true),
      fromAddress: 'reports@subtrackr.io',
      store,
      now: () => NOW,
    });
    const s = svc2.createSchedule(makeInput({ recipients: ['a@example.com'] }));
    // Back-date by writing directly to the store.
    store.save({ ...s, nextSendAt: PAST.toISOString() });

    const snapshot = makeSnapshot();
    const summary = await svc2.runDue(() => snapshot);
    expect(summary.fired).toBe(1);
    expect(summary.considered).toBe(1);
    expect(emailsSent).toHaveLength(1);
  });

  it('skips schedules with no recipients', async () => {
    const store = new InMemoryReportStore();
    const svc = createScheduledReportService({
      emailProvider: makeEmailProvider(true),
      fromAddress: 'reports@subtrackr.io',
      store,
      now: () => NOW,
    });
    const s = svc.createSchedule(makeInput({ recipients: ['a@example.com'] }));
    // Remove all recipients and back-date.
    store.save({ ...s, recipients: [], nextSendAt: PAST.toISOString() });

    const summary = await svc.runDue(() => makeSnapshot());
    expect(summary.skipped).toBe(1);
    expect(summary.fired).toBe(0);
    expect(emailsSent).toHaveLength(0);
  });

  it('does not fire disabled schedules', async () => {
    const store = new InMemoryReportStore();
    const svc = createScheduledReportService({
      emailProvider: makeEmailProvider(true),
      fromAddress: 'reports@subtrackr.io',
      store,
      now: () => NOW,
    });
    const s = svc.createSchedule(makeInput({ recipients: ['a@example.com'] }));
    store.save({ ...s, enabled: false, nextSendAt: PAST.toISOString() });

    const summary = await svc.runDue(() => makeSnapshot());
    // Disabled schedules are not returned by findDue, so considered=0.
    expect(summary.considered).toBe(0);
  });

  it('catches snapshot errors and records them without stopping other schedules', async () => {
    const store = new InMemoryReportStore();
    const svc = createScheduledReportService({
      emailProvider: makeEmailProvider(true),
      fromAddress: 'reports@subtrackr.io',
      store,
      now: () => NOW,
    });
    const s1 = svc.createSchedule(makeInput({ merchantId: 'bad', recipients: ['a@example.com'] }));
    const s2 = svc.createSchedule(makeInput({ merchantId: 'good', recipients: ['b@example.com'] }));
    store.save({ ...s1, nextSendAt: PAST.toISOString() });
    store.save({ ...s2, nextSendAt: PAST.toISOString() });

    const snapshotFactory = async (merchantId: string) => {
      if (merchantId === 'bad') throw new Error('analytics unavailable');
      return makeSnapshot({ merchantId });
    };

    const summary = await svc.runDue(snapshotFactory);
    expect(summary.considered).toBe(2);
    // One errored (recorded as a failed result), one succeeded.
    expect(summary.results).toHaveLength(2);
    const badResult = summary.results.find((r) => r.reportId === s1.id);
    expect(badResult?.failed).toBeGreaterThan(0);
  });

  it('returns an empty summary when nothing is due', async () => {
    const svc = makeService();
    const summary = await svc.runDue(() => makeSnapshot());
    expect(summary.considered).toBe(0);
    expect(summary.fired).toBe(0);
  });
});
