/**
 * Voice call provider — Twilio Programmable Voice.
 *
 * Exports:
 *   VoiceProvider interface      — contract used by the reminder services.
 *   TwilioVoiceProvider          — real implementation via the Twilio REST API.
 *   buildVoiceTransport()        — ChannelTransport adapter for the
 *                                  notification centre's channel registry.
 *   createVoiceProviderFromEnv() — factory that reads env vars.
 *   createStubVoiceProvider()    — no-op for environments without credentials.
 *   voiceProvider                — module-level singleton.
 *
 * Twilio features used
 * ────────────────────
 *   • Calls API (POST /2010-04-01/Accounts/{Sid}/Calls.json)
 *   • HTTP Basic Auth (Account SID : Auth Token)
 *   • Outbound TwiML returned inline with a `<Response>` document
 *   • Do-not-call check through the shared communication-preference service
 *
 * No Twilio Node SDK is used — plain `fetch`, matching `smsProvider.ts`.
 */

import type { ChannelTransport } from './notificationCenterService';

// ─── Core types ───────────────────────────────────────────────────────────────

export interface VoiceCallRequest {
  /** E.164 destination, e.g. "+14155552671". */
  to: string;
  /** TwiML spoken to the customer, or a lookup key rendered by the caller. */
  twiml: string;
  /** Override the configured caller ID. */
  from?: string;
  /** URL Twilio will POST call status updates to. */
  statusCallback?: string;
  /** Arbitrary metadata passed through to delivery records. */
  tags?: Record<string, string>;
}

export interface VoiceCallResult {
  success: boolean;
  callId?: string; // Twilio call SID (CA…)
  provider: 'twilio' | 'stub';
  status?: string;
  errorCode?: number;
  error?: string;
}

export interface VoiceProvider {
  placeCall(request: VoiceCallRequest): Promise<VoiceCallResult>;
  readonly providerName: 'twilio' | 'stub';
}

// ─── TwiML helpers ────────────────────────────────────────────────────────────

/** Escape the five XML entities TwiML cares about. */
export function escapeTwiml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wrap spoken copy in a `<Say>` verb. */
export function say(text: string, voice = 'alice'): string {
  return `<Say voice="${escapeTwiml(voice)}">${escapeTwiml(text)}</Say>`;
}

/**
 * Build a complete TwiML document for an outbound reminder call.
 *
 * @param speech  copy read out to the customer.
 * @param options.voice                  voice to read with (default `alice`).
 * @param options.initialSilenceSeconds  silence before the first word so an
 *                                        answering machine is picked up first.
 * @param options.pressDigits            when set, wraps the script in a
 *                                        `<Gather>` so the customer can press a
 *                                        key to acknowledge the reminder.
 */
export function buildTwiML(
  speech: string,
  options: {
    voice?: string;
    initialSilenceSeconds?: number;
    pressDigits?: number;
  } = {}
): string {
  const { voice = 'alice', initialSilenceSeconds = 2, pressDigits } = options;
  const spoken = say(speech, voice);

  const body = pressDigits
    ? `<Gather numDigits="${Math.min(20, Math.max(1, Math.floor(pressDigits)))}" timeout="10">${spoken}</Gather>`
    : spoken;

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Response>' +
    `<Pause length="${Math.max(0, Math.floor(initialSilenceSeconds))}"/>` +
    body +
    '</Response>'
  );
}

// ─── TwilioVoiceProvider ──────────────────────────────────────────────────────

export interface TwilioVoiceConfig {
  accountSid: string;
  authToken: string;
  /** Outbound caller ID in E.164 format, e.g. "+15017122661". */
  fromNumber: string;
  /** Optional Application SID — when set, TwiML is fetched from the app. */
  applicationSid?: string;
  statusCallbackUrl?: string;
  baseUrl?: string;
}

export class TwilioVoiceProvider implements VoiceProvider {
  readonly providerName = 'twilio' as const;
  private readonly baseUrl: string;

  constructor(private readonly config: TwilioVoiceConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.twilio.com';
  }

