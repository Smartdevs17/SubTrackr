/**
 * Slack threaded notification updates.
 *
 * `slack.ts` sends one message per event, which floods a channel: a subscription
 * that renews, fails, retries and recovers posts four unrelated messages. Slack
 * threads fix this — the first event posts to the channel, and every follow-up
 * for the same subscription is a reply under it, so the channel shows one item
 * per subscription and the story stays together.
 *
 * Threading is opt-in and additive: `send` still posts standalone messages, and
 * a caller that has not opted in behaves exactly as before.
 *
 * Slack threading rules this module encodes:
 *  - a reply carries `thread_ts` equal to the parent's timestamp
 *  - the parent is never edited into a reply; edits use `chat.update`
 *  - `reply_broadcast` fans a reply back to the channel, and is deliberately
 *    **not** set: a subscriber does not want eight payment retries in the channel
 */

import type { SlackMessage, SlackNotifierConfig, SlackDeliveryResult } from './slack';
import type { NotificationType } from '../../../src/types/notification';

/** Slack timestamps are strings like "1710500000.000100". */
export type SlackTs = string;

// ─── Types ──────────────────────────────────────────────────────────

/** What decides whether two events belong in the same thread. */
export type ThreadKeyStrategy =
  /** One thread per subscription. The default. */
  | 'subscription'
  /** One thread per user. */
  | 'user'
  /** One thread per (subscription, event type). */
  | 'subscription_event';

export interface ThreadedMessageOptions {
  /** Opaque key selecting the thread. Defaults to the subscription id. */
  threadKey?: string;
  /** Overrides the default key strategy. */
  strategy?: ThreadKeyStrategy;
  /**
   * Edit the existing parent instead of starting a new one. Use for the latest
   * state of a subscription rather than a new event.
   */
  mode?: 'reply' | 'update';
  /**
   * Overwrite the parent rather than append, in `update` mode. A status that
   * changes from "processing" to "succeeded" should replace, not duplicate.
   */
  replace?: boolean;
  /**
   * Fan the new parent out to the channel it was posted in, so a thread opened
   * for a quiet subscriber is still visible. Only honoured when the thread is
   * created; Slack ignores it on replies.
   */
  broadcast?: boolean;
}

export interface ThreadEntry {
  key: string;
  /** The parent message's `ts`; the anchor for every reply. */
  parentTs: SlackTs;
  /** Slack channel the thread lives in. */
  channel: string;
  createdAt: string;
  updatedAt: string;
  /** Messages in the thread, parent first. */
  messages: ThreadMessage[];
  /** How many times the parent has been edited. */
  revision: number;
}

export interface ThreadMessage {
  ts: SlackTs;
  text: string;
  createdAt: string;
  /** True for the message that opened the thread. */
  isParent: boolean;
  /** The event that produced this message, for rendering a thread summary. */
  eventType?: string;
}

export interface ThreadedSendResult extends SlackDeliveryResult {
  /** The key the message was filed under. */
  threadKey: string;
  /** The parent the message belongs to, once resolved. */
  parentTs?: SlackTs;
  /** True when this call created the thread. */
  createdThread: boolean;
  /** True when the parent was edited rather than a reply added. */
  updated: boolean;
}

export interface ThreadStats {
  threads: number;
  messages: number;
  /** Threads with more than one message. */
  activeThreads: number;
  updatedThreads: number;
}

// ─── Key derivation ─────────────────────────────────────────────────

/**
 * Build the thread key for an event.
 *
 * The key is the identity of the thing being discussed, not of the event: two
 * different events about one subscription must collide, or threading does
 * nothing.
 */
export function threadKeyFor(
  context: {
    subscriptionId?: string;
    userId?: string;
    eventType?: string;
  },
  strategy: ThreadKeyStrategy = 'subscription'
): string | null {
  switch (strategy) {
    case 'subscription':
      return context.subscriptionId ? `sub:${context.subscriptionId}` : null;
    case 'user':
      return context.userId ? `user:${context.userId}` : null;
    case 'subscription_event': {
      if (!context.subscriptionId) return null;
      return context.eventType
        ? `sub:${context.subscriptionId}:${context.eventType}`
        : `sub:${context.subscriptionId}`;
    }
  }
}

