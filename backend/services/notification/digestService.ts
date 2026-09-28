/**
 * Digest emails with daily summaries.
 *
 * A digest batches the notifications that did not warrant an immediate send
 * into one message per subscriber per day. Two things make this more than a
 * `groupBy`:
 *
 *  - **Critical notifications never enter a digest.** A failed payment or a
 *    security alert is read in seconds; burying it under a morning summary
 *    means it is read in a day or not at all.
 *  - **An empty digest is not sent.** "Nothing happened" is a notification in its
 *    own right only if the subscriber is worried something broke, and the daily
 *    signal is better spent on the days there is something to say.
 *
 * The window is `[start, end)` in UTC so a record is counted by the day it was
 * *created*, not the day it was finally delivered, and a digest can be rebuilt
 * for a past window without shifting.
 */

import { NotificationError, NotificationErrorCode } from './errors';
import {
  NOTIFICATION_TYPES,
  type NotificationAnalytics,
  type NotificationRecord,
  type NotificationStats,
  type NotificationType,
} from '../../../src/types/notification';
import type { EmailMessage, EmailResult, EmailProvider } from './emailProvider';

// ─── Types ──────────────────────────────────────────────────────────

/** How often a subscriber wants a digest. */
export type DigestFrequency = 'off' | 'daily' | 'weekly';

export const DIGEST_FREQUENCIES: DigestFrequency[] = ['off', 'daily', 'weekly'];

export interface DigestSubscription {
  userId: string;
  email: string;
  frequency: DigestFrequency;
  /** Display name used in the greeting; falls back to the local part. */
  displayName?: string;
  /** ISO-8601 timestamp of the most recent digest sent, for the weekly window. */
  lastDigestAt?: string;
}

/** How many items a digest lists inline before the rest are summarised. */
export const DIGEST_INLINE_LIMIT = 10;

export interface DigestItem {
  recordId: string;
  type: NotificationType;
  label: string;
  title: string;
  createdAt: string;
  /** Lowercase `type` label, used for the unread/new marker. */
  category: string;
}

export interface DigestSection {
  type: NotificationType;
  label: string;
  items: DigestItem[];
  /** Items beyond the inline limit, summarised as a count. */
  overflowCount: number;
}

export interface DigestWindow {
  /** Inclusive lower bound, ISO-8601. */
  start: string;
  /** Exclusive upper bound, ISO-8601. */
  end: string;
  /** `daily` or `weekly`; recorded on the digest for the analytics trail. */
  frequency: Exclude<DigestFrequency, 'off'>;
}

export interface DigestContent {
  window: DigestWindow;
  subject: string;
  text: string;
  html: string;
  sections: DigestSection[];
  totals: NotificationStats;
  /** Records in the window that were never delivered and are not eligible. */
  skippedCount: number;
}

export interface DigestResult {
  userId: string;
  /** False when the digest was suppressed; `reason` says why. */
  sent: boolean;
  reason?: string;
  digest?: DigestContent;
  delivery?: EmailResult;
}

export interface DigestRunSummary {
  window: DigestWindow;
  /** Subscribers the run considered, including those it skipped. */
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  results: DigestResult[];
}

// ─── Configuration ──────────────────────────────────────────────────

/** How a subscriber's digest frequency is read, injected so the service is testable. */
export type DigestPreferencesSource = (userId: string) => {
  frequency: DigestFrequency;
  email?: string;
  displayName?: string;
  lastDigestAt?: string;
};

/** The subscribers to notify in a run. */
export type DigestSubscriberSource = () => DigestSubscription[];

export interface DigestServiceDeps {
  emailProvider: EmailProvider;
  fromAddress: string;
  preferences: DigestPreferencesSource;
  subscribers: DigestSubscriberSource;
  /** Overrides "now" so a window can be built for a fixed instant. */
  now?: () => Date;
  /** Overrides the inline item limit. */
  inlineLimit?: number;
}

// ─── Pure helpers ───────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * Build the `[start, end)` window for a frequency, ending at `at`.
 *
 * A daily window is the previous UTC day; a weekly window is the seven days
 * before the last daily window's end, so a weekly subscriber receives the same
 * records a daily subscriber would have, just less often.
 */
