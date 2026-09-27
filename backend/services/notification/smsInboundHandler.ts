/**
 * Two-way SMS responses (#1256)
 *
 * Handles inbound SMS webhooks from Twilio: parses the form-encoded payload,
 * matches the message against a keyword map, and replies. This is what makes
 * SubTrackr notifications two-way — a customer can renew, pause, or opt out
 * by replying.
 *
 * Supported keywords
 * ──────────────────
 *   STOP / UNSUBSCRIBE / CANCEL / END / QUIT  → opt out of SMS entirely
 *   START / SUBSCRIBE / RESUBSCRIBE           → opt back in
 *   HELP / INFO                               → keyword help
 *   YES / RENEW / PAY                         → acknowledge a renewal reminder
 *   NO / PAUSE / HOLD                         → snooze a reminder for 7 days
 *   STATUS / BALANCE                          → next renewal summary
 *
 * Guarantees
 * ──────────
 *   • Idempotent — a replayed `MessageSid` is acknowledged, never re-executed.
 *   • Consent-safe — STOP is applied to the shared opt-out store *before* any
 *     reply is attempted, so we never text someone who asked us to stop.
 *   • Never throws — Twilio retries non-2xx responses; a handler that 500s on
 *     a customer typo would loop forever.
 */

import { optOutStore, smsProvider, truncateSms } from './smsProvider';
import type { SmsProvider } from './smsProvider';
import { communicationPreferenceService } from './communicationPreferencesService';
import type { CommunicationPreferenceService } from './communicationPreferencesService';

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Normalised inbound webhook payload (Twilio form fields, lower-cased). */
export interface InboundSms {
  messageSid: string;
  from: string;
  to: string;
  body: string;
  numMedia?: number;
}

export type SmsIntent =
  | 'opt_out'
  | 'opt_in'
  | 'help'
  | 'renew'
  | 'snooze'
  | 'status'
  | 'unknown';

export interface SmsCommand {
  intent: SmsIntent;
  /** Keyword that produced the intent, for logging. */
  keyword: string;
  /** Days to snooze for `snooze`. */
  snoozeDays?: number;
}

export interface SmsInboundResult {
  /** True when the reply was handed to the provider successfully. */
  handled: boolean;
  intent: SmsIntent;
  keyword: string;
  /** True when the MessageSid had already been processed. */
  duplicate: boolean;
  reply?: { to: string; body: string; messageId?: string };
  error?: string;
  /** Audit row for `sms_inbound_messages`. */
  record: InboundSmsAudit;
}

export interface InboundSmsAudit {
  messageSid: string;
  userId: string | null;
  from: string;
  intent: SmsIntent;
  keyword: string;
  handledAt: string;
  replyBody?: string;
  replyMessageId?: string;
  error?: string;
}

/** Raw Twilio request body — keys arrive with the exact casing Twilio sends. */
export type TwilioSmsPayload = Record<string, string | undefined>;

// ─── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parse a Twilio inbound-SMS form body.
 *
 * @throws {Error} when a required field is missing or malformed, so the
 *         webhook can answer 400 rather than acknowledge a blank message.
 */
export function parseInboundSms(payload: TwilioSmsPayload): InboundSms {
  const messageSid = (payload['MessageSid'] ?? payload['SmsSid'] ?? '').trim();
  const from = (payload['From'] ?? '').trim();
  const to = (payload['To'] ?? '').trim();
  const body = (payload['Body'] ?? '').trim();

  const missing: string[] = [];
  if (!messageSid) missing.push('MessageSid');
  if (!from) missing.push('From');
  if (!to) missing.push('To');

  if (missing.length) {
    throw new Error(`Inbound SMS is missing required field(s): ${missing.join(', ')}`);
  }
  if (!/^\+?[1-9]\d{6,14}$/.test(from.replace(/[\s\-().]/g, ''))) {
    throw new Error(`Inbound SMS has an invalid "From" address: ${from}`);
  }

  const numMediaRaw = payload['NumMedia'];
  return {
    messageSid,
    from,
    to,
    body,
    numMedia: numMediaRaw ? parseInt(numMediaRaw, 10) || undefined : undefined,
  };
}

// ─── Keyword map ──────────────────────────────────────────────────────────────

