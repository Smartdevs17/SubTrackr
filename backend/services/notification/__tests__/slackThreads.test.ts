/**
 * Unit tests for slackThreads.ts
 *
 * Covers:
 *  - thread key derivation for each strategy
 *  - a first message creating a thread, later messages replying under it
 *  - a subscription's four lifecycle events landing in one thread, not four
 *  - update mode editing the parent, with and without replacement
 *  - unkeyed events posting standalone rather than being dropped
 *  - the in-memory thread store, including summary stats
 *  - transport failure being reported rather than thrown
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  SlackThreadStore,
  SlackThreadedNotifier,
  threadKeyFor,
  updateKeyFor,
  renderThreadSummary,
  summarizeThreadByEvent,
  type ThreadEntry,
  type ThreadTransport,
} from '../slackThreads';
import type { SlackMessage } from '../slack';

const SUB = 'sub_123';
const USER = 'user_1';

const message = (text: string): SlackMessage => ({ text });

let clock: Date;
let sent: Array<{ message: SlackMessage; threadTs?: string; broadcast?: boolean }>;
let updates: Array<{ ts: string; message: SlackMessage }>;
let sendResult: { success: boolean; ts?: string; error?: string };

beforeEach(() => {
  clock = new Date('2026-03-15T12:00:00.000Z');
  sent = [];
  updates = [];
  sendResult = { success: true };
});

/** A transport that records everything and hands back sequential timestamps. */
const recordingTransport = (): ThreadTransport => ({
  send: async (msg, options) => {
    sent.push({ message: msg, threadTs: options?.threadTs, broadcast: options?.broadcast });
    return { ...sendResult, ts: `ts_${sent.length}` };
  },
  update: async (ts, msg) => {
    updates.push({ ts, message: msg });
    return { success: sendResult.success, error: sendResult.error };
  },
});

const notifier = (overrides: Partial<{ transport: ThreadTransport; store: SlackThreadStore }> = {}) =>
  new SlackThreadedNotifier({
    transport: overrides.transport ?? recordingTransport(),
    store: overrides.store ?? new SlackThreadStore(() => clock),
    defaultChannel: '#alerts',
  });

describe('threadKeyFor', () => {
  it('keys on the subscription by default', () => {
    expect(threadKeyFor({ subscriptionId: SUB })).toBe(`sub:${SUB}`);
  });

  it('keys on the user under the user strategy', () => {
    expect(threadKeyFor({ userId: USER }, 'user')).toBe(`user:${USER}`);
  });

  it('keys on subscription and event under the combined strategy', () => {
    expect(threadKeyFor({ subscriptionId: SUB, eventType: 'charge_failed' }, 'subscription_event')).toBe(
      `sub:${SUB}:charge_failed`
    );
  });

  it('collapses to the subscription when the combined strategy has no event', () => {
    expect(threadKeyFor({ subscriptionId: SUB }, 'subscription_event')).toBe(`sub:${SUB}`);
  });

  it('returns null when there is no subscription under the default strategy', () => {
    expect(threadKeyFor({ userId: USER })).toBeNull();
  });

  it('returns null under the combined strategy without a subscription', () => {
    expect(threadKeyFor({ userId: USER, eventType: 'x' }, 'subscription_event')).toBeNull();
  });
});

describe('updateKeyFor', () => {
  it('keys on the subscription', () => {
    expect(updateKeyFor({ subscriptionId: SUB })).toBe(`state:${SUB}`);
  });

  it('falls back to the user', () => {
    expect(updateKeyFor({ userId: USER })).toBe(`state:${USER}`);
  });

  it('returns null with neither', () => {
    expect(updateKeyFor({})).toBeNull();
  });
});

describe('threading', () => {
  it('posts the first event to the channel, creating the thread', async () => {
    const result = await notifier().send(message('created'), { subscriptionId: SUB, eventType: 'subscription.created' });
    expect(result.createdThread).toBe(true);
    expect(result.threadKey).toBe(`sub:${SUB}`);
    expect(sent[0].threadTs).toBeUndefined();
  });

  it('replies under the existing thread for a follow-up event', async () => {
    const service = notifier();
    await service.send(message('created'), { subscriptionId: SUB, eventType: 'subscription.created' });
    const reply = await service.send(message('renewed'), { subscriptionId: SUB, eventType: 'subscription.renewed' });

    expect(reply.createdThread).toBe(false);
    expect(reply.parentTs).toBe('ts_1');
    expect(sent[1].threadTs).toBe('ts_1');
  });

  it("collects a subscription's whole lifecycle into one thread", async () => {
    const service = notifier();
    const events = ['subscription.created', 'payment.failed', 'dunning.retry', 'payment.succeeded'];
    for (const eventType of events) {
      await service.send(message(eventType), { subscriptionId: SUB, eventType });
    }
    const threads = service.getThreads().list();
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toHaveLength(4);
  });

  it('keeps different subscriptions in different threads', async () => {
    const service = notifier();
    await service.send(message('a'), { subscriptionId: 'sub_a' });
    await service.send(message('b'), { subscriptionId: 'sub_b' });
    expect(service.getThreads().getStats().threads).toBe(2);
  });

  it('honours an explicit thread key', async () => {
    const service = notifier();
    await service.send(message('a'), { subscriptionId: SUB }, { threadKey: 'custom' });
    expect(service.getThreads().has('custom')).toBe(true);
  });

  it('fans a new parent out to the channel when broadcast is set', async () => {
    await notifier().send(message('a'), { subscriptionId: SUB }, { broadcast: true });
    expect(sent[0].broadcast).toBe(true);
  });

  it('posts standalone when the event cannot be keyed', async () => {
    const result = await notifier().send(message('orphan'), { eventType: 'promotion' });
    expect(result.threadKey).toBe('');
    expect(result.createdThread).toBe(false);
    expect(sent[0].threadTs).toBeUndefined();
  });

  it('uses the user strategy when configured', async () => {
    const service = new SlackThreadedNotifier({
      transport: recordingTransport(),
      store: new SlackThreadStore(() => clock),
      strategy: 'user',
    });
    await service.send(message('a'), { userId: USER, subscriptionId: SUB });
    await service.send(message('b'), { userId: USER, subscriptionId: 'other' });
    expect(service.getThreads().getStats().threads).toBe(1);
  });
});