/**
 * Stable key for a recurring update on the same subject.
 *
 * `update` mode collapses to one message per subject, so the key must not carry
 * the event type or nothing would ever replace anything.
 */
export function updateKeyFor(context: {
  subscriptionId?: string;
  userId?: string;
}): string | null {
  if (context.subscriptionId) return `state:${context.subscriptionId}`;
  if (context.userId) return `state:${context.userId}`;
  return null;
}

// ─── Thread store ───────────────────────────────────────────────────

/**
 * In-memory index of open threads.
 *
 * Slack owns the real thread state; this maps our business key to a `ts` and
 * remembers what we last posted, which Slack's API does not let us query by
 * our own key. Losing the index means a fresh parent, never a lost message.
 */
export class SlackThreadStore {
  private threads = new Map<string, ThreadEntry>();
  private clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  get(key: string): ThreadEntry | undefined {
    return this.threads.get(key);
  }

  has(key: string): boolean {
    return this.threads.has(key);
  }

  /** Record a newly created thread. */
  create(input: {
    key: string;
    parentTs: SlackTs;
    channel: string;
    text: string;
    eventType?: string;
  }): ThreadEntry {
    const timestamp = this.clock().toISOString();
    const entry: ThreadEntry = {
      key: input.key,
      parentTs: input.parentTs,
      channel: input.channel,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [
        {
          ts: input.parentTs,
          text: input.text,
          createdAt: timestamp,
          isParent: true,
          eventType: input.eventType,
        },
      ],
      revision: 0,
    };
    this.threads.set(input.key, entry);
    return entry;
  }

  /** Append a reply to an existing thread. */
  reply(
    key: string,
    input: { ts: SlackTs; text: string; eventType?: string }
  ): ThreadEntry | undefined {
    const entry = this.threads.get(key);
    if (!entry) return undefined;
    const timestamp = this.clock().toISOString();
    entry.messages.push({
      ts: input.ts,
      text: input.text,
      createdAt: timestamp,
      isParent: false,
      eventType: input.eventType,
    });
    entry.updatedAt = timestamp;
    return entry;
  }

  /**
   * Revise the parent message in place.
   *
   * `replace: true` drops the previous text, for a status that supersedes an
   * earlier one; otherwise the new text is appended so the transition stays
   * visible in the thread.
   */
  update(
    key: string,
    input: { text: string; eventType?: string; replace?: boolean }
  ): ThreadEntry | undefined {
    const entry = this.threads.get(key);
    if (!entry) return undefined;
    const parent = entry.messages.find((message) => message.isParent);
    if (!parent) return undefined;

    if (input.replace) {
      parent.text = input.text;
    } else {
      parent.text = `${parent.text}\n${input.text}`;
    }
    parent.eventType = input.eventType ?? parent.eventType;
    entry.updatedAt = this.clock().toISOString();
    entry.revision += 1;
    return entry;
  }