export const DEFAULT_KEYWORD_MAP: Record<string, SmsCommand> = {
  STOP: { intent: 'opt_out', keyword: 'STOP' },
  UNSUBSCRIBE: { intent: 'opt_out', keyword: 'UNSUBSCRIBE' },
  CANCEL: { intent: 'opt_out', keyword: 'CANCEL' },
  END: { intent: 'opt_out', keyword: 'END' },
  QUIT: { intent: 'opt_out', keyword: 'QUIT' },
  START: { intent: 'opt_in', keyword: 'START' },
  SUBSCRIBE: { intent: 'opt_in', keyword: 'SUBSCRIBE' },
  RESUBSCRIBE: { intent: 'opt_in', keyword: 'RESUBSCRIBE' },
  HELP: { intent: 'help', keyword: 'HELP' },
  INFO: { intent: 'help', keyword: 'INFO' },
  YES: { intent: 'renew', keyword: 'YES' },
  RENEW: { intent: 'renew', keyword: 'RENEW' },
  PAY: { intent: 'renew', keyword: 'PAY' },
  NO: { intent: 'snooze', keyword: 'NO', snoozeDays: 7 },
  PAUSE: { intent: 'snooze', keyword: 'PAUSE', snoozeDays: 7 },
  HOLD: { intent: 'snooze', keyword: 'HOLD', snoozeDays: 7 },
  STATUS: { intent: 'status', keyword: 'STATUS' },
  BALANCE: { intent: 'status', keyword: 'BALANCE' },
};

export const SNOOZE_DEFAULT_DAYS = 7;

/**
 * Match a message body against the keyword map.
 *
 * Exact match wins; otherwise the first word is matched, which handles
 * "STOP please" and "help 12345" without mis-firing on longer replies.
 */
export function matchCommand(
  body: string,
  keywordMap: Record<string, SmsCommand> = DEFAULT_KEYWORD_MAP
): SmsCommand {
  const normalised = body.trim().toUpperCase();
  if (!normalised) return { intent: 'unknown', keyword: '' };

  if (keywordMap[normalised]) return keywordMap[normalised];

  const firstWord = normalised.split(/[\s.,!?]+/)[0];
  if (firstWord && keywordMap[firstWord]) return keywordMap[firstWord];

  return { intent: 'unknown', keyword: '' };
}

export const HELP_MESSAGE = [
  'SubTrackr texts:',
  'STOP to unsubscribe, START to resubscribe.',
  'YES to confirm a renewal, NO to pause reminders for 7 days.',
  'STATUS for your upcoming renewals, HELP for this message.',
  'Msg&Data rates may apply.',
].join(' ');

// ─── Handler ───────────────────────────────────────────────────────────────────

/** Resolves a phone number to a user so preferences can be updated. */
export type UserIdLookup = (phoneNumber: string) => string | null | Promise<string | null>;

/** Action performed for a matched intent; swap for real domain calls. */
export interface SmsCommandActions {
  renew?: (userId: string, inbound: InboundSms) => Promise<void> | void;
  snooze?: (userId: string, days: number, inbound: InboundSms) => Promise<void> | void;
  status?: (userId: string) => Promise<string> | string;
}

export interface SmsInboundHandlerDeps {
  provider: SmsProvider;
  preferences: CommunicationPreferenceService;
  lookupUserByPhone: UserIdLookup;
  actions?: SmsCommandActions;
  keywordMap?: Record<string, SmsCommand>;
  /** Bounded set of processed MessageSids — swap for Redis in production. */
  seenMessageSids?: Set<string>;
  maxSeenMessageSids?: number;
  now?: () => Date;
}

export class SmsInboundHandler {
  private readonly provider: SmsProvider;
  private readonly preferences: CommunicationPreferenceService;
  private readonly lookupUserByPhone: UserIdLookup;
  private readonly actions: SmsCommandActions;
  private readonly keywordMap: Record<string, SmsCommand>;
  private readonly seen: Set<string>;
  private readonly maxSeen: number;
  private readonly now: () => Date;
  private readonly audit: InboundSmsAudit[] = [];

  constructor(deps: SmsInboundHandlerDeps) {
    this.provider = deps.provider;
    this.preferences = deps.preferences;
    this.lookupUserByPhone = deps.lookupUserByPhone;
    this.actions = deps.actions ?? {};
    this.keywordMap = deps.keywordMap ?? DEFAULT_KEYWORD_MAP;
    this.seen = deps.seenMessageSids ?? new Set<string>();
    this.maxSeen = deps.maxSeenMessageSids ?? 5000;
    this.now = deps.now ?? (() => new Date());
  }

  listAudit(): InboundSmsAudit[] {
    return [...this.audit].reverse();
  }

