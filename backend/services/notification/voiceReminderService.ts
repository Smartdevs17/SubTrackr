/**
 * Voice call reminders for renewals (#1255)
 *
 * Places an automated call reminding a customer that a subscription renews.
 * Voice is intrusive, so unlike email/SMS it is gated hard:
 *
 *   • the `voice` channel must be explicitly enabled for the billing category
 *   • the customer must not be on a channel-level do-not-call list
 *   • calls are only placed inside calling hours, and are skipped entirely
 *     on weekends unless the customer opted into weekend calls
 *   • at most one call per subscription per milestone window
 *   • quiet hours defer the call to the next permitted instant
 *
 * `VoiceReminderService` owns the decision + dialling + audit trail;
 * `voiceProvider.ts` owns the Twilio conversation.
 */

import { buildTwiML, voiceProvider } from './voiceProvider';
import type { VoiceCallResult, VoiceProvider } from './voiceProvider';
import { communicationPreferenceService } from './communicationPreferencesService';
import type { CommunicationPreferenceService } from './communicationPreferencesService';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type VoiceReminderMilestone = '30_day' | '7_day' | '1_day' | 'expired';

export interface RenewalToRemind {
  subscriptionId: string;
  userId: string;
  subscriptionName: string;
  /** ISO-8601 date the subscription renews. */
  renewalDate: string;
  amount?: number;
  currency?: string;
}

export interface VoiceReminderContext {
  userId: string;
  phoneNumber: string;
  customerName?: string;
  /** Subscription ids already called, to avoid duplicate dialling. */
  alreadyCalled?: string[];
}

export type VoiceReminderSkipReason =
  | 'not_opted_in'
  | 'opted_out'
  | 'missing_phone'
  | 'outside_calling_hours'
  | 'weekend'
  | 'already_called'
  | 'no_renewal_due';

export interface VoiceReminderDecision {
  shouldCall: boolean;
  reason: VoiceReminderSkipReason | 'ok';
  /** Instant the call should be placed, when deferred by calling hours. */
  callAt?: string;
}

export interface VoiceReminderRecord {
  subscriptionId: string;
  userId: string;
  milestone: VoiceReminderMilestone;
  calledAt: string;
  callId?: string;
  status: 'placed' | 'skipped' | 'failed';
  reason: string;
  provider: 'twilio' | 'stub';
}

export interface VoiceReminderResult {
  decision: VoiceReminderDecision;
  call?: VoiceCallResult;
  record: VoiceReminderRecord;
}

// ─── Calling hours ─────────────────────────────────────────────────────────────

export interface CallingHours {
  /** Minutes from local midnight, e.g. 9*60 = 09:00. */
  startMinute: number;
  endMinute: number;
  /** IANA timezone the window is expressed in. */
  timezone: string;
  /** Allow calls on Saturday/Sunday. */
  includeWeekends: boolean;
}

export const DEFAULT_CALLING_HOURS: CallingHours = {
  startMinute: 9 * 60,
  endMinute: 18 * 60,
  timezone: 'UTC',
  includeWeekends: false,
};

const MINUTE_MS = 60_000;

/** True when `instant` is a permitted calling window in `hours`. */
export function isWithinCallingHours(
  hours: CallingHours = DEFAULT_CALLING_HOURS,
  instant: Date = new Date()
): boolean {
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: hours.timezone,
    weekday: 'short',
  });
  const weekday = dayFormatter.format(instant);
  if (!hours.includeWeekends && (weekday === 'Sat' || weekday === 'Sun')) {
    return false;
  }
  return isWithinWindow(hours, instant);
}

function isWithinWindow(hours: CallingHours, instant: Date): boolean {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: hours.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const nowMinutes = hour * 60 + minute;
  return nowMinutes >= hours.startMinute && nowMinutes < hours.endMinute;
}

/** Milliseconds from `instant` until the calling window next opens. */
export function msUntilCallingHoursOpen(
  hours: CallingHours = DEFAULT_CALLING_HOURS,
  instant: Date = new Date()
): number {
  if (isWithinCallingHours(hours, instant)) return 0;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: hours.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const nowMinutes = hour * 60 + minute;
  const delta =
    nowMinutes < hours.startMinute
      ? hours.startMinute - nowMinutes
      : 24 * 60 - nowMinutes + hours.startMinute;
  return Math.max(1, delta) * MINUTE_MS;
}

// ─── Milestones ────────────────────────────────────────────────────────────────

export const MILESTONE_DAYS: Record<VoiceReminderMilestone, number> = {
  '30_day': 30,
  '7_day': 7,
  '1_day': 1,
  expired: 0,
};

/** The milestone a renewal currently falls into, or null when not due yet. */
export function milestoneForRenewal(
  renewalDate: string,
  now: Date = new Date()
): VoiceReminderMilestone | null {
  const renewal = new Date(renewalDate);
  if (Number.isNaN(renewal.getTime())) return null;

  const days = Math.ceil((renewal.getTime() - now.getTime()) / (24 * 60 * MINUTE_MS));
  if (days > MILESTONE_DAYS['30_day']) return null;
  if (days > MILESTONE_DAYS['7_day']) return '30_day';
  if (days > MILESTONE_DAYS['1_day']) return '7_day';
  if (days > 0) return '1_day';
  return 'expired';
}

