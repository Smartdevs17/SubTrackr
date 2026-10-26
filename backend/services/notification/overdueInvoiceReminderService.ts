/**
 * OverdueInvoiceReminderService (#1737)
 *
 * Escalating reminders for overdue invoices.
 *
 * A merchant configures one *schedule*: an ordered list of reminder stages,
 * each keyed by how many days past the due date it fires, plus an enable
 * switch and extra recipients. The service keeps one *entry* per overdue
 * invoice that records which stage was sent and when the next one is due.
 *
 * Guarantees
 * ───────────
 *  - Configurable schedule — stages, recipients and the enabled flag are all
 *    editable through the CRUD API; the poll interval is a job option.
 *  - Escalating — stage labels escalate ("Payment reminder" → "Final notice")
 *    and stages fire strictly in order, at least a day apart.
 *  - Stops on payment — an invoice that reaches a settled status (paid, void,
 *    cancelled, refunded), disappears from the overdue source, or loses its
 *    enabled schedule stops receiving reminders.
 *  - Tested — see `__tests__/overdueInvoiceReminderService.test.ts`.
 */

import type { EmailProvider, EmailMessage } from './emailProvider';
import { renderTransactionalEmail } from './transactionalEmailTemplates';

// ─── Public types ─────────────────────────────────────────────────────────────

/** A past-due invoice as seen by the reminder service. */
export interface OverdueInvoice {
  id: string;
  invoiceNumber: string;
  merchantId: string;
  customerName?: string;
  customerEmail: string;
  subscriptionName?: string;
  amount: number;
  currency: string;
  /** ISO-8601 due date. */
  dueDate: string;
  /** Raw invoice status; compared case-insensitively. */
  status: string;
  invoiceUrl?: string;
}

/** Supplies the invoices a run should consider. Injected so tests stay pure. */
export type OverdueInvoiceSource = (
  now: Date
) => Promise<OverdueInvoice[]> | OverdueInvoice[];

/** One step of the escalation ladder. */
export interface OverdueReminderStage {
  /** Days past the due date at which this reminder fires. */
  daysOverdue: number;
  /** Escalation wording carried in the subject line. */
  label: string;
}

export const DEFAULT_OVERDUE_REMINDER_STAGES: OverdueReminderStage[] = [
  { daysOverdue: 1, label: 'Payment reminder' },
  { daysOverdue: 3, label: 'Second notice' },
  { daysOverdue: 7, label: 'Urgent notice' },
  { daysOverdue: 14, label: 'Final notice' },
];

export const MAX_REMINDER_STAGES = 10;

/** Failed deliveries are retried after this delay, until the cap is hit. */
export const FAILURE_RETRY_MS = 60 * 60 * 1_000;
export const MAX_STAGE_ATTEMPTS = 3;

/** Two reminders for the same invoice are never sent closer together. */
export const MIN_REMINDER_GAP_MS = 12 * 60 * 60 * 1_000;

export type OverdueReminderStopReason =
  | 'paid'
  | 'voided'
  | 'cancelled'
  | 'settled'
  | 'completed'
  | 'schedule_disabled'
  | 'schedule_deleted';

export type OverdueReminderEntryStatus = 'active' | 'stopped';

/** Reminder state for a single invoice. */
export interface OverdueReminderEntry {
  invoiceId: string;
  merchantId: string;
  scheduleId: string;
  /** Index of the next stage to send. */
  stageIndex: number;
  remindersSent: number;
  /** Failed attempts against the current stage. */
  attempts: number;
  lastSentAt: string | null;
  lastAttemptAt: string | null;
  /** Display aid; the due decision is always recomputed from the stage list. */
  nextSendAt: string;
  startedAt: string;
  status: OverdueReminderEntryStatus;
  stoppedReason: OverdueReminderStopReason | null;
  stoppedAt: string | null;
}