  /**
   * Handle one inbound SMS end-to-end.
   *
   * Never throws — transport-level retries must not turn a customer typo into
   * an infinite webhook loop. Failures are reported in the result.
   */
  async handle(payload: TwilioSmsPayload): Promise<SmsInboundResult> {
    let inbound: InboundSms;
    try {
      inbound = parseInboundSms(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse inbound SMS';
      this.audit.push({
        messageSid: (payload['MessageSid'] ?? '').trim() || 'unknown',
        userId: null,
        from: (payload['From'] ?? '').trim(),
        intent: 'unknown',
        keyword: '',
        handledAt: this.now().toISOString(),
        error: message,
      });
      return {
        handled: false,
        intent: 'unknown',
        keyword: '',
        duplicate: false,
        error: message,
        record: this.audit[this.audit.length - 1],
      };
    }

    if (this.seen.has(inbound.messageSid)) {
      const command = matchCommand(inbound.body, this.keywordMap);
      return {
        handled: true,
        intent: command.intent,
        keyword: command.keyword,
        duplicate: true,
        record: {
          messageSid: inbound.messageSid,
          userId: null,
          from: inbound.from,
          intent: command.intent,
          keyword: command.keyword,
          handledAt: this.now().toISOString(),
        },
      };
    }

    const command = matchCommand(inbound.body, this.keywordMap);
    let userId: string | null = null;
    // Default to the help text so an unknown number or a failed action still
    // gets something useful back rather than silence.
    let replyBody = HELP_MESSAGE;
    let error: string | undefined;

    try {
      userId = await this.lookupUserByPhone(inbound.from);

      // Consent changes are applied before any reply so an opted-out number is
      // never texted again, even if the reply itself fails.
      if (command.intent === 'opt_out') {
        optOutStore.optOut(inbound.from);
        if (userId) {
          await this.preferences.optOutChannel(
            userId,
            'sms',
            'inbound STOP',
            'inbound_sms'
          );
        }
        replyBody = 'You are unsubscribed from SubTrackr texts. Reply START to resubscribe.';
      } else if (command.intent === 'opt_in') {
        optOutStore.optIn(inbound.from);
        if (userId) {
          await this.preferences.optInChannel(userId, 'sms', 'inbound_sms');
        }
        replyBody = 'You are subscribed again. Reply HELP for options.';
      } else if (command.intent === 'help') {
        replyBody = HELP_MESSAGE;
      } else if (command.intent === 'renew') {
        if (userId) {
          await this.actions.renew?.(userId, inbound);
          replyBody = 'Thanks — your renewal is confirmed.';
        } else {
          replyBody = HELP_MESSAGE;
        }
      } else if (command.intent === 'snooze') {
        const days = command.snoozeDays ?? SNOOZE_DEFAULT_DAYS;
        if (userId) {
          await this.actions.snooze?.(userId, days, inbound);
          replyBody = `Reminders paused for ${days} days. Reply STATUS anytime.`;
        } else {
          replyBody = HELP_MESSAGE;
        }
      } else if (command.intent === 'status') {
        replyBody = userId
          ? (await this.actions.status?.(userId)) ?? 'No upcoming renewals on your account.'
          : HELP_MESSAGE;
      } else {
        replyBody = HELP_MESSAGE;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to process inbound SMS';
      console.error(`[SmsInboundHandler] ${inbound.messageSid} failed: ${error}`);
    }

    const truncated = truncateSms(replyBody);
    let reply: SmsInboundResult['reply'];
    // STOP is acknowledged by the opt-out itself: texting back to a number that
    // just opted out would be the one message we must not send.
    if (truncated && command.intent !== 'opt_out') {
      const sent = await this.provider.send({ to: inbound.from, body: truncated });
      if (sent.success) {
        reply = { to: inbound.from, body: truncated, messageId: sent.messageId };
      } else if (!error) {
        error = sent.error ?? 'Reply delivery failed';
      }
    }

    this.remember(inbound.messageSid);

    const record: InboundSmsAudit = {
      messageSid: inbound.messageSid,
      userId,
      from: inbound.from,
      intent: command.intent,
      keyword: command.keyword,
      handledAt: this.now().toISOString(),
      replyBody: command.intent === 'opt_out' ? undefined : truncated || undefined,
      replyMessageId: reply?.messageId,
      error,
    };
    this.audit.push(record);

    return {
      handled: !error,
      intent: command.intent,
      keyword: command.keyword,
      duplicate: false,
      reply,
      error,
      record,
    };
  }

  /** Bounded-memory dedupe: drop the oldest SIDs once the cap is reached. */
  private remember(messageSid: string): void {
    this.seen.add(messageSid);
    if (this.seen.size <= this.maxSeen) return;
    const oldest = this.seen.values().next();
    if (!oldest.done) this.seen.delete(oldest.value);
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

/**
 * Default handler. `lookupUserByPhone` is a no-op until the API layer wires a
 * real users-table lookup, so an unmatched number still gets the help text
 * instead of failing.
 */
export const smsInboundHandler = new SmsInboundHandler({
  provider: smsProvider,
  preferences: communicationPreferenceService,
  lookupUserByPhone: () => null,
});
