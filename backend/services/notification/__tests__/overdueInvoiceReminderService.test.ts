/**
 * Unit tests for overdueInvoiceReminderService.ts (#1737)
 *
 * Covers:
 *  - stage helpers: stageDueAt, daysOverdueAt, overduePhrase, stopReasonForStatus
 *  - validateStages / resolveRecipients / initialStageIndex
 *  - configurable schedule CRUD (create, update, delete) and validation
 *  - runDue: discovery, stage scheduling, escalation, completion
 *  - runDue: stops on payment, on disappearance, on disabled/deleted schedule
 *  - runDue: delivery failure retry and stage skip after MAX_STAGE_ATTEMPTS
 *  - the minimum gap between two reminders for the same invoice
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  OverdueInvoiceReminderService,
  InMemoryScheduleStore,
  InMemoryEntryStore,
  createOverdueInvoiceReminderService,
  DEFAULT_OVERDUE_REMINDER_STAGES,
  MAX_REMINDER_STAGES,
  FAILURE_RETRY_MS,
  MAX_STAGE_ATTEMPTS,
  MIN_REMINDER_GAP_MS,
  stageDueAt,
  daysOverdueAt,
  overduePhrase,
  stopReasonForStatus,
  validateStages,
  resolveRecipients,
  initialStageIndex,
  type OverdueInvoice,
  type OverdueInvoiceSource,
  type OverdueReminderEntry,
  type OverdueReminderSchedule,
} from '../overdueInvoiceReminderService';
import type { EmailMessage, EmailResult, EmailProvider } from '../emailProvider';

// The real template module pulls in the ESM-only workspace package
// `@subtrackr/notification-providers`, which the backend's CJS jest config
// cannot parse. Mirror the real `invoice_overdue` subject/body so the tests
// still assert the rendered output shape.
jest.mock('../transactionalEmailTemplates', () => ({
  renderTransactionalEmail: (
    templateId: string,
    vars: Record<string, string>
  ) => {
    const subject = `${vars['escalation_label']}: invoice ${vars['invoice_number']} is ${vars['overdue_phrase']} overdue`;
    const text =
      `Invoice ${vars['invoice_number']} for ${vars['subscription_name']} was due on ` +
      `${vars['due_date']} and is now ${vars['overdue_phrase']} overdue. ` +
      `Amount outstanding: ${vars['currency']} ${vars['amount']}.`;
    return { subject, plainSubject: subject, text, html: `<p>${text}</p>` };
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function toAddress(message: EmailMessage): { email: string } {
  return Array.isArray(message.to) ? message.to[0] : message.to;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MERCHANT = 'merch_1';

let clock = new Date('2026-03-14T06:00:00.000Z');
let emailsSent: EmailMessage[] = [];
let failDelivery = false;

function makeEmailProvider(): EmailProvider {
  return {
    providerName: 'stub',
    send: async (message: EmailMessage): Promise<EmailResult> => {
      emailsSent.push(message);
      if (failDelivery) {
        return { success: false, provider: 'stub', error: 'Mailbox full' };
      }
      return { success: true, provider: 'stub', messageId: `mid_${emailsSent.length}` };
    },
  };
}

interface Harness {
  service: OverdueInvoiceReminderService;
  schedules: InMemoryScheduleStore;
  entries: InMemoryEntryStore;
}

function makeHarness(): Harness {
  const schedules = new InMemoryScheduleStore();
  const entries = new InMemoryEntryStore();
  const service = createOverdueInvoiceReminderService({
    emailProvider: makeEmailProvider(),
    fromAddress: 'billing@subtrackr.com',
    supportEmail: 'support@subtrackr.io',
    merchantName: 'Acme Corp',
    scheduleStore: schedules,
    entryStore: entries,
    now: () => clock,
  });
  return { service, schedules, entries };
}

function makeInvoice(overrides: Partial<OverdueInvoice> = {}): OverdueInvoice {
  return {
    id: 'inv_1001',
    invoiceNumber: 'INV-1001',
    merchantId: MERCHANT,
    customerName: 'Dana Lee',
    customerEmail: 'dana@example.com',
    subscriptionName: 'Pro Plan',
    amount: 49.5,
    currency: 'USD',
    dueDate: '2026-03-14T00:00:00.000Z',
    status: 'sent',
    ...overrides,
  };
}

function sourceFor(invoices: OverdueInvoice[]): OverdueInvoiceSource {
  return () => invoices;
}

function advanceTo(iso: string): void {
  clock = new Date(iso);
}

function entryOf(harness: Harness, invoiceId = 'inv_1001'): OverdueReminderEntry {
  const entry = harness.service.getEntry(invoiceId);
  if (!entry) throw new Error(`No entry for ${invoiceId}`);
  return entry;
}

beforeEach(() => {
  clock = new Date('2026-03-14T06:00:00.000Z');
  emailsSent = [];
  failDelivery = false;
});

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('stage helpers', () => {
  it('stageDueAt adds the stage offset to the due date', () => {
    expect(stageDueAt('2026-03-14T00:00:00.000Z', 3).toISOString()).toBe(
      '2026-03-17T00:00:00.000Z'
    );
  });

  it('daysOverdueAt floors whole days and never reports less than 1', () => {
    const due = '2026-03-14T00:00:00.000Z';
    expect(daysOverdueAt(due, new Date('2026-03-15T23:59:00.000Z'))).toBe(1);
    expect(daysOverdueAt(due, new Date('2026-03-16T00:00:00.000Z'))).toBe(2);
    expect(daysOverdueAt(due, new Date('2026-03-14T00:30:00.000Z'))).toBe(1);
  });

  it('overduePhrase pluralises correctly', () => {
    expect(overduePhrase(1)).toBe('1 day');
    expect(overduePhrase(2)).toBe('2 days');
  });

  it('stopReasonForStatus maps settled statuses and nothing else', () => {
    expect(stopReasonForStatus('paid')).toBe('paid');
    expect(stopReasonForStatus('PAID')).toBe('paid');
    expect(stopReasonForStatus('void')).toBe('voided');
    expect(stopReasonForStatus('refunded')).toBe('cancelled');
    expect(stopReasonForStatus('sent')).toBeNull();
    expect(stopReasonForStatus('overdue')).toBeNull();
  });
});

describe('validateStages', () => {
  it('accepts the defaults', () => {
    expect(() => validateStages(DEFAULT_OVERDUE_REMINDER_STAGES)).not.toThrow();
  });

  it('rejects an empty ladder', () => {
    expect(() => validateStages([])).toThrow(/at least one/i);
  });

  it('rejects non-increasing offsets', () => {
    expect(() =>
      validateStages([
        { daysOverdue: 3, label: 'a' },
        { daysOverdue: 1, label: 'b' },
      ])
    ).toThrow(/strictly increasing/);
  });

  it('rejects offsets below one day and duplicates', () => {
    expect(() => validateStages([{ daysOverdue: 0, label: 'a' }])).toThrow(/at least 1/);
    expect(() =>
      validateStages([
        { daysOverdue: 1, label: 'a' },
        { daysOverdue: 1, label: 'b' },
      ])
    ).toThrow(/strictly increasing/);
  });

  it('rejects empty or oversized labels', () => {
    expect(() => validateStages([{ daysOverdue: 1, label: '   ' }])).toThrow(/label/i);
    expect(() => validateStages([{ daysOverdue: 1, label: 'x'.repeat(81) }])).toThrow(
      /80 characters/
    );
  });

  it('rejects more than MAX_REMINDER_STAGES', () => {
    const stages = Array.from({ length: MAX_REMINDER_STAGES + 1 }, (_, i) => ({
      daysOverdue: i + 1,
      label: `stage ${i + 1}`,
    }));
    expect(() => validateStages(stages)).toThrow(/at most/);
  });
});

describe('resolveRecipients', () => {
  it('merges the invoice customer with schedule extras, de-duplicated', () => {
    const schedule = { recipients: ['ar@Example.com', 'dana@example.com'] } as OverdueReminderSchedule;
    expect(resolveRecipients(makeInvoice(), schedule)).toEqual([
      'dana@example.com',
      'ar@example.com',
    ]);
  });

  it('drops invalid addresses', () => {
    const schedule = { recipients: ['not-an-email', 'ok@example.com'] } as OverdueReminderSchedule;
    expect(resolveRecipients(makeInvoice({ customerEmail: '' }), schedule)).toEqual([
      'ok@example.com',
    ]);
  });
});

describe('initialStageIndex', () => {
  const stages = DEFAULT_OVERDUE_REMINDER_STAGES;

  it('starts at the first stage when none are due yet', () => {
    const now = new Date('2026-03-14T06:00:00.000Z');
    expect(initialStageIndex('2026-03-14T00:00:00.000Z', stages, now)).toBe(0);
  });

  it('skips stages that are already behind when first seen', () => {
    const now = new Date('2026-03-15T06:00:00.000Z');
    expect(initialStageIndex('2026-03-14T00:00:00.000Z', stages, now)).toBe(1);
  });

  it('uses the final stage when every stage is already behind', () => {
    const now = new Date('2026-04-14T00:00:00.000Z');
    expect(initialStageIndex('2026-03-14T00:00:00.000Z', stages, now)).toBe(stages.length - 1);
  });
});

// ─── Schedule management ──────────────────────────────────────────────────────

describe('schedule management', () => {
  it('creates a schedule with the default ladder', () => {
    const { service } = makeHarness();
    const schedule = service.createSchedule({ merchantId: MERCHANT });

    expect(schedule.enabled).toBe(true);
    expect(schedule.stages).toEqual(DEFAULT_OVERDUE_REMINDER_STAGES);
    expect(schedule.recipients).toEqual([]);
    expect(service.getSchedule(schedule.id)?.id).toBe(schedule.id);
    expect(service.listSchedules(MERCHANT)).toHaveLength(1);
  });

  it('stores a custom ladder, recipients and enabled flag', () => {
    const { service } = makeHarness();
    const schedule = service.createSchedule({
      merchantId: MERCHANT,
      stages: [
        { daysOverdue: 2, label: 'Heads up' },
        { daysOverdue: 10, label: 'Final notice' },
      ],
      recipients: [' AR@Example.com '],
      enabled: false,
    });

    expect(schedule.enabled).toBe(false);
    expect(schedule.stages.map((s) => s.daysOverdue)).toEqual([2, 10]);
    expect(schedule.recipients).toEqual(['ar@example.com']);
  });

  it('validates the merchant, ladder and recipients on create', () => {
    const { service } = makeHarness();
    expect(() => service.createSchedule({ merchantId: '' })).toThrow(/merchantId/);
    expect(() =>
      service.createSchedule({ merchantId: MERCHANT, stages: [] })
    ).toThrow(/at least one/i);
    expect(() =>
      service.createSchedule({ merchantId: MERCHANT, recipients: ['nope'] })
    ).toThrow(/Invalid email/);
  });

  it('updates stages, recipients and the enabled flag', () => {
    const { service } = makeHarness();
    const schedule = service.createSchedule({ merchantId: MERCHANT });

    const updated = service.updateSchedule(schedule.id, {
      stages: [
        { daysOverdue: 1, label: 'Reminder' },
        { daysOverdue: 5, label: 'Final notice' },
      ],
      recipients: ['ar@example.com'],
      enabled: false,
    });

    expect(updated.stages).toHaveLength(2);
    expect(updated.recipients).toEqual(['ar@example.com']);
    expect(updated.enabled).toBe(false);
    expect(() => service.updateSchedule(schedule.id, { stages: [] })).toThrow(/at least one/i);
    expect(() => service.updateSchedule('missing', { enabled: true })).toThrow(/not found/i);
  });

  it('stops active entries when a schedule is deleted', async () => {
    const harness = makeHarness();
    const schedule = harness.service.createSchedule({ merchantId: MERCHANT });
    await harness.service.runDue(sourceFor([makeInvoice()]));

    expect(entryOf(harness).status).toBe('active');
    expect(harness.service.deleteSchedule(schedule.id)).toBe(true);
    expect(entryOf(harness)).toMatchObject({
      status: 'stopped',
      stoppedReason: 'schedule_deleted',
    });
    expect(harness.service.deleteSchedule(schedule.id)).toBe(false);
  });
});

// ─── runDue: discovery and escalation ─────────────────────────────────────────

describe('runDue — escalation ladder', () => {
  it('discovers an overdue invoice without sending before the stage is due', async () => {
    const harness = makeHarness();
    harness.service.createSchedule({ merchantId: MERCHANT });

    const summary = await harness.service.runDue(sourceFor([makeInvoice()]));

    expect(summary.invoicesConsidered).toBe(1);
    expect(summary.entriesCreated).toBe(1);
    expect(summary.remindersSent).toBe(0);
    expect(emailsSent).toHaveLength(0);
    expect(entryOf(harness)).toMatchObject({
      stageIndex: 0,
      remindersSent: 0,
      status: 'active',
      nextSendAt: '2026-03-15T00:00:00.000Z',
    });
  });

  it('sends the first stage once it is due and advances the stage', async () => {
    const harness = makeHarness();
    harness.service.createSchedule({ merchantId: MERCHANT });
    await harness.service.runDue(sourceFor([makeInvoice()]));

    advanceTo('2026-03-15T00:30:00.000Z');
    const summary = await harness.service.runDue(sourceFor([makeInvoice()]));

    expect(summary.remindersSent).toBe(1);
    expect(emailsSent).toHaveLength(1);
    expect(emailsSent[0].subject).toContain('Payment reminder');
    expect(emailsSent[0].subject).toContain('INV-1001');
    expect(emailsSent[0].subject).toContain('1 day overdue');
    expect(toAddress(emailsSent[0]).email).toBe('dana@example.com');
    expect(emailsSent[0].from.email).toBe('billing@subtrackr.com');
    expect(emailsSent[0].text).toContain('49.50');
    expect(emailsSent[0].tags).toContain('invoice-overdue');
    expect(entryOf(harness)).toMatchObject({ stageIndex: 1, remindersSent: 1 });
  });

  it('escalates on the next stage with stronger wording', async () => {
    const harness = makeHarness();
    harness.service.createSchedule({ merchantId: MERCHANT });
    await harness.service.runDue(sourceFor([makeInvoice()]));
    advanceTo('2026-03-15T00:30:00.000Z');
    await harness.service.runDue(sourceFor([makeInvoice()]));

    advanceTo('2026-03-17T01:00:00.000Z');
    const summary = await harness.service.runDue(sourceFor([makeInvoice()]));

    expect(summary.remindersSent).toBe(1);
    expect(emailsSent).toHaveLength(2);
    expect(emailsSent[1].subject).toContain('Second notice');
    expect(emailsSent[1].subject).toContain('3 days overdue');
    expect(entryOf(harness).stageIndex).toBe(2);
  });

  it('completes after the last stage and never sends again', async () => {
    const harness = makeHarness();
    harness.service.createSchedule({
      merchantId: MERCHANT,
      stages: [{ daysOverdue: 1, label: 'Final notice' }],
    });
    await harness.service.runDue(sourceFor([makeInvoice()]));

    advanceTo('2026-03-15T00:30:00.000Z');
    const first = await harness.service.runDue(sourceFor([makeInvoice()]));
    expect(first.remindersSent).toBe(1);
    expect(first.entriesStopped).toBe(1);
    expect(entryOf(harness)).toMatchObject({
      status: 'stopped',
      stoppedReason: 'completed',
    });

    advanceTo('2026-03-20T00:00:00.000Z');
    const second = await harness.service.runDue(sourceFor([makeInvoice()]));
    expect(second.remindersSent).toBe(0);
    expect(emailsSent).toHaveLength(1);
  });

  it('gives a long-overdue invoice one appropriately escalated reminder', async () => {
    const harness = makeHarness();
    harness.service.createSchedule({ merchantId: MERCHANT });
    advanceTo('2026-04-14T09:00:00.000Z');

    const summary = await harness.service.runDue(
      sourceFor([makeInvoice({ dueDate: '2026-03-14T00:00:00.000Z' })])
    );

    expect(summary.remindersSent).toBe(1);
    expect(emailsSent).toHaveLength(1);
    expect(emailsSent[0].subject).toContain('Final notice');
    expect(emailsSent[0].subject).toContain('31 days overdue');
    expect(entryOf(harness).stoppedReason).toBe('completed');
  });

  it('skips a stage that became due while another reminder was just sent', async () => {
    const harness = makeHarness();
    const schedule = harness.service.createSchedule({ merchantId: MERCHANT });
    const invoice = makeInvoice({ dueDate: '2026-03-10T00:00:00.000Z' });
    harness.entries.save({
      invoiceId: invoice.id,
      merchantId: MERCHANT,
      scheduleId: schedule.id,
      stageIndex: 1,
      remindersSent: 1,
      attempts: 0,
      lastSentAt: new Date(clock.getTime() - 60 * 60 * 1000).toISOString(),
      lastAttemptAt: new Date(clock.getTime() - 60 * 60 * 1000).toISOString(),
      nextSendAt: '2026-03-13T00:00:00.000Z',
      startedAt: '2026-03-11T00:00:00.000Z',
      status: 'active',
      stoppedReason: null,
      stoppedAt: null,
    });

    const blocked = await harness.service.runDue(sourceFor([invoice]));
    expect(blocked.remindersSent).toBe(0);
    expect(blocked.skipped).toBe(1);
    expect(emailsSent).toHaveLength(0);

    advanceTo(new Date(Date.parse('2026-03-14T06:00:00.000Z') + MIN_REMINDER_GAP_MS + 60_000).toISOString());
    const allowed = await harness.service.runDue(sourceFor([invoice]));
    expect(allowed.remindersSent).toBe(1);
    expect(emailsSent).toHaveLength(1);
  });
});

// ─── runDue: stops ────────────────────────────────────────────────────────────

describe('runDue — stops on payment and other terminal conditions', () => {
  async function sendFirstStage(harness: Harness): Promise<void> {
    harness.service.createSchedule({ merchantId: MERCHANT });
    await harness.service.runDue(sourceFor([makeInvoice()]));
    advanceTo('2026-03-15T00:30:00.000Z');
    await harness.service.runDue(sourceFor([makeInvoice()]));
    advanceTo('2026-03-17T01:00:00.000Z');
  }

  it('stops as soon as the invoice status is paid', async () => {
    const harness = makeHarness();
    await sendFirstStage(harness);

    const summary = await harness.service.runDue(
      sourceFor([makeInvoice({ status: 'paid' })])
    );

    expect(summary.entriesStopped).toBe(1);
    expect(summary.remindersSent).toBe(0);
    expect(entryOf(harness)).toMatchObject({
      status: 'stopped',
      stoppedReason: 'paid',
    });

    advanceTo('2026-03-25T01:00:00.000Z');
    const later = await harness.service.runDue(
      sourceFor([makeInvoice({ status: 'paid' })])
    );
    expect(later.remindersSent).toBe(0);
    expect(emailsSent).toHaveLength(1);
  });

  it('stops for void and cancelled invoices too', async () => {
    const harness = makeHarness();
    await sendFirstStage(harness);

    await harness.service.runDue(sourceFor([makeInvoice({ status: 'void' })]));
    expect(entryOf(harness).stoppedReason).toBe('voided');

    const harness2 = makeHarness();
    await sendFirstStage(harness2);
    advanceTo('2026-03-17T01:00:00.000Z');
    await harness2.service.runDue(
      sourceFor([makeInvoice({ status: 'refunded' })])
    );
    expect(entryOf(harness2).stoppedReason).toBe('cancelled');
  });

  it('stops when the invoice disappears from the source (settled)', async () => {
    const harness = makeHarness();
    await sendFirstStage(harness);

    const summary = await harness.service.runDue(sourceFor([]));

    expect(summary.entriesStopped).toBe(1);
    expect(entryOf(harness)).toMatchObject({
      status: 'stopped',
      stoppedReason: 'settled',
    });
    expect(emailsSent).toHaveLength(1);
  });

  it('stops active entries while the schedule is disabled and resumes on re-enable', async () => {
    const harness = makeHarness();
    await sendFirstStage(harness);
    const [schedule] = harness.service.listSchedules(MERCHANT);

    harness.service.updateSchedule(schedule.id, { enabled: false });
    const disabled = await harness.service.runDue(sourceFor([makeInvoice()]));
    expect(disabled.remindersSent).toBe(0);
    expect(entryOf(harness)).toMatchObject({
      status: 'stopped',
      stoppedReason: 'schedule_disabled',
    });

    harness.service.updateSchedule(schedule.id, { enabled: true });
    const resumed = await harness.service.runDue(sourceFor([makeInvoice()]));
    expect(resumed.remindersSent).toBe(1);
    expect(emailsSent).toHaveLength(2);
    expect(entryOf(harness)).toMatchObject({ status: 'active', stageIndex: 2 });
  });

  it('stops explicitly through stopReminders', async () => {
    const harness = makeHarness();
    harness.service.createSchedule({ merchantId: MERCHANT });
    await harness.service.runDue(sourceFor([makeInvoice()]));

    expect(harness.service.stopReminders('inv_1001')).toBe(true);
    expect(entryOf(harness)).toMatchObject({
      status: 'stopped',
      stoppedReason: 'paid',
    });
    expect(harness.service.stopReminders('inv_1001')).toBe(false);
    expect(harness.service.stopReminders('unknown')).toBe(false);
  });

  it('never creates an entry for a merchant without an enabled schedule', async () => {
    const harness = makeHarness();
    const summary = await harness.service.runDue(sourceFor([makeInvoice()]));

    expect(summary.entriesCreated).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(harness.service.getEntry('inv_1001')).toBeNull();
  });

  it('lists entries by status, merchant and invoice', async () => {
    const harness = makeHarness();
    harness.service.createSchedule({ merchantId: MERCHANT });
    await harness.service.runDue(sourceFor([makeInvoice()]));

    expect(harness.service.listEntries({ status: 'active' })).toHaveLength(1);
    expect(harness.service.listEntries({ status: 'stopped' })).toHaveLength(0);
    expect(harness.service.listEntries({ merchantId: 'other' })).toHaveLength(0);
    expect(harness.service.listEntries({ invoiceId: 'inv_1001' })).toHaveLength(1);
    expect(harness.service.listEntries({ invoiceId: 'nope' })).toHaveLength(0);
  });
});

// ─── runDue: delivery failures ────────────────────────────────────────────────

describe('runDue — delivery failures', () => {
  it('keeps the stage on failure and retries after the backoff window', async () => {
    failDelivery = true;
    const harness = makeHarness();
    harness.service.createSchedule({ merchantId: MERCHANT });
    await harness.service.runDue(sourceFor([makeInvoice()]));

    advanceTo('2026-03-15T00:30:00.000Z');
    const first = await harness.service.runDue(sourceFor([makeInvoice()]));
    expect(first.remindersSent).toBe(0);
    expect(first.errors).toHaveLength(1);
    expect(first.errors[0].stage).toBe('Payment reminder');
    expect(entryOf(harness)).toMatchObject({ stageIndex: 0, attempts: 1 });

    const immediate = await harness.service.runDue(sourceFor([makeInvoice()]));
    expect(immediate.errors).toHaveLength(0);
    expect(entryOf(harness).attempts).toBe(1);

    advanceTo('2026-03-15T01:35:00.000Z');
    const second = await harness.service.runDue(sourceFor([makeInvoice()]));
    expect(second.errors).toHaveLength(1);
    expect(entryOf(harness)).toMatchObject({ stageIndex: 0, attempts: 2 });
  });

  it(`skips to the next stage after ${MAX_STAGE_ATTEMPTS} failed attempts`, async () => {
    failDelivery = true;
    const harness = makeHarness();
    harness.service.createSchedule({ merchantId: MERCHANT });
    await harness.service.runDue(sourceFor([makeInvoice()]));
    advanceTo('2026-03-15T00:30:00.000Z');

    for (let attempt = 1; attempt <= MAX_STAGE_ATTEMPTS; attempt += 1) {
      await harness.service.runDue(sourceFor([makeInvoice()]));
      advanceTo(
        new Date(clock.getTime() + FAILURE_RETRY_MS + 60_000).toISOString()
      );
    }

    expect(entryOf(harness)).toMatchObject({ stageIndex: 1, attempts: 0 });
    expect(emailsSent).toHaveLength(MAX_STAGE_ATTEMPTS);
  });
});
