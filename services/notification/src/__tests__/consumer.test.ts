import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ChannelFactory } from '../channels/factory.js';
import {
  InvalidNotificationError,
  processNotification,
  setChannelFactory,
  setLogger,
  setRuleEngine,
} from '../consumer.js';
import { RuleEngine } from '../rules/engine.js';
import { loadRuleEngine } from '../rules/loader.js';

const message = { id: 'n-1', channel: 'email', template: 'receipt', recipient: 'a@b.c' };

describe('processNotification', () => {
  const sends = { email: vi.fn(), push: vi.fn(), sms: vi.fn() };
  const logger = { info: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    const factory = new ChannelFactory();
    for (const [channel, send] of Object.entries(sends)) {
      send.mockReset().mockResolvedValue({ success: true });
      factory.register(channel, { send });
    }
    logger.info.mockReset();
    logger.error.mockReset();
    setChannelFactory(factory);
    setLogger(logger);
    setRuleEngine(new RuleEngine());
  });

  it('delivers on the message channel by default and logs the decision', async () => {
    await processNotification(message);
    expect(sends.email).toHaveBeenCalledWith(expect.objectContaining({ id: 'n-1', priority: 'normal' }));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'notification.decision', channels: ['email'], matchedRules: [] })
    );
  });

  it('fans out to every routed channel', async () => {
    setRuleEngine(new RuleEngine([{ id: 'all', when: { field: 'template', eq: 'receipt' }, then: [{ type: 'route', channels: ['push', 'sms'] }] }]));
    await processNotification(message);
    expect(sends.email).not.toHaveBeenCalled();
    expect(sends.push).toHaveBeenCalledOnce();
    expect(sends.sms).toHaveBeenCalledOnce();
  });

  it('sends nothing when suppressed', async () => {
    setRuleEngine(new RuleEngine([{ id: 'mute', when: { field: 'channel', exists: true }, then: [{ type: 'suppress', reason: 'muted' }] }]));
    const decision = await processNotification(message);
    expect(decision.suppressedBy?.ruleId).toBe('mute');
    expect(Object.values(sends).every((s) => s.mock.calls.length === 0)).toBe(true);
  });

  it('rejects malformed messages with InvalidNotificationError', async () => {
    await expect(processNotification({ id: 'x', channel: 'fax' })).rejects.toBeInstanceOf(InvalidNotificationError);
  });

  it('logs and throws when a delivery fails', async () => {
    sends.email.mockResolvedValue({ success: false, error: 'bounced' });
    await expect(processNotification(message)).rejects.toThrow('bounced');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'notification.delivery_failed', channel: 'email', error: 'bounced' })
    );
  });
});

describe('loadRuleEngine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-'));

  it('returns an empty engine when no path is configured', async () => {
    expect((await loadRuleEngine({})).size).toBe(0);
  });

  it('loads a valid rules file', async () => {
    const path = join(dir, 'ok.json');
    writeFileSync(path, JSON.stringify([{ id: 'r', when: { field: 'channel', eq: 'sms' }, then: [{ type: 'suppress', reason: 'r' }] }]));
    expect((await loadRuleEngine({ NOTIFICATION_RULES_PATH: path })).size).toBe(1);
  });

  it('accepts the shipped rules.example.json', async () => {
    const path = resolve(__dirname, '../../rules.example.json');
    expect((await loadRuleEngine({ NOTIFICATION_RULES_PATH: path })).size).toBe(2);
  });

  it('fails on a missing, unparsable or invalid file', async () => {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    const invalid = join(dir, 'invalid.json');
    writeFileSync(invalid, JSON.stringify([{ id: 'r' }]));
    await expect(loadRuleEngine({ NOTIFICATION_RULES_PATH: join(dir, 'nope.json') })).rejects.toThrow(/Cannot read/);
    await expect(loadRuleEngine({ NOTIFICATION_RULES_PATH: bad })).rejects.toThrow(/Cannot read/);
    await expect(loadRuleEngine({ NOTIFICATION_RULES_PATH: invalid })).rejects.toThrow(/Invalid notification rules/);
  });
});