  async placeCall(request: VoiceCallRequest): Promise<VoiceCallResult> {
    if (!request.to) {
      return { success: false, provider: 'twilio', error: 'Destination number is required' };
    }
    if (!request.twiml && !this.config.applicationSid) {
      return {
        success: false,
        provider: 'twilio',
        error: 'Either twiml or a Twilio Application SID must be provided',
      };
    }

    const params = new URLSearchParams();
    params.append('To', request.to);
    params.append('From', request.from ?? this.config.fromNumber);
    if (this.config.applicationSid) {
      params.append('ApplicationSid', this.config.applicationSid);
    } else {
      params.append('Twiml', request.twiml);
    }

    const callbackUrl = request.statusCallback ?? this.config.statusCallbackUrl;
    if (callbackUrl) {
      params.append('StatusCallback', callbackUrl);
      params.append('StatusCallbackEvent', 'initiated ringing answered completed');
    }

    const url = `${this.baseUrl}/2010-04-01/Accounts/${this.config.accountSid}/Calls.json`;
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
          callId: data?.sid,
          provider: 'twilio',
          status: data?.status,
        };
      }

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
        error: err instanceof Error ? err.message : 'Twilio call request failed',
      };
    }
  }
}

// ─── ChannelTransport adapter ─────────────────────────────────────────────────

/**
 * Build a `ChannelTransport` for `NotificationCenterService.registerTransport('voice', …)`.
 *
 * The `data` bag on the deliver call must contain:
 *   data.phone — E.164 number to call
 *   data.script — plain-text reminder script to read out (optional; falls back
 *                 to the notification `body`)
 */
export function buildVoiceTransport(
  provider: VoiceProvider,
  scriptBuilder?: (body: string, data?: Record<string, unknown>) => string
): ChannelTransport {
  return async ({ userId, body, data }) => {
    const phone = data?.['phone'] as string | undefined;
    if (!phone) {
      console.warn(`[VoiceTransport] No phone number for user ${userId}`);
      return false;
    }

    const script = data?.['script'] as string | undefined;
    const speech = scriptBuilder
      ? scriptBuilder(body, data)
      : (script ?? `Hello, this is a reminder from SubTrackr. ${body}`);

    const result = await provider.placeCall({ to: phone, twiml: buildTwiML(speech) });
    if (!result.success) {
      console.error(
        `[VoiceTransport] Call to ${phone} failed: ${result.error}` +
          (result.errorCode ? ` (code ${result.errorCode})` : '')
      );
    }
    return result.success;
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a `VoiceProvider` from environment variables.
 *
 * Required:
 *   TWILIO_ACCOUNT_SID   — Twilio Account SID (starts with AC…)
 *   TWILIO_AUTH_TOKEN    — Twilio Auth Token
 *   VOICE_FROM_NUMBER    — E.164 caller ID that is allowed to place calls
 *
 * Optional:
 *   VOICE_APPLICATION_SID     — serve TwiML from a Twilio Voice app instead
 *   VOICE_STATUS_CALLBACK_URL — URL for call status webhooks
 *   VOICE_ENABLED             — set to "false" to force the stub provider
 */
export function createVoiceProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): VoiceProvider {
  if (env.VOICE_ENABLED === 'false') {
    console.warn('[VoiceProvider] VOICE_ENABLED=false — using stub voice provider');
    return createStubVoiceProvider();
  }

  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const fromNumber = env.VOICE_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn(
      '[VoiceProvider] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / VOICE_FROM_NUMBER not set ' +
        '— falling back to stub voice provider'
    );
    return createStubVoiceProvider();
  }

  return new TwilioVoiceProvider({
    accountSid,
    authToken,
    fromNumber,
    applicationSid: env.VOICE_APPLICATION_SID,
    statusCallbackUrl: env.VOICE_STATUS_CALLBACK_URL,
  });
}

// ─── Stub ─────────────────────────────────────────────────────────────────────

export function createStubVoiceProvider(): VoiceProvider {
  return {
    providerName: 'stub',
    async placeCall(request: VoiceCallRequest): Promise<VoiceCallResult> {
      console.warn(`[StubVoiceProvider] Would call ${request.to}`);
      return {
        success: true,
        callId: `stub-call-${Date.now()}`,
        provider: 'stub',
        status: 'queued',
      };
    },
  };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const voiceProvider: VoiceProvider = createVoiceProviderFromEnv();