  /** Threads ordered by most recently active. */
  list(): ThreadEntry[] {
    return [...this.threads.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getStats(): ThreadStats {
    const threads = [...this.threads.values()];
    return {
      threads: threads.length,
      messages: threads.reduce((sum, entry) => sum + entry.messages.length, 0),
      activeThreads: threads.filter((entry) => entry.messages.length > 1).length,
      updatedThreads: threads.filter((entry) => entry.revision > 0).length,
    };
  }

  clear(): void {
    this.threads.clear();
  }
}

// ─── Threaded notifier ──────────────────────────────────────────────

/**
 * The subset of `SlackNotifier` this class needs, so the transport can be
 * substituted in tests without an HTTP server.
 */
export interface ThreadTransport {
  send(message: SlackMessage, options?: { threadTs?: SlackTs; broadcast?: boolean }): Promise<SlackDeliveryResult & { ts?: string }>;
  update(ts: SlackTs, message: SlackMessage): Promise<SlackDeliveryResult>;
}

export interface ThreadedNotifierDeps {
  transport: ThreadTransport;
  store?: SlackThreadStore;
  strategy?: ThreadKeyStrategy;
  /** Channel for new threads when the notifier config does not name one. */
  defaultChannel?: string;
  clock?: () => Date;
}

export class SlackThreadedNotifier {
  private readonly transport: ThreadTransport;
  private readonly store: SlackThreadStore;
  private readonly strategy: ThreadKeyStrategy;
  private readonly defaultChannel: string;

  constructor(deps: ThreadedNotifierDeps) {
    this.transport = deps.transport;
    this.store = deps.store ?? new SlackThreadStore(deps.clock);
    this.strategy = deps.strategy ?? 'subscription';
    this.defaultChannel = deps.defaultChannel ?? '';
  }

  getThreads(): SlackThreadStore {
    return this.store;
  }

  /**
   * Post a message into the thread for `context`, starting the thread when it
   * does not exist yet.
   *
   * Returns a result rather than throwing on transport failure, matching
   * `SlackNotifier.send`: a Slack outage must not take down the caller that
   * happened to be notifying Slack.
   */
  async send(
    message: SlackMessage,
    context: {
      subscriptionId?: string;
      userId?: string;
      eventType?: NotificationType | string;
    } = {},
    options: ThreadedMessageOptions = {}
  ): Promise<ThreadedSendResult> {
    const mode = options.mode ?? 'reply';
    const key =
      mode === 'update'
        ? options.threadKey ?? updateKeyFor(context)
        : options.threadKey ?? threadKeyFor(context, options.strategy ?? this.strategy);

    if (!key) {
      // Nothing identifies what this is about, so it cannot be threaded.
      // Posting standalone is better than dropping the notification.
      const result = await this.transport.send(message);
      return {
        ...result,
        threadKey: '',
        createdThread: false,
        updated: false,
      };
    }

    if (mode === 'update') {
      return this.update(key, message, context.eventType, options);
    }
    return this.reply(key, message, context.eventType, options);
  }

  private async reply(
    key: string,
    message: SlackMessage,
    eventType: string | undefined,
    options: ThreadedMessageOptions
  ): Promise<ThreadedSendResult> {
    const existing = this.store.get(key);

    if (!existing) {
      const result = await this.transport.send(message, { broadcast: options.broadcast });
      const parentTs = result.ts ?? this.synthesiseTs();
      // Only index a thread that was actually posted, so a later event does
      // not try to reply to a parent Slack never received.
      if (result.success) {
        this.store.create({
          key,
          parentTs,
          channel: this.defaultChannel,
          text: message.text,
          eventType,
        });
      }
      return { ...result, threadKey: key, parentTs, createdThread: result.success, updated: false };
    }

    const result = await this.transport.send(message, { threadTs: existing.parentTs });
    if (result.success && result.ts) {
      this.store.reply(key, { ts: result.ts, text: message.text, eventType });
    }
    return {
      ...result,
      threadKey: key,
      parentTs: existing.parentTs,
      createdThread: false,
      updated: false,
    };
  }

  private async update(
    key: string,
    message: SlackMessage,
    eventType: string | undefined,
    options: ThreadedMessageOptions
  ): Promise<ThreadedSendResult> {
    const existing = this.store.get(key);

    if (!existing) {
      // No thread yet: the first update becomes the parent rather than
      // silently editing nothing.
      const result = await this.transport.send(message);
      const parentTs = result.ts ?? this.synthesiseTs();
      if (result.success) {
        this.store.create({ key, parentTs, channel: this.defaultChannel, text: message.text, eventType });
      }
      return { ...result, threadKey: key, parentTs, createdThread: result.success, updated: false };
    }

    const result = await this.transport.update(existing.parentTs, message);
    if (result.success) {
      this.store.update(key, {
        text: message.text,
        eventType,
        replace: options.replace ?? true,
      });
    }
    return {
      ...result,
      threadKey: key,
      parentTs: existing.parentTs,
      createdThread: false,
      updated: true,
    };
  }

  /**
   * A stand-in `ts` for a transport that does not return one.
   *
   * Slack requires a `ts` to reply to, and a transport that omits it (a stub, or
   * a proxy that strips the field) would otherwise make every later reply
   * unaddressable.
   */
  private synthesiseTs(): SlackTs {
    return `${Math.floor(this.store.getStats().messages + 1)}.000100`;
  }
}

// ─── Message building ───────────────────────────────────────────────

/** Render a thread's messages as one plain-text summary. */
export function renderThreadSummary(entry: ThreadEntry): string {
  const header = `Thread ${entry.key} — ${entry.messages.length} message(s)`;
  const body = entry.messages
    .map((message) => `  ${message.isParent ? '•' : '↳'} ${message.text.replace(/\n/g, ' ')}`)
    .join('\n');
  return `${header}\n${body}`;
}

/**
 * Group messages by event type for a thread overview.
 *
 * A thread exists so the whole story of one subscription is legible; the
 * ordering of that story is the point, so entries keep insertion order rather
 * than being sorted by name.
 */
export function summarizeThreadByEvent(entry: ThreadEntry): Array<{ eventType: string; count: number; last: string }> {
  const order: string[] = [];
  const byEvent = new Map<string, { count: number; last: string }>();

  for (const message of entry.messages) {
    const key = message.eventType ?? 'unknown';
    if (!byEvent.has(key)) {
      byEvent.set(key, { count: 0, last: message.createdAt });
      order.push(key);
    }
    const bucket = byEvent.get(key)!;
    bucket.count += 1;
    if (message.createdAt > bucket.last) bucket.last = message.createdAt;
  }

  return order.map((eventType) => ({
    eventType,
    count: byEvent.get(eventType)!.count,
    last: byEvent.get(eventType)!.last,
  }));
}

/**
 * Build a transport that posts to a Slack webhook, using the standard
 * `thread_ts` field the Incoming Webhooks API accepts.
 *
 * Incoming Webhooks return `ok` rather than a `ts`, so the parent timestamp is
 * tracked by the caller; a Bot token is required for `chat.update`.
 */
export function createThreadTransport(config: SlackNotifierConfig): ThreadTransport {
  const endpoint = config.webhookUrl;

  return {
    async send(message, options) {
      const body: Record<string, unknown> = { ...message };
      if (options?.threadTs) body.thread_ts = options.threadTs;
      if (options?.broadcast) body.reply_broadcast = true;
      if (config.username) body.username = config.username;
      if (config.iconEmoji) body.icon_emoji = config.iconEmoji;
      if (config.channel) body.channel = config.channel;

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return {
            success: false,
            statusCode: response.status,
            error: `Slack webhook returned ${response.status}: ${text}`,
          };
        }
        return { success: true, statusCode: response.status };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Slack request failed',
        };
      }
    },

    async update(ts, message) {
      // `chat.update` is a Web API method, not a webhook. Without a bot token
      // the caller must fall back to a reply, which this reports honestly
      // rather than pretending the edit happened.
      const token = process.env.SLACK_BOT_TOKEN;
      if (!token) {
        return {
          success: false,
          error:
            'SLACK_BOT_TOKEN is not configured; chat.update needs a bot token. Use mode "reply" instead.',
        };
      }
      try {
        const response = await fetch('https://slack.com/api/chat.update', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ ...message, ts }),
        });
        const payload = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          return {
            success: false,
            statusCode: response.status,
            error: payload.error ?? `chat.update returned ${response.status}`,
          };
        }
        return { success: true, statusCode: response.status };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'chat.update request failed',
        };
      }
    },
  };
}