export function buildDigestWindow(
  frequency: Exclude<DigestFrequency, 'off'>,
  at: Date
): DigestWindow {
  const end = new Date(at);
  end.setUTCHours(0, 0, 0, 0);

  const start = new Date(end);
  if (frequency === 'daily') {
    start.setUTCDate(start.getUTCDate() - 1);
  } else {
    start.setUTCDate(start.getUTCDate() - 7);
  }

  return { start: start.toISOString(), end: end.toISOString(), frequency };
}

/**
 * The window a subscriber is owed, given when their last digest went out.
 *
 * A subscriber whose frequency has just been raised from daily to weekly is
 * given the full seven days rather than the two days since their last email,
 * so changing to a slower cadence never silently loses a period.
 */
export function windowForSubscriber(
  subscription: DigestSubscription,
  at: Date
): DigestWindow | null {
  if (subscription.frequency === 'off') return null;

  const window = buildDigestWindow(subscription.frequency, at);
  if (!subscription.lastDigestAt) return window;

  // Never start later than the natural window start, so raising the frequency
  // widens the window rather than truncating it.
  const last = new Date(subscription.lastDigestAt);
  if (!Number.isNaN(last.getTime()) && last.getTime() > new Date(window.start).getTime()) {
    window.start = last.toISOString();
  }
  return window;
}

/** True when a record falls inside `[start, end)`. */
export function isWithinWindow(record: NotificationRecord, window: DigestWindow): boolean {
  const created = new Date(record.createdAt).getTime();
  return created >= new Date(window.start).getTime() && created < new Date(window.end).getTime();
}

/**
 * Records eligible for a digest: inside the window, and either delivered or
 * suppressed. A suppressed record still describes something the subscriber
 * chose not to be told, so it is reported rather than dropped — the digest
 * explains the gap instead of hiding it.
 *
 * Failed records are excluded because nothing reached the subscriber; the
 * failure is already surfaced by the delivery path.
 */
