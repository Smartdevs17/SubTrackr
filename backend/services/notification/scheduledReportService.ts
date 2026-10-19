/**
 * ScheduledReportService
 *
 * Manages recurring email report schedules and their recipient lists.
 * A "report" is a summary email (MRR, active subscribers, churn, etc.) that
 * is delivered on a configurable cadence to one or more email addresses.
 *
 * Responsibilities
 * ─────────────────
 *  - CRUD for ScheduledReport records (stored in-memory; swap in a DB
 *    repository by passing a ReportStore implementation).
 *  - Recipient management: add / remove / list email addresses per schedule.
 *  - `buildReportEmail()` — pure render of the report email body from an
 *    analytics snapshot; testable without a live email provider.
 *  - `sendReport()` — send a single report to all active recipients.
 *  - `runDue()` — called by the cron job; fires all schedules whose next-send
 *    time has passed.
 *
 * Keeping delivery and persistence concerns separate from scheduling means:
 *  - The scheduler can call `runDue()` without knowing about cron internals.
 *  - Tests can exercise the build / send path without a timer.
 */

import type { EmailProvider, EmailMessage } from './emailProvider';

// ─── Public types ─────────────────────────────────────────────────────────────

/** How often the report is sent. */
export type ReportFrequency = 'daily' | 'weekly' | 'monthly';

export const REPORT_FREQUENCIES: ReportFrequency[] = ['daily', 'weekly', 'monthly'];

/** The report types that can be scheduled. */
export type ReportType = 'analytics_summary' | 'mrr_breakdown' | 'churn_report' | 'full_report';

export const REPORT_TYPES: ReportType[] = [
  'analytics_summary',
  'mrr_breakdown',
  'churn_report',
  'full_report',
];

export interface ScheduledReport {
  id: string;
  merchantId: string;
  name: string;
  reportType: ReportType;
  frequency: ReportFrequency;
  /** Recipients for this specific schedule. */
  recipients: string[];
  /** ISO-8601 timestamp of the last successful send. */
  lastSentAt: string | null;
  /** ISO-8601 timestamp of when the next send is due. */
  nextSendAt: string;
  /** Whether this schedule is active. Disabled schedules are skipped by runDue(). */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledReportInput {
  merchantId: string;
  name: string;
  reportType: ReportType;
  frequency: ReportFrequency;
  recipients: string[];
  /** If omitted, the first send is scheduled from now. */
  startAt?: string;
}

export interface UpdateScheduledReportInput {
  name?: string;
  reportType?: ReportType;
  frequency?: ReportFrequency;
  enabled?: boolean;
}

/** Snapshot of analytics data passed into buildReportEmail(). */
export interface ReportAnalyticsSnapshot {
  merchantId: string;
  merchantName?: string;
  /** Monthly Recurring Revenue in the account's base currency. */
  mrr: number;
  arr: number;
  mrrGrowthRate: number;
  activeSubscribers: number;
  newSubscribersThisPeriod: number;
  churned: number;
  grossChurnRate: number;
  netChurnRate: number;
  arpu: number;
  ltv: number;
  /** The currency symbol, e.g. "$" */
  currencySymbol?: string;
  /** ISO-8601 period start for context. */
  periodStart: string;
  /** ISO-8601 period end for context. */
  periodEnd: string;
}

export interface ReportEmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface SendReportResult {
  reportId: string;
  recipientCount: number;
  succeeded: number;
  failed: number;
  errors: Array<{ recipient: string; error: string }>;
  sentAt: string;
}

export interface RunDueSummary {
  considered: number;
  fired: number;
  skipped: number;
  results: SendReportResult[];
}

// ─── Persistence interface ────────────────────────────────────────────────────

/**
 * Storage backend for ScheduledReport records.
 * The built-in InMemoryReportStore is used unless a real DB store is injected.
 */
export interface ReportStore {
  findById(id: string): ScheduledReport | undefined;
  findByMerchant(merchantId: string): ScheduledReport[];
  findDue(now: Date): ScheduledReport[];
  save(report: ScheduledReport): void;
  delete(id: string): boolean;
  all(): ScheduledReport[];
}

export class InMemoryReportStore implements ReportStore {
  private readonly records = new Map<string, ScheduledReport>();

  findById(id: string): ScheduledReport | undefined {
    return this.records.get(id);
  }

  findByMerchant(merchantId: string): ScheduledReport[] {
    return [...this.records.values()].filter((r) => r.merchantId === merchantId);
  }

