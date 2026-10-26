/**
 * Two-way SMS responses (#1256)
 *
 * Covers: webhook payload parsing (success + malformed), keyword matching,
 * STOP/START consent handling, renew/snooze/status intents, unknown-message
 * help fallback, MessageSid idempotency, reply-delivery failure, and the
 * Twilio Basic-auth guard on the inbound route.
 */

import { describe, expect, it, beforeEach } from '@jest/globals';
import {
  SmsInboundHandler,
  parseInboundSms,
  matchCommand,
  DEFAULT_KEYWORD_MAP,
  HELP_MESSAGE,
  SNOOZE_DEFAULT_DAYS,
} from '../smsInboundHandler';
import { optOutStore } from '../smsProvider';
import type { SmsProvider, SmsResult } from '../smsProvider';
import {
  CommunicationPreferenceService,
  InMemoryCommunicationPreferenceRepository,
} from '../communicationPreferencesService';
import { isAuthorisedTwilioRequest } from '../../../notification/controller/communicationPreferencesController';

const PAYLOAD = {
  MessageSid: 'SM123',
  From: '+15550001111',
  To: '+15017122661',
  Body: 'STOP',
};

const makeHandler = (
  options: {
    send?: jest.Mock<SmsResult>;
    userId?: string | null;
    actions?: Record<string, unknown>;
  } = {}
) => {
  const send = options.send ?? jest.fn<SmsResult>().mockResolvedValue({
    success: true,
    provider: 'stub',
    messageId: 'SM-out',
  });
  const provider: SmsProvider = { providerName: 'stub', send: send as never };

  const preferences = new CommunicationPreferenceService({
    repository: new InMemoryCommunicationPreferenceRepository(),
  });

  const handler = new SmsInboundHandler({
    provider,
    preferences,
    lookupUserByPhone: () => options.userId ?? 'user-1',
    actions: options.actions as never,
  });

  return { handler, send, preferences };
};

describe('parseInboundSms', () => {
  it('normalises a Twilio payload', () => {
    expect(parseInboundSms(PAYLOAD)).toEqual({
      messageSid: 'SM123',
      from: '+15550001111',
      to: '+15017122661',
      body: 'STOP',
      numMedia: undefined,
    });
  });

  it('reads NumMedia when present', () => {
    expect(parseInboundSms({ ...PAYLOAD, NumMedia: '2' }).numMedia).toBe(2);
  });

  it('throws when required fields are missing', () => {
    expect(() => parseInboundSms({ From: '+15550001111' })).toThrow(/MessageSid/);
    expect(() => parseInboundSms({ MessageSid: 'SM1' })).toThrow(/From, To/);
  });

  it('throws on a malformed sender address', () => {
    expect(() => parseInboundSms({ ...PAYLOAD, From: 'spam' })).toThrow(/invalid "From"/);
  });
});

describe('matchCommand', () => {
  it('matches exact keywords case-insensitively', () => {
    expect(matchCommand('stop').intent).toBe('opt_out');
    expect(matchCommand('  START ').intent).toBe('opt_in');
    expect(matchCommand('help').intent).toBe('help');
  });

  it('matches the first word of a longer message', () => {
    expect(matchCommand('STOP please').keyword).toBe('STOP');
    expect(matchCommand('help 12345').intent).toBe('help');
  });

  it('falls back to unknown for free text and empty bodies', () => {
    expect(matchCommand('what is my bill?').intent).toBe('unknown');
    expect(matchCommand('').intent).toBe('unknown');
  });

  it('maps YES to renew and NO to a 7-day snooze', () => {
    expect(matchCommand('YES').intent).toBe('renew');
    expect(matchCommand('NO')).toEqual({
      intent: 'snooze',
      keyword: 'NO',
      snoozeDays: SNOOZE_DEFAULT_DAYS,
    });
  });

  it('accepts a custom keyword map', () => {
    const custom = { PING: { intent: 'status' as const, keyword: 'PING' } };
    expect(matchCommand('ping', custom).intent).toBe('status');
    expect(matchCommand('STOP', custom).intent).toBe('unknown');
  });
});