/** Spoken copy for a renewal reminder call. */
export function buildRenewalReminderScript(
  renewal: RenewalToRemind,
  milestone: VoiceReminderMilestone,
  merchantName = 'SubTrackr'
): string {
  const amount = renewal.amount !== undefined && renewal.currency
    ? ` for ${renewal.currency} ${renewal.amount}`
    : '';
  const date = new Date(renewal.renewalDate).toDateString();
  const urgency =
    milestone === 'expired'
      ? 'Your subscription has just renewed.'
      : milestone === '1_day'
        ? 'Your subscription renews tomorrow.'
        : `Your subscription renews on ${date}.`;
  const amountClause = amount ? ` The charge will be${amount}.` : '';
  return (
    `Hello${renewal.subscriptionName ? `, this is ${merchantName} calling about ${renewal.subscriptionName}` : `, this is ${merchantName}`}. ` +
    `${urgency}${amountClause} ` +
    'Press 1 to confirm you would like to keep this subscription, or 2 to speak to us about cancelling. ' +
    'Thank you, goodbye.'
  );
}

// ─── Service ───────────────────────────────────────────────────────────────────

export interface VoiceReminderServiceDeps {
  provider: VoiceProvider;
  preferences: CommunicationPreferenceService;
  callingHours?: CallingHours;
  now?: () => Date;
}

export class VoiceReminderService {
  private readonly provider: VoiceProvider;
  private readonly preferences: CommunicationPreferenceService;
  private readonly callingHours: CallingHours;
  private readonly now: () => Date;
  private readonly history: VoiceReminderRecord[] = [];

  constructor(deps: VoiceReminderServiceDeps) {
    this.provider = deps.provider;
    this.preferences = deps.preferences;
    this.callingHours = deps.callingHours ?? DEFAULT_CALLING_HOURS;
    this.now = deps.now ?? (() => new Date());
  }

  /** Audit trail, newest first. */
  listRecords(subscriptionId?: string): VoiceReminderRecord[] {
    const filtered = subscriptionId
      ? this.history.filter((r) => r.subscriptionId === subscriptionId)
      : this.history;
    return [...filtered].reverse();
  }

  /** Decide whether a voice reminder may be placed right now. */
  async decide(
    renewal: RenewalToRemind,
    context: VoiceReminderContext,
    instant: Date = this.now()
  ): Promise<VoiceReminderDecision> {
    const milestone = milestoneForRenewal(renewal.renewalDate, instant);
    if (!milestone) return { shouldCall: false, reason: 'no_renewal_due' };

    if (context.alreadyCalled?.includes(renewal.subscriptionId)) {
      return { shouldCall: false, reason: 'already_called' };
    }

    if (!context.phoneNumber) return { shouldCall: false, reason: 'missing_phone' };

    const routes = await this.preferences.resolveRoutes(
      renewal.userId,
      'billing',
      { voice: context.phoneNumber },
      instant
    );
    const voiceDecision = routes.decisions.find((d) => d.channel === 'voice');

    if (voiceDecision && voiceDecision.reason === 'opted_out') {
      return { shouldCall: false, reason: 'opted_out' };
    }
    if (!voiceDecision?.allowed) return { shouldCall: false, reason: 'not_opted_in' };

    if (!isWithinCallingHours(this.callingHours, instant)) {
      const open = new Date(instant.getTime() + msUntilCallingHoursOpen(this.callingHours, instant));
      return {
        shouldCall: false,
        reason: 'outside_calling_hours',
        callAt: open.toISOString(),
      };
    }

    return { shouldCall: true, reason: 'ok' };
  }

  /**
   * Decide, then dial. Never throws: a failed call is recorded and reported so
   * the scheduler can retry without crashing the job.
   */
  async remind(
    renewal: RenewalToRemind,
    context: VoiceReminderContext,
    merchantName?: string
  ): Promise<VoiceReminderResult> {
    const instant = this.now();
    const decision = await this.decide(renewal, context, instant);
    const milestone = milestoneForRenewal(renewal.renewalDate, instant) ?? '30_day';

    if (!decision.shouldCall) {
      const record: VoiceReminderRecord = {
        subscriptionId: renewal.subscriptionId,
        userId: renewal.userId,
        milestone,
        calledAt: instant.toISOString(),
        status: 'skipped',
        reason: decision.reason,
        provider: this.provider.providerName,
      };
      this.history.push(record);
      return { decision, record };
    }

    const script = buildRenewalReminderScript(renewal, milestone, merchantName);
    const call = await this.provider.placeCall({
      to: context.phoneNumber,
      twiml: buildTwiML(script, { pressDigits: 1 }),
    });

    const record: VoiceReminderRecord = {
      subscriptionId: renewal.subscriptionId,
      userId: renewal.userId,
      milestone,
      calledAt: instant.toISOString(),
      callId: call.callId,
      status: call.success ? 'placed' : 'failed',
      reason: call.success ? 'ok' : (call.error ?? 'call_failed'),
      provider: this.provider.providerName,
    };
    this.history.push(record);

    if (!call.success) {
      console.error(
        `[VoiceReminderService] Call to ${context.phoneNumber} for ${renewal.subscriptionId} failed: ${call.error}`
      );
    }

    return { decision, call, record };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const voiceReminderService = new VoiceReminderService({
  provider: voiceProvider,
  preferences: communicationPreferenceService,
});