describe('update mode', () => {
  it('creates the thread when there is nothing to update yet', async () => {
    const result = await notifier().send(message('state: processing'), { subscriptionId: SUB }, { mode: 'update' });
    expect(result.createdThread).toBe(true);
    expect(result.updated).toBe(false);
  });

  it('edits the parent rather than adding a message', async () => {
    const service = notifier();
    await service.send(message('processing'), { subscriptionId: SUB }, { mode: 'update' });
    const result = await service.send(message('succeeded'), { subscriptionId: SUB }, { mode: 'update' });

    expect(result.updated).toBe(true);
    expect(result.parentTs).toBe('ts_1');
    expect(updates[0].ts).toBe('ts_1');
    expect(updates[0].message.text).toBe('succeeded');
    expect(sent).toHaveLength(1);
  });

  it('replaces the parent text by default, so a status supersedes', async () => {
    const service = notifier();
    await service.send(message('processing'), { subscriptionId: SUB }, { mode: 'update' });
    await service.send(message('succeeded'), { subscriptionId: SUB }, { mode: 'update' });
    expect(service.getThreads().get(`state:${SUB}`)?.messages[0].text).toBe('succeeded');
  });

  it('appends instead of replacing when asked', async () => {
    const service = notifier();
    await service.send(message('processing'), { subscriptionId: SUB }, { mode: 'update' });
    await service.send(message('succeeded'), { subscriptionId: SUB }, { mode: 'update', replace: false });
    expect(service.getThreads().get(`state:${SUB}`)?.messages[0].text).toBe('processing\nsucceeded');
  });

  it('keeps update threads separate from reply threads', async () => {
    const service = notifier();
    await service.send(message('event'), { subscriptionId: SUB });
    await service.send(message('state'), { subscriptionId: SUB }, { mode: 'update' });
    expect(service.getThreads().getStats().threads).toBe(2);
  });
});

describe('transport failure', () => {
  it('reports a rejected first send without throwing', async () => {
    sendResult = { success: false, error: 'channel_not_found' };
    const result = await notifier().send(message('a'), { subscriptionId: SUB });
    expect(result.success).toBe(false);
    expect(result.error).toBe('channel_not_found');
  });

  it('does not file a reply that the transport refused', async () => {
    const service = notifier();
    await service.send(message('a'), { subscriptionId: SUB });
    sendResult = { success: false, error: 'rate limited' };
    await service.send(message('b'), { subscriptionId: SUB, eventType: 'x' });
    expect(service.getThreads().get(`sub:${SUB}`)?.messages).toHaveLength(1);
  });

  it('does not apply a failed edit to the stored parent', async () => {
    const service = notifier();
    await service.send(message('processing'), { subscriptionId: SUB }, { mode: 'update' });
    sendResult = { success: false, error: 'not_authed' };
    const result = await service.send(message('succeeded'), { subscriptionId: SUB }, { mode: 'update' });
    expect(result.updated).toBe(true);
    expect(service.getThreads().get(`state:${SUB}`)?.messages[0].text).toBe('processing');
  });

  it('synthesises a parent timestamp when the transport returns none', async () => {
    const transport: ThreadTransport = {
      send: async () => ({ success: true }),
      update: async () => ({ success: true }),
    };
    const service = new SlackThreadedNotifier({ transport, store: new SlackThreadStore(() => clock) });
    const first = await service.send(message('a'), { subscriptionId: SUB });
    const second = await service.send(message('b'), { subscriptionId: SUB });
    expect(first.parentTs).toBeTruthy();
    expect(second.parentTs).toBe(first.parentTs);
  });
});