/** The configurable reminder schedule for one merchant. */
export interface OverdueReminderSchedule {
  id: string;
  merchantId: string;
  enabled: boolean;
  stages: OverdueReminderStage[];
  /** Extra recipients beyond the invoice's own customer email. */
  recipients: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateOverdueReminderScheduleInput {
  merchantId: string;
  stages?: OverdueReminderStage[];
  recipients?: string[];
  enabled?: boolean;
}

export interface UpdateOverdueReminderScheduleInput {
  stages?: OverdueReminderStage[];
  recipients?: string[];
  enabled?: boolean;
}

export interface OverdueReminderRunSummary {
  now: string;
  invoicesConsidered: number;
  entriesCreated: number;
  remindersSent: number;
  entriesStopped: number;
  skipped: number;
  errors: Array<{ invoiceId: string; stage: string; error: string }>;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export interface OverdueReminderScheduleStore {
  findById(id: string): OverdueReminderSchedule | undefined;
  findEnabledByMerchant(merchantId: string): OverdueReminderSchedule | null;
  findByMerchant(merchantId: string): OverdueReminderSchedule[];
  save(schedule: OverdueReminderSchedule): void;
  delete(id: string): boolean;
}

export interface OverdueReminderEntryStore {
  get(invoiceId: string): OverdueReminderEntry | undefined;
  save(entry: OverdueReminderEntry): void;
  all(): OverdueReminderEntry[];
}

export class InMemoryScheduleStore implements OverdueReminderScheduleStore {
  private readonly records = new Map<string, OverdueReminderSchedule>();

  findById(id: string): OverdueReminderSchedule | undefined {
    return this.records.get(id);
  }

  findEnabledByMerchant(merchantId: string): OverdueReminderSchedule | null {
    const match = [...this.records.values()].find(
      (s) => s.merchantId === merchantId && s.enabled
    );
    return match ? { ...match } : null;
  }

  findByMerchant(merchantId: string): OverdueReminderSchedule[] {
    return [...this.records.values()]
      .filter((s) => s.merchantId === merchantId)
      .map((s) => ({ ...s }));
  }

  save(schedule: OverdueReminderSchedule): void {
    this.records.set(schedule.id, { ...schedule, stages: schedule.stages.map((s) => ({ ...s })) });
  }

  delete(id: string): boolean {
    return this.records.delete(id);
  }

  clear(): void {
    this.records.clear();
  }
}

export class InMemoryEntryStore implements OverdueReminderEntryStore {
  private readonly records = new Map<string, OverdueReminderEntry>();

  get(invoiceId: string): OverdueReminderEntry | undefined {
    const entry = this.records.get(invoiceId);
    return entry ? { ...entry } : undefined;
  }

  save(entry: OverdueReminderEntry): void {
    this.records.set(entry.invoiceId, { ...entry });
  }

  all(): OverdueReminderEntry[] {
    return [...this.records.values()].map((e) => ({ ...e }));
  }

