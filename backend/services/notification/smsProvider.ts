/**
 * SMS service provider — Twilio Programmable Messaging.
 *
 * Exports:
 *   SmsProvider interface       — contract used by the rest of the backend.
 *   TwilioSmsProvider           — real implementation via the Twilio REST API.
 *   buildSmsTransport()         — ChannelTransport adapter for
 *                                 NotificationCenterService.registerTransport('sms', …).
 *   buildLegacySmseSender()     — sendSms() adapter matching NotificationServiceImpl.
 *   createSmsProviderFromEnv()  — factory that reads env vars.
 *   createStubSmsProvider()     — no-op for environments without credentials.
 *   smsProvider                 — module-level singleton.
 *
 * Twilio features used
 * ────────────────────
 *   • Messages API v1 (POST /2010-04-01/Accounts/{Sid}/Messages.json)
 *   • HTTP Basic Auth (Account SID : Auth Token)
 *   • Opt-out / DND check via our own opt-out store (no Twilio SDK needed)
 *   • Message status callbacks wired through TWILIO_STATUS_CALLBACK_URL
 *   • Messaging Services (alpha-numeric sender) via TWILIO_MESSAGING_SERVICE_SID
 *   • Character-count helpers and multi-part SMS detection
 *
 * No Twilio Node SDK is used — plain `fetch` keeps the bundle clean and
 * avoids a heavy dependency that's unnecessary now that fetch is built in.
 */

import type { ChannelTransport } from './notificationCenterService';

// ─── Core types ───────────────────────────────────────────────────────────────

export interface SmsMessage {
  /** E.164 format, e.g. "+14155552671". */
  to: string;
  body: string;
  /** Override the configured from number for this message. */
  from?: string;
  /** Twilio Messaging Service SID — if set, `from` is ignored. */
  messagingServiceSid?: string;
  /** URL Twilio will POST status updates to. */
  statusCallback?: string;
  /** Arbitrary metadata passed through to delivery records. */
  tags?: Record<string, string>;
}

export interface SmsResult {
  success: boolean;
  messageId?: string;   // Twilio message SID (SM…)
  provider: 'twilio' | 'stub';
  status?: string;      // Twilio message status at send time
  errorCode?: number;   // Twilio error code when success=false
  error?: string;
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<SmsResult>;
  readonly providerName: 'twilio' | 'stub';
}

// ─── Character-count helpers ──────────────────────────────────────────────────

const GSM_7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1BÆæßÉ !"#¤%&\'()*+,-./' +
  '0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
);

/** Returns true when every character in `text` is in the GSM-7 basic set. */
export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM_7_BASIC.has(ch)) return false;
  }
  return true;
}

/**
 * Calculate the number of SMS segments this message will use.
 *   GSM-7 :  160 chars single part / 153 chars per part multi-part
 *   Unicode: 70  chars single part / 67  chars per part multi-part
 */
export function smsSegmentCount(text: string): { segments: number; encoding: 'gsm7' | 'unicode' } {
  const gsm = isGsm7(text);
  const len = text.length;
  const singleLimit = gsm ? 160 : 70;
  const multiLimit = gsm ? 153 : 67;

  if (len <= singleLimit) return { segments: 1, encoding: gsm ? 'gsm7' : 'unicode' };
  return {
    segments: Math.ceil(len / multiLimit),
    encoding: gsm ? 'gsm7' : 'unicode',
  };
}

/** Truncate a message body to fit within `maxSegments` SMS segments. */
export function truncateSms(text: string, maxSegments = 3): string {
  const gsm = isGsm7(text);
  const multiLimit = gsm ? 153 : 67;
  const maxChars = maxSegments * multiLimit;
  if (text.length <= maxChars) return text;
  const ellipsis = '…';
  return text.slice(0, maxChars - ellipsis.length) + ellipsis;
}

// ─── Opt-out store ────────────────────────────────────────────────────────────

/**
 * In-process opt-out registry.
 * In production this would be backed by Redis or a DB table that is also
 * updated by Twilio's STOP/START webhook.
 */
class OptOutStore {
  private readonly optedOut = new Set<string>();

  optOut(phoneNumber: string): void {
    this.optedOut.add(this.normalise(phoneNumber));
  }

  optIn(phoneNumber: string): void {
    this.optedOut.delete(this.normalise(phoneNumber));
  }

  isOptedOut(phoneNumber: string): boolean {
    return this.optedOut.has(this.normalise(phoneNumber));
  }

  private normalise(phone: string): string {
    // Strip spaces/dashes/parens but keep leading +
    return phone.replace(/[\s\-().]/g, '');
  }
}

export const optOutStore = new OptOutStore();

// ─── TwilioSmsProvider ────────────────────────────────────────────────────────

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** Default "From" number in E.164 format, e.g. "+15017122661". */
  fromNumber: string;
  /** Twilio Messaging Service SID — takes precedence over `fromNumber`. */
  messagingServiceSid?: string;
  /** URL Twilio will POST delivery status updates to. */
  statusCallbackUrl?: string;
  /** Cap long messages to this many segments. Default: 3. */
  maxSegments?: number;
  /** Base URL override for testing / Twilio proxy. */
  baseUrl?: string;
}

export class TwilioSmsProvider implements SmsProvider {
  readonly providerName = 'twilio' as const;
  private readonly baseUrl: string;
  private readonly maxSegments: number;