describe('SlackThreadStore', () => {
  it('starts a thread with the creating message as the parent', () => {
    const entry = store().create({ key: 'k', parentTs: 'ts_1', channel: '#a', text: 'hi' });
    expect(entry.messages).toHaveLength(1);
    expect(entry.messages[0].isParent).toBe(true);
    expect(entry.revision).toBe(0);
  });

  it('appends a reply', () => {
    const s = store();
    s.create({ key: 'k', parentTs: 'ts_1', channel: '#a', text: 'hi' });
    s.reply('k', { ts: 'ts_2', text: 'again' });
    expect(s.get('k')?.messages).toHaveLength(2);
  });

  it('ignores a reply to a thread it does not know', () => {
    expect(store().reply('missing', { ts: 'ts_2', text: 'x' })).toBeUndefined();
  });

  it('appends to the parent on an update by default', () => {
    const s = store();
    s.create({ key: 'k', parentTs: 'ts_1', channel: '#a', text: 'processing' });
    s.update('k', { text: 'done' });
    expect(s.get('k')?.messages[0].text).toBe('processing\ndone');
    expect(s.get('k')?.revision).toBe(1);
  });

  it('replaces the parent when asked', () => {
    const s = store();
    s.create({ key: 'k', parentTs: 'ts_1', channel: '#a', text: 'processing' });
    s.update('k', { text: 'done', replace: true });
    expect(s.get('k')?.messages[0].text).toBe('done');
  });

  it('ignores an update to a thread it does not know', () => {
    expect(store().update('missing', { text: 'x' })).toBeUndefined();
  });

  it('counts threads, messages and active threads', () => {
    const s = store();
    s.create({ key: 'a', parentTs: '1', channel: '#a', text: 'x' });
    s.reply('a', { ts: '2', text: 'y' });
    s.create({ key: 'b', parentTs: '3', channel: '#a', text: 'x' });
    const stats = s.getStats();
    expect(stats).toEqual({ threads: 2, messages: 3, activeThreads: 1, updatedThreads: 0 });
  });

  it('counts threads that have been edited', () => {
    const s = store();
    s.create({ key: 'a', parentTs: '1', channel: '#a', text: 'x' });
    s.update('a', { text: 'y' });
    expect(s.getStats().updatedThreads).toBe(1);
  });

  it('lists the most recently active thread first', async () => {
    const s = store();
    s.create({ key: 'old', parentTs: '1', channel: '#a', text: 'x' });
    clock = new Date('2026-03-15T13:00:00.000Z');
    s.create({ key: 'new', parentTs: '2', channel: '#a', text: 'x' });
    expect(s.list().map((e) => e.key)).toEqual(['new', 'old']);
  });

  it('empties on clear', () => {
    const s = store();
    s.create({ key: 'a', parentTs: '1', channel: '#a', text: 'x' });
    s.clear();
    expect(s.getStats().threads).toBe(0);
  });
});

describe('thread rendering', () => {
  it('marks replies distinctly from the parent', () => {
    const entry = entry();
    const summary = renderThreadSummary(entry);
    expect(summary).toContain('• opened');
    expect(summary).toContain('↳ renewed');
  });

  it('flattens a multi-line message onto one line', () => {
    const withNewline: ThreadEntry = {
      ...entry(),
      messages: [
        {
          ts: '1',
          text: 'line one\nline two',
          createdAt: clock.toISOString(),
          isParent: true,
        },
      ],
    };
    expect(renderThreadSummary(withNewline)).toContain('line one line two');
  });

  it('counts each event type in first-seen order', () => {
    const summary = summarizeThreadByEvent(entry());
    expect(summary.map((s) => s.eventType)).toEqual([
      'subscription.created',
      'subscription.renewed',
    ]);
    expect(summary[0].count).toBe(1);
  });

  it('groups a repeated event type', () => {
    const repeated: ThreadEntry = {
      ...entry(),
      messages: [
        { ts: '1', text: 'a', createdAt: '2026-03-15T10:00:00.000Z', isParent: true, eventType: 'dunning.retry' },
        { ts: '2', text: 'b', createdAt: '2026-03-15T11:00:00.000Z', isParent: false, eventType: 'dunning.retry' },
      ],
    };
    const summary = summarizeThreadByEvent(repeated);
    expect(summary).toHaveLength(1);
    expect(summary[0].count).toBe(2);
  });

  it('buckets a message with no event under unknown', () => {
    const anonymous: ThreadEntry = {
      ...entry(),
      messages: [{ ts: '1', text: 'a', createdAt: '2026-03-15T10:00:00.000Z', isParent: true }],
    };
    expect(summarizeThreadByEvent(anonymous)[0].eventType).toBe('unknown');
  });
});

function store(): SlackThreadStore {
  return new SlackThreadStore(() => clock);
}

function entry(): ThreadEntry {
  return {
    key: `sub:${SUB}`,
    parentTs: '1',
    channel: '#alerts',
    createdAt: '2026-03-15T10:00:00.000Z',
    updatedAt: '2026-03-15T11:00:00.000Z',
    messages: [
      {
        ts: '1',
        text: 'opened',
        createdAt: '2026-03-15T10:00:00.000Z',
        isParent: true,
        eventType: 'subscription.created',
      },
      {
        ts: '2',
        text: 'renewed',
        createdAt: '2026-03-15T11:00:00.000Z',
        isParent: false,
        eventType: 'subscription.renewed',
      },
    ],
    revision: 0,
  };
}