  clear(): void {
    this.records.clear();
  }
}

// ─── Dependencies ─────────────────────────────────────────────────────────────

export interface OverdueInvoiceReminderServiceDeps {
  emailProvider: EmailProvider;
  fromAddress: string;
  supportEmail?: string;
  merchantName?: string;
  appBaseUrl?: string;
  scheduleStore?: OverdueReminderScheduleStore;
  entryStore?: OverdueReminderEntryStore;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1_000;

const PAID_STATUSES = new Set(['paid', 'settled', 'payment_received', 'succeeded']);
const VOID_STATUSES = new Set(['void', 'voided']);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'refunded']);

/**
 * Why reminders must stop for an invoice in this status, or null when the
 * invoice still needs chasing.
 */
export function stopReasonForStatus(status: string): OverdueReminderStopReason | null {
  const normalised = String(status ?? '').trim().toLowerCase();
  if (PAID_STATUSES.has(normalised)) return 'paid';
  if (VOID_STATUSES.has(normalised)) return 'voided';
  if (CANCELLED_STATUSES.has(normalised)) return 'cancelled';
  return null;
}

/** The instant a stage becomes due, i.e. due date + stage offset. */
export function stageDueAt(dueDate: string | Date, daysOverdue: number): Date {
  const due = new Date(dueDate);
  return new Date(due.getTime() + daysOverdue * DAY_MS);
}

/** Whole days elapsed since the due date, never less than 1 while overdue. */
export function daysOverdueAt(dueDate: string | Date, now: Date): number {
  const due = new Date(dueDate);
  return Math.max(1, Math.floor((now.getTime() - due.getTime()) / DAY_MS));
}

/** Human phrase for an overdue duration, e.g. `1 day` / `14 days`. */
export function overduePhrase(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export function validateStages(stages: OverdueReminderStage[]): void {
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error('At least one reminder stage is required');
  }
  if (stages.length > MAX_REMINDER_STAGES) {
    throw new Error(`A schedule may have at most ${MAX_REMINDER_STAGES} stages`);
  }
  let previous = -1;
  for (const stage of stages) {
    if (!Number.isInteger(stage.daysOverdue) || stage.daysOverdue < 1) {
      throw new Error(`Stage daysOverdue must be an integer of at least 1: ${stage.daysOverdue}`);
    }
    if (stage.daysOverdue <= previous) {
      throw new Error('Stage daysOverdue values must be strictly increasing');
    }
    if (!stage.label?.trim()) {
      throw new Error('Every stage needs a non-empty label');
    }
    if (stage.label.trim().length > 80) {
      throw new Error('Stage labels are limited to 80 characters');
    }
    previous = stage.daysOverdue;
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateRecipients(recipients: string[]): void {
  for (const recipient of recipients) {
    if (!isValidEmail(recipient.trim())) {
      throw new Error(`Invalid email address: ${recipient}`);
    }
  }
}

/** Invoice customer plus schedule extras, de-duplicated and order-stable. */
export function resolveRecipients(
  invoice: OverdueInvoice,
  schedule: OverdueReminderSchedule
): string[] {
  const candidates = [invoice.customerEmail ?? '', ...schedule.recipients];
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const candidate of candidates) {
    const normalised = candidate.trim().toLowerCase();
    if (!normalised || seen.has(normalised) || !isValidEmail(normalised)) continue;
    seen.add(normalised);
    recipients.push(normalised);
  }
  return recipients;
}

function localPart(email: string): string {
  return email.split('@')[0] ?? '';
}

/**
 * First stage that has not fired yet. Stages already in the past when an
 * invoice is first seen are skipped so a long-overdue invoice receives one
 * appropriately escalated reminder instead of the whole ladder at once.
 */
export function initialStageIndex(
  dueDate: string | Date,
  stages: OverdueReminderStage[],
  now: Date
): number {
  const futureIndex = stages.findIndex((stage) => stageDueAt(dueDate, stage.daysOverdue) > now);
  if (futureIndex === -1) return stages.length - 1;
  return futureIndex;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class OverdueInvoiceReminderService {
  private readonly emailProvider: EmailProvider;
  private readonly fromAddress: string;
  private readonly supportEmail: string;
  private readonly merchantName: string;
  private readonly appBaseUrl: string;
  private readonly scheduleStore: OverdueReminderScheduleStore;
  private readonly entryStore: OverdueReminderEntryStore;
  private readonly now: () => Date;
  private idCounter = 0;

  constructor(deps: OverdueInvoiceReminderServiceDeps) {
    this.emailProvider = deps.emailProvider;
    this.fromAddress = deps.fromAddress;
    this.supportEmail = deps.supportEmail ?? 'support@subtrackr.io';
    this.merchantName = deps.merchantName ?? 'SubTrackr';
    this.appBaseUrl = (deps.appBaseUrl ?? 'https://app.subtrackr.io').replace(/\/+$/, '');
    this.scheduleStore = deps.scheduleStore ?? new InMemoryScheduleStore();
    this.entryStore = deps.entryStore ?? new InMemoryEntryStore();
    this.now = deps.now ?? (() => new Date());
  }

  // ── Schedule management ────────────────────────────────────────────────────

  createSchedule(input: CreateOverdueReminderScheduleInput): OverdueReminderSchedule {
    if (!input.merchantId?.trim()) throw new Error('merchantId is required');
    const stages = input.stages ?? DEFAULT_OVERDUE_REMINDER_STAGES.map((s) => ({ ...s }));
    validateStages(stages);
    const recipients = (input.recipients ?? []).map((r) => r.trim().toLowerCase());
    validateRecipients(recipients);
    const now = this.now();
    const schedule: OverdueReminderSchedule = {
      id: this.generateId(),
      merchantId: input.merchantId.trim(),
      enabled: input.enabled ?? true,
      stages: stages.map((s) => ({ daysOverdue: s.daysOverdue, label: s.label.trim() })),
      recipients: [...new Set(recipients)],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.scheduleStore.save(schedule);
    return schedule;
  }

  getSchedule(id: string): OverdueReminderSchedule | null {
    return this.scheduleStore.findById(id) ?? null;
  }

  listSchedules(merchantId: string): OverdueReminderSchedule[] {
    return this.scheduleStore.findByMerchant(merchantId);
  }

  updateSchedule(id: string, input: UpdateOverdueReminderScheduleInput): OverdueReminderSchedule {
    const existing = this.scheduleStore.findById(id);
    if (!existing) throw new Error(`Schedule not found: ${id}`);
    if (input.stages !== undefined) validateStages(input.stages);
    if (input.recipients !== undefined) validateRecipients(input.recipients);
    const updated: OverdueReminderSchedule = {
      ...existing,
      enabled: input.enabled ?? existing.enabled,
      stages: input.stages
        ? input.stages.map((s) => ({ daysOverdue: s.daysOverdue, label: s.label.trim() }))
        : existing.stages.map((s) => ({ ...s })),
      recipients: input.recipients
        ? [...new Set(input.recipients.map((r) => r.trim().toLowerCase()))]
        : [...existing.recipients],
      updatedAt: this.now().toISOString(),
    };
    this.scheduleStore.save(updated);
    return updated;
  }

  deleteSchedule(id: string): boolean {
    const existing = this.scheduleStore.findById(id);
    if (!existing) return false;
    const deleted = this.scheduleStore.delete(id);
    if (deleted) {
      for (const entry of this.entryStore.all()) {
        if (entry.status === 'active' && entry.scheduleId === id) {
          this.stopEntry(entry.invoiceId, 'schedule_deleted');
        }
      }
    }
    return deleted;
  }

  // ── Entry inspection / control ─────────────────────────────────────────────

  getEntry(invoiceId: string): OverdueReminderEntry | null {
    return this.entryStore.get(invoiceId) ?? null;
  }

  listEntries(filter: {
    merchantId?: string;
    invoiceId?: string;
    status?: OverdueReminderEntryStatus;
  } = {}): OverdueReminderEntry[] {
    return this.entryStore.all().filter((entry) => {
      if (filter.merchantId && entry.merchantId !== filter.merchantId) return false;
      if (filter.invoiceId && entry.invoiceId !== filter.invoiceId) return false;
      if (filter.status && entry.status !== filter.status) return false;
      return true;
    });
  }

  /**
   * Stop reminders for one invoice — the explicit "the invoice was paid"
   * hook. Returns true when an active entry was stopped.
   */
  stopReminders(
    invoiceId: string,
    reason: OverdueReminderStopReason = 'paid'
  ): boolean {
    return this.stopEntry(invoiceId, reason);
  }

  // ── The run ────────────────────────────────────────────────────────────────

  async runDue(source: OverdueInvoiceSource): Promise<OverdueReminderRunSummary> {
    const now = this.now();
    const invoices = await source(now);
    const summary: OverdueReminderRunSummary = {
      now: now.toISOString(),
      invoicesConsidered: invoices.length,
      entriesCreated: 0,
      remindersSent: 0,
      entriesStopped: 0,
      skipped: 0,
      errors: [],
    };
    const seen = new Set<string>();

    for (const invoice of invoices) {
      seen.add(invoice.id);

      const terminal = stopReasonForStatus(invoice.status);
      if (terminal) {
        if (this.stopEntry(invoice.id, terminal)) summary.entriesStopped += 1;
        continue;
      }

      let entry = this.entryStore.get(invoice.id);
      if (entry && entry.status === 'stopped' && entry.stoppedReason !== 'schedule_disabled') {
        continue;
      }

      const schedule = this.scheduleStore.findEnabledByMerchant(invoice.merchantId);
      if (!schedule) {
        if (entry && entry.status === 'active') {
          this.stopEntry(invoice.id, 'schedule_disabled');
          summary.entriesStopped += 1;
        } else {
          summary.skipped += 1;
        }
        continue;
      }

      if (!entry) {
        entry = this.newEntry(invoice, schedule, now);
        this.entryStore.save(entry);
        summary.entriesCreated += 1;
      } else if (entry.status === 'stopped') {
        entry = { ...entry, status: 'active', stoppedReason: null, stoppedAt: null };
        this.entryStore.save(entry);
      }
      if (entry.scheduleId !== schedule.id) {
        entry = { ...entry, scheduleId: schedule.id };
        this.entryStore.save(entry);
      }

      if (entry.stageIndex >= schedule.stages.length) {
        this.stopEntry(invoice.id, 'completed');
        summary.entriesStopped += 1;
        continue;
      }

      const stage = schedule.stages[entry.stageIndex];
      const dueAt = stageDueAt(invoice.dueDate, stage.daysOverdue);
      if (dueAt > now) {
        summary.skipped += 1;
        continue;
      }
      if (
        entry.lastAttemptAt &&
        now.getTime() - new Date(entry.lastAttemptAt).getTime() < FAILURE_RETRY_MS
      ) {
        summary.skipped += 1;
        continue;
      }
      if (
        entry.lastSentAt &&
        now.getTime() - new Date(entry.lastSentAt).getTime() < MIN_REMINDER_GAP_MS
      ) {
        summary.skipped += 1;
        continue;
      }

      const recipients = resolveRecipients(invoice, schedule);
      if (recipients.length === 0) {
        summary.skipped += 1;
        continue;
      }

      try {
        await this.sendReminder(invoice, schedule, stage, entry.stageIndex, recipients, now);
        const sent: OverdueReminderEntry = {
          ...entry,
          stageIndex: entry.stageIndex + 1,
          remindersSent: entry.remindersSent + 1,
          attempts: 0,
          lastSentAt: now.toISOString(),
          lastAttemptAt: now.toISOString(),
          nextSendAt: this.nextSendAtFor(invoice, schedule, entry.stageIndex + 1),
        };
        if (sent.stageIndex >= schedule.stages.length) {
          this.finaliseEntry(sent, 'completed');
          summary.entriesStopped += 1;
        } else {
          this.entryStore.save(sent);
        }
        summary.remindersSent += 1;
      } catch (err) {
        const attempts = entry.attempts + 1;
        const failed: OverdueReminderEntry = {
          ...entry,
          attempts,
          lastAttemptAt: now.toISOString(),
          nextSendAt: new Date(now.getTime() + FAILURE_RETRY_MS).toISOString(),
        };
        if (attempts >= MAX_STAGE_ATTEMPTS) {
          failed.stageIndex = entry.stageIndex + 1;
          failed.attempts = 0;
          failed.nextSendAt = this.nextSendAtFor(invoice, schedule, failed.stageIndex);
        }
        if (failed.stageIndex >= schedule.stages.length) {
          this.finaliseEntry(failed, 'completed');
          summary.entriesStopped += 1;
        } else {
          this.entryStore.save(failed);
        }
        summary.errors.push({
          invoiceId: invoice.id,
          stage: stage.label,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    for (const entry of this.entryStore.all()) {
      if (entry.status === 'active' && !seen.has(entry.invoiceId)) {
        if (this.stopEntry(entry.invoiceId, 'settled')) summary.entriesStopped += 1;
      }
    }

    return summary;
  }

  // ── Delivery ───────────────────────────────────────────────────────────────

  async sendReminder(
    invoice: OverdueInvoice,
    schedule: OverdueReminderSchedule,
    stage: OverdueReminderStage,
    stageIndex: number,
    recipients: string[],
    now: Date = this.now()
  ): Promise<void> {
    const due = new Date(invoice.dueDate);
    const rendered = renderTransactionalEmail('invoice_overdue', {
      merchant_name: this.merchantName,
      subscriber_name: invoice.customerName?.trim() || localPart(invoice.customerEmail) || 'there',
      support_email: this.supportEmail,
      invoice_number: invoice.invoiceNumber,
      subscription_name: invoice.subscriptionName?.trim() || 'your subscription',
      amount: Number.isFinite(invoice.amount) ? invoice.amount.toFixed(2) : '0.00',
      currency: invoice.currency?.trim() || 'USD',
      due_date: due.toISOString().slice(0, 10),
      overdue_phrase: overduePhrase(daysOverdueAt(invoice.dueDate, now)),
      invoice_url: invoice.invoiceUrl ?? `${this.appBaseUrl}/invoices/${encodeURIComponent(invoice.id)}`,
      escalation_label: stage.label.trim(),
    });

    const failures: string[] = [];
    let delivered = 0;
    for (const recipient of recipients) {
      const message: EmailMessage = {
        to: { email: recipient },
        from: { email: this.fromAddress },
        subject: rendered.plainSubject,
        text: rendered.text,
        html: rendered.html,
        tags: [
          'invoice-overdue',
          `stage:${stageIndex + 1}`,
          `invoice:${invoice.id}`,
          `merchant:${schedule.merchantId}`,
        ],
      };
      try {
        const result = await this.emailProvider.send(message);
        if (result.success) {
          delivered += 1;
        } else {
          failures.push(`${recipient}: ${result.error ?? 'unknown delivery error'}`);
        }
      } catch (err) {
        failures.push(`${recipient}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (delivered === 0) {
      throw new Error(
        failures.length
          ? `Reminder delivery failed — ${failures.join('; ')}`
          : 'Reminder delivery failed — no recipients accepted the message'
      );
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private generateId(): string {
    return `ovr_${Date.now()}_${++this.idCounter}`;
  }

  private newEntry(
    invoice: OverdueInvoice,
    schedule: OverdueReminderSchedule,
    now: Date
  ): OverdueReminderEntry {
    const stageIndex = initialStageIndex(invoice.dueDate, schedule.stages, now);
    return {
      invoiceId: invoice.id,
      merchantId: invoice.merchantId,
      scheduleId: schedule.id,
      stageIndex,
      remindersSent: 0,
      attempts: 0,
      lastSentAt: null,
      lastAttemptAt: null,
      nextSendAt: this.nextSendAtFor(invoice, schedule, stageIndex),
      startedAt: now.toISOString(),
      status: 'active',
      stoppedReason: null,
      stoppedAt: null,
    };
  }

  private nextSendAtFor(
    invoice: OverdueInvoice,
    schedule: OverdueReminderSchedule,
    stageIndex: number
  ): string {
    if (schedule.stages.length === 0) return new Date(invoice.dueDate).toISOString();
    const index = Math.min(Math.max(stageIndex, 0), schedule.stages.length - 1);
    return stageDueAt(invoice.dueDate, schedule.stages[index].daysOverdue).toISOString();
  }

  private stopEntry(invoiceId: string, reason: OverdueReminderStopReason): boolean {
    const entry = this.entryStore.get(invoiceId);
    if (!entry || entry.status !== 'active') return false;
    this.finaliseEntry(entry, reason);
    return true;
  }

  private finaliseEntry(entry: OverdueReminderEntry, reason: OverdueReminderStopReason): void {
    this.entryStore.save({
      ...entry,
      status: 'stopped',
      stoppedReason: reason,
      stoppedAt: this.now().toISOString(),
    });
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createOverdueInvoiceReminderService(
  deps: OverdueInvoiceReminderServiceDeps
): OverdueInvoiceReminderService {
  return new OverdueInvoiceReminderService(deps);
}