  constructor(private readonly config: TwilioConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.twilio.com';
    this.maxSegments = config.maxSegments ?? 3;
  }

  async send(message: SmsMessage): Promise<SmsResult> {
    // Respect opt-out before any network call.
    if (optOutStore.isOptedOut(message.to)) {
      return {
        success: false,
        provider: 'twilio',
        error: `${message.to} has opted out of SMS notifications`,
      };
    }

    // Trim to max segment budget.
    const body = truncateSms(message.body, this.maxSegments);
    const { segments } = smsSegmentCount(body);
    if (segments > this.maxSegments) {
      console.warn(
        `[TwilioSmsProvider] Message to ${message.to} exceeds ${this.maxSegments} segments — truncated`
      );
    }

    // Build form-encoded body as required by the Twilio Messages REST API.
    const params = new URLSearchParams();
    params.append('To', message.to);
    params.append('Body', body);

    const msSid = message.messagingServiceSid ?? this.config.messagingServiceSid;
    if (msSid) {
      params.append('MessagingServiceSid', msSid);
    } else {
      params.append('From', message.from ?? this.config.fromNumber);
    }

    const callbackUrl = message.statusCallback ?? this.config.statusCallbackUrl;
    if (callbackUrl) {
      params.append('StatusCallback', callbackUrl);
    }

    const url =
      `${this.baseUrl}/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;
    const credentials = Buffer.from(
      `${this.config.accountSid}:${this.config.authToken}`
    ).toString('base64');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await response.json().catch(() => ({}));

      if (response.ok) {
        return {
          success: true,
          messageId: data?.sid,
          provider: 'twilio',
          status: data?.status,
        };
      }

      // Twilio error response: { code, message, more_info, status }
      return {
        success: false,
        provider: 'twilio',
        errorCode: data?.code,
        error: data?.message ?? `Twilio returned HTTP ${response.status}`,
      };
    } catch (err) {
      return {
        success: false,
        provider: 'twilio',
        error: err instanceof Error ? err.message : 'Twilio request failed',
      };
    }
  }
}

// ─── ChannelTransport adapter ─────────────────────────────────────────────────

/**
 * Build a `ChannelTransport` for `NotificationCenterService.registerTransport('sms', …)`.
 *
 * The `data` bag on the deliver call must contain:
 *   data.phone  — E.164 phone number of the recipient
 *
 * The notification `body` is sent as the SMS text, truncated to fit 3 segments.
 */
export function buildSmsTransport(provider: SmsProvider): ChannelTransport {
  return async ({ userId, body, data }) => {
    const phone = data?.['phone'];
    if (!phone) {
      console.warn(`[SmsTransport] No phone number for user ${userId}`);
      return false;
    }

    const result = await provider.send({ to: phone, body });
    if (!result.success) {
      console.error(
        `[SmsTransport] Delivery to ${phone} failed: ${result.error}` +
          (result.errorCode ? ` (code ${result.errorCode})` : '')
      );
    }
    return result.success;
  };
}

/**
 * Build a `sendSms` function matching the `NotificationService` interface
 * used by the legacy alerting domain (`NotificationServiceImpl`).
 */
export function buildLegacySmsSender(
  provider: SmsProvider
): (userId: string, message: string, phone: string) => Promise<void> {
  return async (userId, message, phone) => {
    const result = await provider.send({ to: phone, body: message });
    if (!result.success) {
      console.error(
        `[SmsProvider] Failed to send SMS to user ${userId} (${phone}): ${result.error}`
      );
    }
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a `SmsProvider` from environment variables.
 *
 * Required:
 *   TWILIO_ACCOUNT_SID   — Twilio Account SID (starts with AC…)
 *   TWILIO_AUTH_TOKEN    — Twilio Auth Token
 *   TWILIO_FROM_NUMBER   — E.164 sender number, e.g. +15017122661
 *
 * Optional:
 *   TWILIO_MESSAGING_SERVICE_SID  — use a Messaging Service instead of a number
 *   TWILIO_STATUS_CALLBACK_URL    — URL for delivery status webhooks
 *   TWILIO_MAX_SEGMENTS           — cap message length (default: 3 segments)
 */
export function createSmsProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): SmsProvider {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const fromNumber = env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn(
      '[SmsProvider] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER not set ' +
        '— falling back to stub SMS provider'
    );
    return createStubSmsProvider();
  }

  const maxSegments = env.TWILIO_MAX_SEGMENTS ? parseInt(env.TWILIO_MAX_SEGMENTS, 10) : 3;

  return new TwilioSmsProvider({
    accountSid,
    authToken,
    fromNumber,
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
    statusCallbackUrl: env.TWILIO_STATUS_CALLBACK_URL,
    maxSegments: Number.isNaN(maxSegments) ? 3 : maxSegments,
  });
}

// ─── Stub ─────────────────────────────────────────────────────────────────────

export function createStubSmsProvider(): SmsProvider {
  return {
    providerName: 'stub',
    async send(message: SmsMessage): Promise<SmsResult> {
      console.log(
        `[StubSmsProvider] Would send SMS to ${message.to}: "${message.body}"`
      );
      return { success: true, messageId: `stub-sms-${Date.now()}`, provider: 'stub' };
    },
  };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const smsProvider: SmsProvider = createSmsProviderFromEnv();