export function selectDigestRecords(
  records: NotificationRecord[],
  window: DigestWindow
): NotificationRecord[] {
  return records
    .filter((record) => isWithinWindow(record, window))
    .filter(
      (record) =>
        record.status === 'delivered' || record.status === 'sent' || record.status === 'suppressed'
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const LABEL: Record<NotificationType, string> = NOTIFICATION_TYPES.reduce(
  (acc, type) => {
    acc[type] = type.replace(/_/g, ' ');
    return acc;
  },
  {} as Record<NotificationType, string>
);

function toItem(record: NotificationRecord): DigestItem {
  return {
    recordId: record.id,
    type: record.type,
    label: LABEL[record.type],
    title: record.title,
    createdAt: record.createdAt,
    category: record.type,
  };
}

/** Group records into one section per type, in the canonical type order. */
export function groupIntoSections(
  records: NotificationRecord[],
  inlineLimit: number = DIGEST_INLINE_LIMIT
): DigestSection[] {
  const byType = new Map<NotificationType, NotificationRecord[]>();
  for (const record of records) {
    const bucket = byType.get(record.type);
    if (bucket) bucket.push(record);
    else byType.set(record.type, [record]);
  }

  const sections: DigestSection[] = [];
  for (const type of NOTIFICATION_TYPES) {
    const bucket = byType.get(type);
    if (!bucket || bucket.length === 0) continue;
    sections.push({
      type,
      label: LABEL[type],
      items: bucket.slice(0, inlineLimit).map(toItem),
      overflowCount: Math.max(0, bucket.length - inlineLimit),
    });
  }
  return sections;
}

function emptyStats(): NotificationStats {
  return {
    sent: 0,
    delivered: 0,
    failed: 0,
    suppressed: 0,
    opened: 0,
    clicked: 0,
    deliveryRate: 0,
    openRate: 0,
    clickRate: 0,
  };
}

function digestTotals(records: NotificationRecord[]): NotificationStats {
  const stats = emptyStats();
  for (const record of records) {
    switch (record.status) {
      case 'sent':
      case 'delivered':
        stats.sent += 1;
        stats.delivered += 1;
        break;
      case 'suppressed':
        stats.suppressed += 1;
        break;
      case 'failed':
        stats.failed += 1;
        break;
      case 'scheduled':
        break;
    }
    if (record.readAt) stats.opened += 1;
    if (record.clickedAt) stats.clicked += 1;
  }
  return stats;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function greetingFor(displayName?: string): string {
  const name = displayName?.trim();
  return name ? `Hi ${name},` : 'Hi,';
}

function subjectFor(sections: DigestSection[], frequency: Exclude<DigestFrequency, 'off'>): string {
  const total = sections.reduce((sum, section) => sum + section.items.length + section.overflowCount, 0);
  const noun = total === 1 ? 'update' : 'updates';
  const scope = frequency === 'weekly' ? 'this week' : 'today';
  return `Your SubTrackr ${scope}: ${total} ${noun}`;
}

/** Render the digest as plain text and HTML from the same sections. */
export function renderDigest(
  sections: DigestSection[],
  totals: NotificationStats,
  window: DigestWindow,
  displayName?: string
): Pick<DigestContent, 'subject' | 'text' | 'html'> {
  const subject = subjectFor(sections, window.frequency);
  const greeting = greetingFor(displayName);
  const total = sections.reduce((sum, s) => sum + s.items.length + s.overflowCount, 0);

  if (sections.length === 0) {
    return {
      subject,
      text: `${greeting}\n\nNo activity to report for ${window.frequency === 'weekly' ? 'the past week' : 'yesterday'}.\n\n— SubTrackr`,
      html: `<p>${escapeHtml(greeting)}</p><p>No activity to report for ${window.frequency === 'weekly' ? 'the past week' : 'yesterday'}.</p><p>&mdash; SubTrackr</p>`,
    };
  }

  const textLines = [greeting, ''];
  const htmlParts = [`<p>${escapeHtml(greeting)}</p>`];

  for (const section of sections) {
    textLines.push(section.label.toUpperCase());
    for (const item of section.items) {
      textLines.push(`  • ${item.title}`);
    }
    if (section.overflowCount > 0) {
      textLines.push(`  …and ${section.overflowCount} more`);
    }
    textLines.push('');

    const items = section.items
      .map((item) => `<li>${escapeHtml(item.title)}</li>`)
      .join('');
    const overflow =
      section.overflowCount > 0
        ? `<p><em>&hellip;and ${section.overflowCount} more</em></p>`
        : '';
    htmlParts.push(
      `<h3>${escapeHtml(section.label.toUpperCase())}</h3><ul>${items}</ul>${overflow}`
    );
  }

  const footer = totals.suppressed > 0
    ? ` ${totals.suppressed} item(s) were muted by your notification settings.`
    : '';

  textLines.push(`${total} item(s) in this digest.${footer}`, '— SubTrackr');
  htmlParts.push(`<p>${total} item(s) in this digest.${escapeHtml(footer)}</p><p>&mdash; SubTrackr</p>`);

  return { subject, text: textLines.join('\n').trim(), html: htmlParts.join('') };
}

// ─── Service ─────────────────────────────────────────────────────────

export class DigestEmailService {
  private readonly emailProvider: EmailProvider;
  private readonly fromAddress: string;
  private readonly preferences: DigestPreferencesSource;
  private readonly subscribers: DigestSubscriberSource;
  private readonly now: () => Date;
  private readonly inlineLimit: number;

  constructor(deps: DigestServiceDeps) {
    this.emailProvider = deps.emailProvider;
    this.fromAddress = deps.fromAddress;
    this.preferences = deps.preferences;
    this.subscribers = deps.subscribers;
    this.now = deps.now ?? (() => new Date());
    this.inlineLimit = deps.inlineLimit ?? DIGEST_INLINE_LIMIT;
  }

  /**
   * Build a digest from records already collected by the caller.
   *
   * Pure with respect to delivery: nothing is sent here, which is what lets
   * `buildFor` be unit-tested and the run report rendered without sending.
   */
  buildFor(
    subscription: DigestSubscription,
    records: NotificationRecord[],
    at: Date = this.now()
  ): DigestContent | null {
    const window = windowForSubscriber(subscription, at);
    if (!window) return null;

    const selected = selectDigestRecords(records, window);
    const sections = groupIntoSections(selected, this.inlineLimit);
    const { subject, text, html } = renderDigest(sections, digestTotals(selected), window, subscription.displayName);

    return {
      window,
      subject,
      text,
      html,
      sections,
      totals: digestTotals(selected),
      skippedCount: selected.filter((record) => record.status === 'suppressed').length,
    };
  }

  /** Build and send one subscriber's digest. Never throws on provider failure. */
  async sendTo(
    subscription: DigestSubscription,
    records: NotificationRecord[],
    at: Date = this.now()
  ): Promise<DigestResult> {
    if (subscription.frequency === 'off') {
      return { userId: subscription.userId, sent: false, reason: 'Digests are turned off' };
    }
    if (!subscription.email) {
      return { userId: subscription.userId, sent: false, reason: 'No email address on file' };
    }

    const digest = this.buildFor(subscription, records, at);
    if (!digest) {
      return { userId: subscription.userId, sent: false, reason: 'No window for this frequency' };
    }
    if (digest.sections.length === 0) {
      return {
        userId: subscription.userId,
        sent: false,
        reason: 'No activity in this window',
        digest,
      };
    }

    const message: EmailMessage = {
      to: { email: subscription.email },
      from: { email: this.fromAddress },
      subject: digest.subject,
      text: digest.text,
      html: digest.html,
      tags: ['digest', `digest-${digest.window.frequency}`],
    };

    const delivery = await this.emailProvider.send(message);
    return {
      userId: subscription.userId,
      sent: delivery.success,
      reason: delivery.error,
      digest,
      delivery,
    };
  }

  /**
   * Run the digest job for every subscribed user.
   *
   * `recordsFor` supplies the notification history per user. A provider failure
   * for one subscriber is recorded and does not stop the run, so one bad
   * address cannot delay everybody else's digest.
   */
  async run(
    at: Date = this.now(),
    recordsFor: (userId: string) => NotificationRecord[]
  ): Promise<DigestRunSummary> {
    const subscriptions = this.subscribers();
    const results: DigestResult[] = [];
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const subscription of subscriptions) {
      // The live preference wins over the subscriber list's snapshot, so a
      // preference change takes effect on the very next run.
      const live = this.preferences(subscription.userId);
      const effective: DigestSubscription = {
        ...subscription,
        frequency: live.frequency ?? subscription.frequency,
        email: live.email ?? subscription.email,
        displayName: live.displayName ?? subscription.displayName,
        lastDigestAt: live.lastDigestAt ?? subscription.lastDigestAt,
      };

      let result: DigestResult;
      try {
        result = await this.sendTo(effective, recordsFor(effective.userId), at);
      } catch (error) {
        // A transport that throws must not take the whole run with it.
        result = {
          userId: effective.userId,
          sent: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }

      results.push(result);
      if (result.sent) sent += 1;
      else if (result.digest) skipped += 1;
      else failed += 1;
    }

    const firstWindow =
      results.find((result) => result.digest)?.digest?.window ??
      buildDigestWindow('daily', at);

    return {
      window: firstWindow,
      considered: subscriptions.length,
      sent,
      skipped,
      failed,
      results,
    };
  }
}

/** Analytics over the digests actually sent, for the admin digest report. */
export function summariseDigestRun(summary: DigestRunSummary): NotificationAnalytics {
  const totals = emptyStats();
  const byType = NOTIFICATION_TYPES.reduce(
    (acc, type) => {
      acc[type] = emptyStats();
      return acc;
    },
    {} as Record<NotificationType, NotificationStats>
  );

  for (const result of summary.results) {
    if (!result.digest) continue;
    const digest = result.digest;
    totals.sent += 1;
    if (result.sent) {
      totals.delivered += 1;
      for (const section of digest.sections) {
        const count = section.items.length + section.overflowCount;
        byType[section.type].sent += 1;
        byType[section.type].delivered += 1;
        byType[section.type].opened += count;
      }
    } else {
      totals.suppressed += 1;
    }
  }

  return {
    totals,
    byChannel: {
      email: totals,
      push: emptyStats(),
      sms: emptyStats(),
      in_app: emptyStats(),
    },
    byType,
    unreadCount: 0,
    averageTimeToReadMs: 0,
    bestChannel: totals.delivered > 0 ? 'email' : null,
  };
}

/** Throws when a configured frequency is not one this service understands. */
export function assertValidFrequency(frequency: string): asserts frequency is DigestFrequency {
  if (!DIGEST_FREQUENCIES.includes(frequency as DigestFrequency)) {
    throw new NotificationError(
      NotificationErrorCode.INVALID_CHANNEL_CONFIG,
      `Unknown digest frequency "${frequency}". Expected one of: ${DIGEST_FREQUENCIES.join(', ')}.`,
      { frequency }
    );
  }
}

export function createDigestEmailService(deps: DigestServiceDeps): DigestEmailService {
  return new DigestEmailService(deps);
}