describe('SmsInboundHandler.handle', () => {
  beforeEach(() => {
    optOutStore.optIn('+15550001111');
  });

  it('applies a STOP opt-out and does not text the number back', async () => {
    const { handler, send, preferences } = makeHandler();

    const result = await handler.handle(PAYLOAD);

    expect(result.intent).toBe('opt_out');
    expect(result.handled).toBe(true);
    expect(optOutStore.isOptedOut('+15550001111')).toBe(true);
    expect(send).not.toHaveBeenCalled();

    const stored = await preferences.getPreferences('user-1');
    expect(stored.globalOptOuts.sms).toBe(true);
  });

  it('re-subscribes on START and replies', async () => {
    const { handler, send, preferences } = makeHandler();
    optOutStore.optOut('+15550001111');

    const result = await handler.handle({ ...PAYLOAD, Body: 'START' });

    expect(result.intent).toBe('opt_in');
    expect(optOutStore.isOptedOut('+15550001111')).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);

    const stored = await preferences.getPreferences('user-1');
    expect(stored.globalOptOuts.sms).toBe(false);
  });

  it('replies with the help text for HELP', async () => {
    const { handler, send } = makeHandler();
    const result = await handler.handle({ ...PAYLOAD, Body: 'HELP' });

    expect(result.intent).toBe('help');
    expect(send.mock.calls[0][0].body).toBe(HELP_MESSAGE);
  });

  it('runs the renew action and confirms', async () => {
    const renew = jest.fn();
    const { handler, send } = makeHandler({ actions: { renew } });

    const result = await handler.handle({ ...PAYLOAD, Body: 'YES' });

    expect(renew).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].body).toContain('renewal is confirmed');
    expect(result.record.replyMessageId).toBe('SM-out');
  });

  it('runs the snooze action with the default day count', async () => {
    const snooze = jest.fn();
    const { handler, send } = makeHandler({ actions: { snooze } });

    const result = await handler.handle({ ...PAYLOAD, Body: 'PAUSE' });

    expect(snooze).toHaveBeenCalledWith('user-1', SNOOZE_DEFAULT_DAYS, expect.any(Object));
    expect(send.mock.calls[0][0].body).toContain('7 days');
    expect(result.intent).toBe('snooze');
  });

  it('returns the next-renewal summary for STATUS', async () => {
    const status = jest.fn().mockReturnValue('Next: Pro Plan on 2026-04-01');
    const { handler, send } = makeHandler({ actions: { status } });

    await handler.handle({ ...PAYLOAD, Body: 'STATUS' });
    expect(send.mock.calls[0][0].body).toBe('Next: Pro Plan on 2026-04-01');
  });

  it('falls back to help when the sender is unknown', async () => {
    const { handler, send } = makeHandler({ userId: null });
    const result = await handler.handle({ ...PAYLOAD, Body: 'STATUS' });

    expect(send.mock.calls[0][0].body).toBe(HELP_MESSAGE);
    expect(result.record.userId).toBeNull();
  });

  it('replies with help for an unrecognised message', async () => {
    const { handler, send } = makeHandler();
    const result = await handler.handle({ ...PAYLOAD, Body: 'do you sell cats?' });

    expect(result.intent).toBe('unknown');
    expect(send.mock.calls[0][0].body).toBe(HELP_MESSAGE);
  });

  it('ignores a replayed MessageSid', async () => {
    const { handler, send } = makeHandler();

    await handler.handle({ ...PAYLOAD, Body: 'HELP' });
    const replay = await handler.handle({ ...PAYLOAD, Body: 'HELP' });

    expect(send).toHaveBeenCalledTimes(1);
    expect(replay.duplicate).toBe(true);
    expect(replay.handled).toBe(true);
  });

  it('reports a malformed payload without throwing', async () => {
    const { handler } = makeHandler();
    const result = await handler.handle({ MessageSid: 'SM9' });

    expect(result.handled).toBe(false);
    expect(result.error).toMatch(/required field/);
  });

  it('reports a failed reply without failing the webhook', async () => {
    const send = jest.fn<SmsResult>().mockResolvedValue({
      success: false,
      provider: 'twilio',
      error: 'unreachable',
    });
    const { handler } = makeHandler({ send });

    const result = await handler.handle({ ...PAYLOAD, Body: 'HELP' });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('unreachable');
    expect(result.reply).toBeUndefined();
  });

  it('reports an action failure and still replies with help', async () => {
    const send = jest.fn<SmsResult>().mockResolvedValue({ success: true, provider: 'stub' });
    const renew = jest.fn().mockRejectedValue(new Error('billing unavailable'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = makeHandler({ send, actions: { renew } });

    const result = await handler.handle({ ...PAYLOAD, Body: 'YES' });
    errorLog.mockRestore();

    expect(result.error).toBe('billing unavailable');
    expect(send.mock.calls[0][0].body).toBe(HELP_MESSAGE);
  });

  it('writes an audit row for every message', async () => {
    const { handler } = makeHandler();
    await handler.handle({ ...PAYLOAD, MessageSid: 'SM-a', Body: 'HELP' });
    await handler.handle({ ...PAYLOAD, MessageSid: 'SM-b', Body: 'STOP' });

    const audit = handler.listAudit();
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ messageSid: 'SM-b', intent: 'opt_out' });
  });
});

describe('isAuthorisedTwilioRequest', () => {
  const header = (sid: string) => `Basic ${Buffer.from(`${sid}:`).toString('base64')}`;

  it('accepts a matching account SID', () => {
    expect(isAuthorisedTwilioRequest(header('ACreal'), 'ACreal')).toBe(true);
  });

  it('rejects a wrong SID, a missing header and a non-Basic scheme', () => {
    expect(isAuthorisedTwilioRequest(header('ACother'), 'ACreal')).toBe(false);
    expect(isAuthorisedTwilioRequest(undefined, 'ACreal')).toBe(false);
    expect(isAuthorisedTwilioRequest('Bearer token', 'ACreal')).toBe(false);
    expect(isAuthorisedTwilioRequest('Basic', 'ACreal')).toBe(false);
  });
});

describe('DEFAULT_KEYWORD_MAP', () => {
  it('covers every opt-out and opt-in synonym', () => {
    for (const keyword of ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']) {
      expect(DEFAULT_KEYWORD_MAP[keyword].intent).toBe('opt_out');
    }
    for (const keyword of ['START', 'SUBSCRIBE', 'RESUBSCRIBE']) {
      expect(DEFAULT_KEYWORD_MAP[keyword].intent).toBe('opt_in');
    }
  });
});