  findDue(now: Date): ScheduledReport[] {
    return [...this.records.values()].filter(
      (r) => r.enabled && new Date(r.nextSendAt) <= now
    );
  }

  save(report: ScheduledReport): void {
    this.records.set(report.id, { ...report });
  }

  delete(id: string): boolean {
    return this.records.delete(id);
  }

  all(): ScheduledReport[] {
    return [...this.records.values()];
  }

  /** Test helper — wipe all records. */
  clear(): void {
    this.records.clear();
  }
}

// ─── Dependencies ─────────────────────────────────────────────────────────────

export interface ScheduledReportServiceDeps {
  emailProvider: EmailProvider;
  fromAddress: string;
  store?: ReportStore;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Compute the next send time from a reference date and frequency. */
export function nextSendAt(from: Date, frequency: ReportFrequency): Date {
  const next = new Date(from);
  switch (frequency) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }
  // Normalise to the start of the hour so small clock drift does not cause
  // a schedule to be skipped for a whole period.
  next.setUTCMinutes(0, 0, 0);
  return next;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function currency(n: number, symbol: string): string {
  return `${symbol}${fmt(n)}`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ScheduledReportService {
  private readonly emailProvider: EmailProvider;
  private readonly fromAddress: string;
  private readonly store: ReportStore;
  private readonly now: () => Date;
  private idCounter = 0;

  constructor(deps: ScheduledReportServiceDeps) {
    this.emailProvider = deps.emailProvider;
    this.fromAddress = deps.fromAddress;
    this.store = deps.store ?? new InMemoryReportStore();
    this.now = deps.now ?? (() => new Date());
  }

  // ── Schedule management ────────────────────────────────────────────────────

  /** Create a new schedule. Validates inputs and returns the persisted record. */
  createSchedule(input: CreateScheduledReportInput): ScheduledReport {
    validateCreateInput(input);
    const now = this.now();
    const startFrom = input.startAt ? new Date(input.startAt) : now;
    const id = this.generateId();
    const report: ScheduledReport = {
      id,
      merchantId: input.merchantId,
      name: input.name.trim(),
      reportType: input.reportType,
      frequency: input.frequency,
      recipients: [...new Set(input.recipients.map((r) => r.toLowerCase().trim()))],
      lastSentAt: null,
      nextSendAt: nextSendAt(startFrom, input.frequency).toISOString(),
      enabled: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.store.save(report);
    return report;
  }

  /** Retrieve a single schedule; returns null when not found. */
  getSchedule(id: string): ScheduledReport | null {
    return this.store.findById(id) ?? null;
  }

  /** List all schedules for a merchant. */
  listSchedules(merchantId: string): ScheduledReport[] {
    return this.store.findByMerchant(merchantId);
  }

  /** Update mutable fields of a schedule. Returns the updated record. */
  updateSchedule(id: string, input: UpdateScheduledReportInput): ScheduledReport {
    const existing = this.store.findById(id);
    if (!existing) throw new Error(`Schedule not found: ${id}`);
    if (input.reportType !== undefined && !REPORT_TYPES.includes(input.reportType)) {
      throw new Error(`Invalid reportType: ${input.reportType}`);
    }
    if (input.frequency !== undefined && !REPORT_FREQUENCIES.includes(input.frequency)) {
      throw new Error(`Invalid frequency: ${input.frequency}`);
    }
    const now = this.now();
    const updated: ScheduledReport = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      reportType: input.reportType ?? existing.reportType,
      frequency: input.frequency ?? existing.frequency,
      enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
      updatedAt: now.toISOString(),
    };
    // If the frequency changed, recompute the next send time.
    if (input.frequency !== undefined && input.frequency !== existing.frequency) {
      const base = existing.lastSentAt ? new Date(existing.lastSentAt) : now;
      updated.nextSendAt = nextSendAt(base, input.frequency).toISOString();
    }
    this.store.save(updated);
    return updated;
  }

  /** Soft-delete a schedule by ID. Returns true when found and removed. */
  deleteSchedule(id: string): boolean {
    return this.store.delete(id);
  }

  // ── Recipient management ───────────────────────────────────────────────────

  /** Add one or more email addresses to a schedule's recipient list. */
  addRecipients(id: string, emails: string[]): ScheduledReport {
    const existing = this.store.findById(id);
    if (!existing) throw new Error(`Schedule not found: ${id}`);
    const normalised = emails.map((e) => e.toLowerCase().trim()).filter(isValidEmail);
    const merged = [...new Set([...existing.recipients, ...normalised])];
    const updated: ScheduledReport = {
      ...existing,
      recipients: merged,
      updatedAt: this.now().toISOString(),
    };
    this.store.save(updated);
    return updated;
  }

  /** Remove one or more email addresses from a schedule's recipient list. */
  removeRecipients(id: string, emails: string[]): ScheduledReport {
    const existing = this.store.findById(id);
    if (!existing) throw new Error(`Schedule not found: ${id}`);
    const toRemove = new Set(emails.map((e) => e.toLowerCase().trim()));
    const updated: ScheduledReport = {
      ...existing,
      recipients: existing.recipients.filter((r) => !toRemove.has(r)),
      updatedAt: this.now().toISOString(),
    };
    this.store.save(updated);
    return updated;
  }

  // ── Email content ──────────────────────────────────────────────────────────

  /**
   * Build the plain-text and HTML email body for a report snapshot.
   * Pure: no side effects, no network calls. Safe to call in tests without
   * a real email provider.
   */
  buildReportEmail(
    report: ScheduledReport,
    snapshot: ReportAnalyticsSnapshot
  ): ReportEmailContent {
    const sym = snapshot.currencySymbol ?? '$';
    const name = snapshot.merchantName ?? snapshot.merchantId;
    const freq = report.frequency.charAt(0).toUpperCase() + report.frequency.slice(1);
    const subject = `[SubTrackr] ${freq} ${titleFor(report.reportType)} — ${name}`;

    const sections = buildSections(report.reportType, snapshot, sym);

    const textLines: string[] = [
      subject,
      `Period: ${snapshot.periodStart} – ${snapshot.periodEnd}`,
      '',
    ];
    const htmlParts: string[] = [
      `<h2>${escapeHtml(subject)}</h2>`,
      `<p><strong>Period:</strong> ${escapeHtml(snapshot.periodStart)} – ${escapeHtml(snapshot.periodEnd)}</p>`,
    ];

    for (const [heading, rows] of sections) {
      textLines.push(heading.toUpperCase(), '─'.repeat(40));
      htmlParts.push(`<h3>${escapeHtml(heading)}</h3><table><tbody>`);
      for (const [label, value] of rows) {
        textLines.push(`  ${label}: ${value}`);
        htmlParts.push(
          `<tr><td style="padding:2px 8px;color:#555">${escapeHtml(label)}</td>` +
          `<td style="padding:2px 8px;font-weight:bold">${escapeHtml(value)}</td></tr>`
        );
      }
      textLines.push('');
      htmlParts.push('</tbody></table>');
    }

    textLines.push('—', 'SubTrackr Reporting');
    htmlParts.push('<p style="color:#999;font-size:12px">&mdash; SubTrackr Reporting</p>');

    return {
      subject,
      text: textLines.join('\n'),
      html: htmlParts.join(''),
    };
  }

  /**
   * Send a report to all active recipients of a single schedule.
   * Partial failures are collected and returned; one bad address does not
   * block the rest.
   */
  async sendReport(
    report: ScheduledReport,
    snapshot: ReportAnalyticsSnapshot
  ): Promise<SendReportResult> {
    const { subject, text, html } = this.buildReportEmail(report, snapshot);
    const now = this.now();
    const errors: SendReportResult['errors'] = [];
    let succeeded = 0;

    for (const recipient of report.recipients) {
      const message: EmailMessage = {
        to: { email: recipient },
        from: { email: this.fromAddress },
        subject,
        text,
        html,
        tags: ['scheduled-report', `report-type:${report.reportType}`, `frequency:${report.frequency}`],
      };
      try {
        const result = await this.emailProvider.send(message);
        if (result.success) {
          succeeded += 1;
        } else {
          errors.push({ recipient, error: result.error ?? 'Unknown delivery error' });
        }
      } catch (err) {
        errors.push({ recipient, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Advance the schedule's timestamps whether delivery succeeded or not, so
    // a broken address does not cause an infinite retry loop.
    const advanced: ScheduledReport = {
      ...report,
      lastSentAt: now.toISOString(),
      nextSendAt: nextSendAt(now, report.frequency).toISOString(),
      updatedAt: now.toISOString(),
    };
    this.store.save(advanced);

    return {
      reportId: report.id,
      recipientCount: report.recipients.length,
      succeeded,
      failed: errors.length,
      errors,
      sentAt: now.toISOString(),
    };
  }

  /**
   * Run all schedules that are currently due.
   *
   * `snapshotFor` must be provided by the caller so the service stays
   * decoupled from the analytics layer — pass a function that calls
   * `SubscriptionAnalyticsService.compute()` or returns a stub in tests.
   */
  async runDue(
    snapshotFor: (merchantId: string) => ReportAnalyticsSnapshot | Promise<ReportAnalyticsSnapshot>
  ): Promise<RunDueSummary> {
    const now = this.now();
    const due = this.store.findDue(now);
    const results: SendReportResult[] = [];
    let skipped = 0;

    for (const report of due) {
      if (report.recipients.length === 0) {
        skipped += 1;
        continue;
      }
      try {
        const snapshot = await snapshotFor(report.merchantId);
        const result = await this.sendReport(report, snapshot);
        results.push(result);
      } catch (err) {
        // Record a synthetic result so callers can see what failed.
        results.push({
          reportId: report.id,
          recipientCount: report.recipients.length,
          succeeded: 0,
          failed: report.recipients.length,
          errors: [{ recipient: '(all)', error: err instanceof Error ? err.message : String(err) }],
          sentAt: now.toISOString(),
        });
      }
    }

    return {
      considered: due.length,
      fired: results.length,
      skipped,
      results,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private generateId(): string {
    return `sr_${Date.now()}_${++this.idCounter}`;
  }
}

// ─── Local helpers ────────────────────────────────────────────────────────────

function titleFor(type: ReportType): string {
  switch (type) {
    case 'analytics_summary': return 'Analytics Summary';
    case 'mrr_breakdown':     return 'MRR Breakdown';
    case 'churn_report':      return 'Churn Report';
    case 'full_report':       return 'Full Report';
  }
}

/**
 * Build the labelled sections for each report type.
 * Returns an array of [sectionHeading, [[label, value], …]] tuples.
 */
function buildSections(
  type: ReportType,
  s: ReportAnalyticsSnapshot,
  sym: string
): Array<[string, Array<[string, string]>]> {
  const revenueRows: Array<[string, string]> = [
    ['MRR', currency(s.mrr, sym)],
    ['ARR', currency(s.arr, sym)],
    ['MRR Growth', pct(s.mrrGrowthRate)],
    ['ARPU', currency(s.arpu, sym)],
    ['LTV', currency(s.ltv, sym)],
  ];

  const subscriberRows: Array<[string, string]> = [
    ['Active Subscribers', String(s.activeSubscribers)],
    ['New This Period', String(s.newSubscribersThisPeriod)],
    ['Churned', String(s.churned)],
  ];

  const churnRows: Array<[string, string]> = [
    ['Gross Churn Rate', pct(s.grossChurnRate)],
    ['Net Churn Rate', pct(s.netChurnRate)],
  ];

  switch (type) {
    case 'analytics_summary':
      return [
        ['Revenue', revenueRows.slice(0, 3)],
        ['Subscribers', subscriberRows],
      ];
    case 'mrr_breakdown':
      return [
        ['MRR Metrics', revenueRows],
      ];
    case 'churn_report':
      return [
        ['Subscribers', subscriberRows],
        ['Churn', churnRows],
      ];
    case 'full_report':
      return [
        ['Revenue', revenueRows],
        ['Subscribers', subscriberRows],
        ['Churn', churnRows],
      ];
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateCreateInput(input: CreateScheduledReportInput): void {
  if (!input.merchantId?.trim()) throw new Error('merchantId is required');
  if (!input.name?.trim()) throw new Error('name is required');
  if (!REPORT_TYPES.includes(input.reportType)) {
    throw new Error(`Invalid reportType: ${input.reportType}. Must be one of: ${REPORT_TYPES.join(', ')}`);
  }
  if (!REPORT_FREQUENCIES.includes(input.frequency)) {
    throw new Error(`Invalid frequency: ${input.frequency}. Must be one of: ${REPORT_FREQUENCIES.join(', ')}`);
  }
  if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
    throw new Error('At least one recipient is required');
  }
  for (const r of input.recipients) {
    if (!isValidEmail(r.trim())) throw new Error(`Invalid email address: ${r}`);
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

export function createScheduledReportService(
  deps: ScheduledReportServiceDeps
): ScheduledReportService {
  return new ScheduledReportService(deps);
}
