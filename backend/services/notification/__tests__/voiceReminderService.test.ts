/**
 * Voice call reminders for renewals (#1255)
 *
 * Covers: TwiML generation, provider success/failure responses, the
 * `createVoiceProviderFromEnv` factory, and the reminder service's gating
 * rules (opt-in, do-not-call, missing phone, calling hours, weekends,
 * duplicate suppression, provider failure).
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import {
  TwilioVoiceProvider,
  buildTwiML,
  buildVoiceTransport,
  createStubVoiceProvider,
  createVoiceProviderFromEnv,
  escapeTwiml,
  say,
} from '../voiceProvider';
import {
  VoiceReminderService,
  buildRenewalReminderScript,
  isWithinCallingHours,
  milestoneForRenewal,
  msUntilCallingHoursOpen,
  DEFAULT_CALLING_HOURS,
} from '../voiceReminderService';
import type { RenewalToRemind } from '../voiceReminderService';
import {
  CommunicationPreferenceService,
  InMemoryCommunicationPreferenceRepository,
} from '../communicationPreferencesService';

const CONFIG = {
  accountSid: 'ACtest',
  authToken: 'token',
  fromNumber: '+15017122661',
};

describe('TwiML helpers', () => {
  it('escapes XML entities', () => {
    expect(escapeTwiml('Bill & Dave <ops>')).toBe('Bill &amp; Dave &lt;ops&gt;');
  });

  it('wraps copy in a Say verb', () => {
    expect(say('hello')).toBe('<Say voice="alice">hello</Say>');
  });

  it('builds a document with an opening pause', () => {
    const twiml = buildTwiML('Your plan renews tomorrow.', { initialSilenceSeconds: 3 });
    expect(twiml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(twiml).toContain('<Pause length="3"/>');
    expect(twiml).toContain('Your plan renews tomorrow.');
  });

  it('wraps the script in a Gather when press-to-confirm digits are set', () => {
    expect(buildTwiML('Confirm?', { pressDigits: 1 })).toContain('<Gather numDigits="1"');
  });

  it('clamps the pause and digit count to sane values', () => {
    expect(buildTwiML('x', { initialSilenceSeconds: -5 })).toContain('<Pause length="0"/>');
    expect(buildTwiML('x', { pressDigits: 99 })).toContain('<Gather numDigits="20"');
  });
});

describe('TwilioVoiceProvider.placeCall', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts TwiML to the Calls endpoint and returns the call SID', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ sid: 'CA123', status: 'queued' }),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const provider = new TwilioVoiceProvider(CONFIG);
    const result = await provider.placeCall({ to: '+15550001111', twiml: '<Response/>' });

    expect(result).toEqual({ success: true, callId: 'CA123', provider: 'twilio', status: 'queued' });

    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest/Calls.json');
    expect(init.method).toBe('POST');
    expect(String((init.headers as Record<string, string>).Authorization)).toMatch(/^Basic /);
    expect(String(init.body)).toContain('Twiml=%3CResponse%2F%3E');
  });

  it('prefers an Application SID over inline TwiML', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ sid: 'CA1', status: 'queued' }),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const provider = new TwilioVoiceProvider({ ...CONFIG, applicationSid: 'AP123' });
    await provider.placeCall({ to: '+15550001111', twiml: '<Response/>' });

    const [, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain('ApplicationSid=AP123');
    expect(String(init.body)).not.toContain('Twiml=');
  });

  it('surfaces a Twilio error response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 21211, message: 'Invalid To number' }),
    }) as unknown as typeof global.fetch;

    const provider = new TwilioVoiceProvider(CONFIG);
    const result = await provider.placeCall({ to: 'not-a-number', twiml: '<Response/>' });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(21211);
    expect(result.error).toBe('Invalid To number');
  });

  it('rejects a call with no destination before hitting the network', async () => {
    const provider = new TwilioVoiceProvider(CONFIG);
    const result = await provider.placeCall({ to: '', twiml: '<Response/>' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Destination number is required/);
  });

  it('rejects a call with neither TwiML nor an Application SID', async () => {
    const provider = new TwilioVoiceProvider(CONFIG);
    const result = await provider.placeCall({ to: '+15550001111', twiml: '' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Twiml or a Twilio Application SID/);
  });

  it('returns an error when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof global.fetch;

    const provider = new TwilioVoiceProvider(CONFIG);
    const result = await provider.placeCall({ to: '+15550001111', twiml: '<Response/>' });
    expect(result).toMatchObject({ success: false, error: 'network down' });
  });
});

describe('createVoiceProviderFromEnv', () => {
  it('falls back to the stub when credentials are missing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(createVoiceProviderFromEnv({}).providerName).toBe('stub');
    expect(createVoiceProviderFromEnv({ TWILIO_ACCOUNT_SID: 'AC' }).providerName).toBe('stub');
    warn.mockRestore();
  });

  it('builds a Twilio provider when credentials are present', () => {
    const provider = createVoiceProviderFromEnv({
      TWILIO_ACCOUNT_SID: 'ACreal',
      TWILIO_AUTH_TOKEN: 'secret',
      VOICE_FROM_NUMBER: '+15017122661',
    });
    expect(provider.providerName).toBe('twilio');
  });

  it('honours VOICE_ENABLED=false even with credentials', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = createVoiceProviderFromEnv({
      TWILIO_ACCOUNT_SID: 'ACreal',
      TWILIO_AUTH_TOKEN: 'secret',
      VOICE_FROM_NUMBER: '+15017122661',
      VOICE_ENABLED: 'false',
    });
    expect(provider.providerName).toBe('stub');
    warn.mockRestore();
  });
});

describe('createStubVoiceProvider', () => {
  it('returns a queued stub call', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await createStubVoiceProvider().placeCall({ to: '+1555', twiml: '<Response/>' });
    expect(result.success).toBe(true);
    expect(result.callId).toMatch(/^stub-call-/);
    warn.mockRestore();
  });
});

describe('buildVoiceTransport', () => {
  const input = (data: Record<string, string>) => ({
    userId: 'u1',
    channel: 'sms' as const,
    subject: 'Renewal reminder',
    body: 'Your plan renews tomorrow',
    data,
  });

  it('returns false without a phone number', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const placeCall = jest.fn();
    const transport = buildVoiceTransport({ providerName: 'stub', placeCall: placeCall as never });
    expect(await transport(input({}))).toBe(false);
    expect(placeCall).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('uses the notification body as the script by default', async () => {
    const placeCall = jest.fn().mockResolvedValue({ success: true, provider: 'stub' });
    const transport = buildVoiceTransport({ providerName: 'stub', placeCall: placeCall as never });

    const ok = await transport(input({ phone: '+15550001111' }));

    expect(ok).toBe(true);
    expect(placeCall.mock.calls[0][0].twiml).toContain('Your plan renews tomorrow');
  });

  it('prefers an explicit script from the data bag', async () => {
    const placeCall = jest.fn().mockResolvedValue({ success: true, provider: 'stub' });
    const transport = buildVoiceTransport({ providerName: 'stub', placeCall: placeCall as never });

    await transport(input({ phone: '+15550001111', script: 'Custom spoken script' }));
    expect(placeCall.mock.calls[0][0].twiml).toContain('Custom spoken script');
  });

  it('returns false when the provider rejects the call', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const placeCall = jest
      .fn()
      .mockResolvedValue({ success: false, provider: 'twilio', error: 'busy', errorCode: 486 });
    const transport = buildVoiceTransport({ providerName: 'twilio', placeCall: placeCall as never });

    expect(await transport(input({ phone: '+15550001111' }))).toBe(false);
    errorLog.mockRestore();
  });
});

describe('milestoneForRenewal', () => {
  const now = new Date('2026-03-10T00:00:00.000Z');

  it('maps days-out to the matching milestone', () => {
    const inDays = (days: number) =>
      milestoneForRenewal(new Date(now.getTime() + days * 86_400_000).toISOString(), now);

    expect(inDays(20)).toBe('30_day');
    expect(inDays(5)).toBe('7_day');
    expect(inDays(1)).toBe('1_day');
    expect(inDays(-1)).toBe('expired');
  });

  it('returns null when the renewal is too far out or unparseable', () => {
    expect(milestoneForRenewal('2027-01-01T00:00:00.000Z', now)).toBeNull();
    expect(milestoneForRenewal('not-a-date', now)).toBeNull();
  });
});

describe('calling hours', () => {
  it('allows weekday hours and blocks the evening', () => {
    expect(isWithinCallingHours(DEFAULT_CALLING_HOURS, new Date('2026-03-10T10:00:00.000Z'))).toBe(true);
    expect(isWithinCallingHours(DEFAULT_CALLING_HOURS, new Date('2026-03-10T20:00:00.000Z'))).toBe(false);
  });

  it('blocks weekends unless opted in', () => {
    const saturday = new Date('2026-03-14T10:00:00.000Z');
    expect(isWithinCallingHours(DEFAULT_CALLING_HOURS, saturday)).toBe(false);
    expect(
      isWithinCallingHours({ ...DEFAULT_CALLING_HOURS, includeWeekends: true }, saturday)
    ).toBe(true);
  });

  it('reports zero wait when already inside the window', () => {
    expect(msUntilCallingHoursOpen(DEFAULT_CALLING_HOURS, new Date('2026-03-10T10:00:00.000Z'))).toBe(0);
    expect(
      msUntilCallingHoursOpen(DEFAULT_CALLING_HOURS, new Date('2026-03-10T07:00:00.000Z'))
    ).toBe(2 * 60 * 60 * 1000);
  });
});

describe('buildRenewalReminderScript', () => {
  const renewal: RenewalToRemind = {
    subscriptionId: 'sub-1',
    userId: 'user-1',
    subscriptionName: 'Pro Plan',
    renewalDate: '2026-03-11T00:00:00.000Z',
    amount: 49,
    currency: 'EUR',
  };

  it('includes the plan, amount and a press-to-confirm prompt', () => {
    const script = buildRenewalReminderScript(renewal, '1_day', 'Acme');
    expect(script).toContain('Pro Plan');
    expect(script).toContain('EUR 49');
    expect(script).toContain('Press 1');
  });

  it('omits the amount when the renewal has no price', () => {
    const script = buildRenewalReminderScript({ ...renewal, amount: undefined }, '7_day');
    expect(script).not.toContain('The charge will be for');
  });
});

describe('VoiceReminderService', () => {
  const NOW = new Date('2026-03-10T10:00:00.000Z');
  const RENEWAL: RenewalToRemind = {
    subscriptionId: 'sub-1',
    userId: 'user-1',
    subscriptionName: 'Pro Plan',
    renewalDate: '2026-03-11T00:00:00.000Z',
    amount: 49,
    currency: 'EUR',
  };

  const build = (placeCall = jest.fn().mockResolvedValue({ success: true, provider: 'stub', callId: 'CA1' })) => {
    const repository = new InMemoryCommunicationPreferenceRepository();
    const preferences = new CommunicationPreferenceService({
      repository,
      now: () => NOW,
    });
    const service = new VoiceReminderService({
      provider: { providerName: 'stub', placeCall: placeCall as never },
      preferences,
      now: () => NOW,
    });
    return { service, preferences, placeCall };
  };

  it('skips when the voice channel is not enabled', async () => {
    const { service, placeCall } = build();
    const result = await service.remind(RENEWAL, { userId: 'user-1', phoneNumber: '+15550001111' });

    expect(result.decision).toEqual({ shouldCall: false, reason: 'not_opted_in' });
    expect(result.record.status).toBe('skipped');
    expect(placeCall).not.toHaveBeenCalled();
  });

  it('places the call once voice is enabled for billing', async () => {
    const { service, preferences, placeCall } = build();
    await preferences.setChannelEnabled('user-1', 'billing', 'voice', true);

    const result = await service.remind(RENEWAL, { userId: 'user-1', phoneNumber: '+15550001111' });

    expect(result.decision.shouldCall).toBe(true);
    expect(result.record.status).toBe('placed');
    expect(result.record.callId).toBe('CA1');
    expect(placeCall).toHaveBeenCalledTimes(1);
    expect(placeCall.mock.calls[0][0].twiml).toContain('Pro Plan');
  });

  it('skips when the customer is on a do-not-call list', async () => {
    const { service, preferences } = build();
    await preferences.setChannelEnabled('user-1', 'billing', 'voice', true);
    await preferences.optOutChannel('user-1', 'voice', 'do not call');

    const result = await service.remind(RENEWAL, { userId: 'user-1', phoneNumber: '+15550001111' });
    expect(result.decision).toEqual({ shouldCall: false, reason: 'opted_out' });
  });

  it('skips when there is no phone number', async () => {
    const { service, preferences } = build();
    await preferences.setChannelEnabled('user-1', 'billing', 'voice', true);

    const result = await service.remind(RENEWAL, { userId: 'user-1', phoneNumber: '' });
    expect(result.decision).toEqual({ shouldCall: false, reason: 'missing_phone' });
  });

  it('defers outside calling hours with a callAt time', async () => {
    const evening = new Date('2026-03-10T21:00:00.000Z');
    const repository = new InMemoryCommunicationPreferenceRepository();
    const preferences = new CommunicationPreferenceService({
      repository,
      now: () => evening,
    });
    await preferences.setChannelEnabled('user-1', 'billing', 'voice', true);

    const service = new VoiceReminderService({
      provider: { providerName: 'stub', placeCall: jest.fn() as never },
      preferences,
      now: () => evening,
    });

    const result = await service.remind(RENEWAL, { userId: 'user-1', phoneNumber: '+15550001111' });
    expect(result.decision.reason).toBe('outside_calling_hours');
    expect(result.decision.callAt).toBe('2026-03-11T09:00:00.000Z');
  });

  it('skips a subscription that was already called', async () => {
    const { service, preferences } = build();
    await preferences.setChannelEnabled('user-1', 'billing', 'voice', true);

    const result = await service.remind(RENEWAL, {
      userId: 'user-1',
      phoneNumber: '+15550001111',
      alreadyCalled: ['sub-1'],
    });
    expect(result.decision).toEqual({ shouldCall: false, reason: 'already_called' });
  });

  it('skips when the renewal is not due yet', async () => {
    const { service, preferences } = build();
    await preferences.setChannelEnabled('user-1', 'billing', 'voice', true);

    const result = await service.remind(
      { ...RENEWAL, renewalDate: '2027-01-01T00:00:00.000Z' },
      { userId: 'user-1', phoneNumber: '+15550001111' }
    );
    expect(result.decision).toEqual({ shouldCall: false, reason: 'no_renewal_due' });
  });

  it('records a failed call without throwing', async () => {
    const placeCall = jest
      .fn()
      .mockResolvedValue({ success: false, provider: 'twilio', error: 'busy', errorCode: 486 });
    const { service, preferences } = build(placeCall);
    await preferences.setChannelEnabled('user-1', 'billing', 'voice', true);

    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await service.remind(RENEWAL, { userId: 'user-1', phoneNumber: '+15550001111' });
    errorLog.mockRestore();

    expect(result.record.status).toBe('failed');
    expect(result.record.reason).toBe('busy');
  });

  it('exposes an audit trail newest first', async () => {
    const { service, preferences } = build();
    await preferences.setChannelEnabled('user-1', 'billing', 'voice', true);

    await service.remind(RENEWAL, { userId: 'user-1', phoneNumber: '' });
    await service.remind(RENEWAL, { userId: 'user-1', phoneNumber: '+15550001111' });

    const records = service.listRecords('sub-1');
    expect(records).toHaveLength(2);
    expect(records[0].status).toBe('placed');
  });
});
