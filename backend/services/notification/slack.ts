/**
 * Slack notification integration for SubTrackr subscription alerts.
 *
 * Supports two entry points:
 *  1. `SlackNotifier` — sends rich Block Kit messages to a Slack webhook URL.
 *     Use this anywhere in the backend that needs to push a message directly.
 *  2. `SlackAlertDispatcher` — implements the existing `AlertDispatcher`
 *     interface so the `AlertingService` can route system alerts to Slack
 *     alongside PagerDuty / console without any callers needing to change.
 *
 * Block Kit references: https://api.slack.com/block-kit
 */

import type { AlertDispatcher } from './alerting';
import type { Alert } from '../shared/types';
import type { WebhookEventType } from '../../../src/types/webhook';
import type { NotificationType } from '../../../src/types/notification';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Any plain JSON value safe to put inside a Slack block. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any;

/** Minimal subset of the Slack Block Kit JSON surface. */
interface SlackBlock {
  type: string;
  [key: string]: JsonValue;
}

export interface SlackMessage {
  text: string; // Fallback for Slack clients that don't render blocks
  blocks?: SlackBlock[];
  attachments?: Array<{ color: string; blocks: SlackBlock[] }>;
}

/** Details about a subscription lifecycle event forwarded to Slack. */
export interface SubscriptionAlertContext {
  eventType: WebhookEventType | NotificationType;
  subscriptionId?: string;
  subscriptionName?: string;
  userId?: string;
  merchantId?: string;
  amount?: number;
  currency?: string;
  /** Extra key/value pairs appended as fields in the message. */
  extra?: Record<string, string>;
}

export interface SlackNotifierConfig {
  /** Slack Incoming Webhook URL, e.g. https://hooks.slack.com/services/… */
  webhookUrl: string;
  /** Override the bot display name (optional). */
  username?: string;
  /** Override the bot icon emoji, e.g. ":bell:" (optional). */
  iconEmoji?: string;
  /** Override the target channel, e.g. "#alerts" (optional).
   *  The webhook already has a default channel configured in Slack;
   *  setting this overrides it when the app has the correct permissions. */
  channel?: string;
}

/** Delivery outcome returned by every send call. */
export interface SlackDeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

// ─── Colour palette ──────────────────────────────────────────────────────────

const SEVERITY_COLOUR: Record<string, string> = {
  critical: '#E53E3E',
  warning: '#DD6B20',
  info: '#3182CE',
  success: '#38A169',
};

const EVENT_COLOUR: Partial<Record<WebhookEventType | NotificationType | string, string>> = {
  'subscription.created': '#38A169',
  'subscription.cancelled': '#E53E3E',
  'subscription.paused': '#DD6B20',
  'subscription.resumed': '#38A169',
  'subscription.renewed': '#3182CE',
  'subscription.upgraded': '#805AD5',
  'subscription.downgraded': '#D69E2E',
  'subscription.expired': '#718096',
  'payment.succeeded': '#38A169',
  'payment.failed': '#E53E3E',
  'payment.refunded': '#DD6B20',
  'trial.started': '#3182CE',
  'trial.ending_soon': '#DD6B20',
  'trial.ended': '#718096',
  'trial.converted': '#38A169',
  'usage.threshold_reached': '#DD6B20',
  'usage.limit_exceeded': '#E53E3E',
  charge_failed: '#E53E3E',
  charge_success: '#38A169',
  dunning: '#E53E3E',
  trial_ending: '#DD6B20',
  security_alert: '#E53E3E',
  renewal_reminder: '#3182CE',
};

const EVENT_EMOJI: Partial<Record<string, string>> = {
  'subscription.created': ':white_check_mark:',
  'subscription.cancelled': ':x:',
  'subscription.paused': ':pause_button:',
  'subscription.resumed': ':arrow_forward:',
  'subscription.renewed': ':arrows_counterclockwise:',
  'subscription.upgraded': ':arrow_up:',
  'subscription.downgraded': ':arrow_down:',
  'subscription.expired': ':hourglass:',
  'payment.succeeded': ':moneybag:',
  'payment.failed': ':rotating_light:',
  'payment.refunded': ':leftwards_arrow_with_hook:',
  'trial.started': ':clock1:',
  'trial.ending_soon': ':warning:',
  'trial.ended': ':timer_clock:',
  'trial.converted': ':tada:',
  'usage.threshold_reached': ':bar_chart:',
  'usage.limit_exceeded': ':stop_sign:',
  charge_failed: ':rotating_light:',
  charge_success: ':white_check_mark:',
  dunning: ':sos:',
  trial_ending: ':warning:',
  security_alert: ':lock:',
  renewal_reminder: ':bell:',
};

// ─── Block Kit builders ──────────────────────────────────────────────────────

function headerBlock(text: string): SlackBlock {
  return {
    type: 'header',
    text: { type: 'plain_text', text, emoji: true },
  };
}

function sectionBlock(text: string): SlackBlock {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text },
  };
}

function dividerBlock(): SlackBlock {
  return { type: 'divider' };
}

function fieldsBlock(fields: Array<{ label: string; value: string }>): SlackBlock {
  return {
    type: 'section',
    fields: fields.map((f) => ({
      type: 'mrkdwn',
      text: `*${f.label}*\n${f.value}`,
    })),
  };
}

function contextBlock(elements: string[]): SlackBlock {
  return {
    type: 'context',
    elements: elements.map((e) => ({ type: 'mrkdwn', text: e })),
  };
}

// ─── Message builders ────────────────────────────────────────────────────────

/**
 * Build a rich Block Kit message for a subscription lifecycle event.
 * Falls back to a plain-text attachment when Block Kit isn't supported.
 */
export function buildSubscriptionAlertMessage(ctx: SubscriptionAlertContext): SlackMessage {
  const emoji = EVENT_EMOJI[ctx.eventType] ?? ':bell:';
  const colour = EVENT_COLOUR[ctx.eventType] ?? '#718096';
  const label = ctx.eventType.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const fallbackText = `${emoji} SubTrackr — ${label}${ctx.subscriptionName ? ` (${ctx.subscriptionName})` : ''}`;

  const fields: Array<{ label: string; value: string }> = [];
  if (ctx.subscriptionId) fields.push({ label: 'Subscription ID', value: ctx.subscriptionId });
  if (ctx.subscriptionName) fields.push({ label: 'Subscription', value: ctx.subscriptionName });
  if (ctx.userId) fields.push({ label: 'User', value: ctx.userId });
  if (ctx.merchantId) fields.push({ label: 'Merchant', value: ctx.merchantId });
  if (ctx.amount !== undefined) {
    const formatted =
      ctx.currency
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: ctx.currency }).format(
            ctx.amount
          )
        : String(ctx.amount);
    fields.push({ label: 'Amount', value: formatted });
  }
  if (ctx.extra) {
    for (const [k, v] of Object.entries(ctx.extra)) {
      fields.push({ label: k, value: v });
    }
  }

  const blocks: SlackBlock[] = [
    headerBlock(`${emoji} ${label}`),
  ];

  if (fields.length > 0) {
    // Slack fields blocks support at most 10 fields; chunk if needed.
    for (let i = 0; i < fields.length; i += 10) {
      blocks.push(fieldsBlock(fields.slice(i, i + 10)));
    }
  }

  blocks.push(
    dividerBlock(),
    contextBlock([`:clock3: ${new Date().toUTCString()}`, 'SubTrackr Notification System'])
  );

  return {
    text: fallbackText,
    attachments: [{ color: colour, blocks }],
  };
}

/**
 * Build a Block Kit message for a system-level alert (maps to the
 * existing `Alert` shape used by `AlertingService`).
 */
export function buildSystemAlertMessage(alert: Alert): SlackMessage {
  const colour = SEVERITY_COLOUR[alert.severity] ?? '#718096';
  const emoji =
    alert.severity === 'critical' ? ':rotating_light:' : alert.severity === 'warning' ? ':warning:' : ':information_source:';
  const fallbackText = `${emoji} [${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`;

  const fields: Array<{ label: string; value: string }> = [
    { label: 'Severity', value: alert.severity.toUpperCase() },
    { label: 'Rule', value: alert.ruleId },
  ];
  if (alert.correlationId) fields.push({ label: 'Correlation ID', value: alert.correlationId });

  const blocks: SlackBlock[] = [
    headerBlock(`${emoji} ${alert.title}`),
    sectionBlock(alert.message),
    dividerBlock(),
    fieldsBlock(fields),
    contextBlock([
      `:clock3: ${new Date(alert.timestamp).toUTCString()}`,
      `Alert ID: ${alert.id}`,
      'SubTrackr Monitoring',
    ]),
  ];

  return {
    text: fallbackText,
    attachments: [{ color: colour, blocks }],
  };
}

// ─── SlackNotifier ────────────────────────────────────────────────────────────

/**
 * Low-level Slack notifier. Wraps the Incoming Webhooks API with:
 *  - configurable username / icon / channel overrides
 *  - structured result with HTTP status for the caller to act on
 *  - no external SDK dependency — plain `fetch`
 */
export class SlackNotifier {
  constructor(private readonly config: SlackNotifierConfig) {}

  /**
   * Send a raw `SlackMessage` to the configured webhook URL.
   * Returns a typed result instead of throwing on HTTP errors so callers
   * can decide whether to retry, log, or surface the failure.
   */
  async send(message: SlackMessage): Promise<SlackDeliveryResult> {
    const body: Record<string, unknown> = { ...message };
    if (this.config.username) body.username = this.config.username;
    if (this.config.iconEmoji) body.icon_emoji = this.config.iconEmoji;
    if (this.config.channel) body.channel = this.config.channel;

    try {
      const response = await fetch(this.config.webhookUrl, {
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
  }

  /** Convenience: build and send a subscription lifecycle event. */
  async sendSubscriptionAlert(ctx: SubscriptionAlertContext): Promise<SlackDeliveryResult> {
    return this.send(buildSubscriptionAlertMessage(ctx));
  }

  /** Convenience: build and send a system alert. */
  async sendSystemAlert(alert: Alert): Promise<SlackDeliveryResult> {
    return this.send(buildSystemAlertMessage(alert));
  }
}

// ─── SlackAlertDispatcher ────────────────────────────────────────────────────

/**
 * Adapts `SlackNotifier` to the existing `AlertDispatcher` interface so it
 * plugs into `AlertingService.addChannel()` with no refactoring required.
 */
export class SlackAlertDispatcher implements AlertDispatcher {
  private readonly notifier: SlackNotifier;

  constructor(config: SlackNotifierConfig) {
    this.notifier = new SlackNotifier(config);
  }

  async send(alert: Alert): Promise<void> {
    const result = await this.notifier.sendSystemAlert(alert);
    if (!result.success) {
      // Surface failures as errors so the AlertingService can log/retry.
      throw new Error(`Slack dispatch failed: ${result.error}`);
    }
  }
}

// ─── Factory helpers ─────────────────────────────────────────────────────────

/**
 * Create a `SlackNotifier` from environment variables.
 *
 * Required env var:
 *   SLACK_WEBHOOK_URL   — Slack Incoming Webhook URL
 *
 * Optional env vars:
 *   SLACK_USERNAME      — Bot display name (default: "SubTrackr")
 *   SLACK_ICON_EMOJI    — Bot icon emoji (default: ":bell:")
 *   SLACK_CHANNEL       — Override target channel (default: webhook default)
 *   SLACK_ALERTS_CHANNEL — Separate channel for critical system alerts
 */
export function createSlackNotifierFromEnv(
  env: Record<string, string | undefined> = process.env
): SlackNotifier | null {
  const webhookUrl = env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return null;

  return new SlackNotifier({
    webhookUrl,
    username: env.SLACK_USERNAME ?? 'SubTrackr',
    iconEmoji: env.SLACK_ICON_EMOJI ?? ':bell:',
    channel: env.SLACK_CHANNEL,
  });
}

export function createSlackAlertDispatcherFromEnv(
  env: Record<string, string | undefined> = process.env
): SlackAlertDispatcher | null {
  const webhookUrl = env.SLACK_ALERTS_WEBHOOK_URL ?? env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return null;

  return new SlackAlertDispatcher({
    webhookUrl,
    username: env.SLACK_USERNAME ?? 'SubTrackr Alerts',
    iconEmoji: env.SLACK_ICON_EMOJI ?? ':rotating_light:',
    channel: env.SLACK_ALERTS_CHANNEL ?? env.SLACK_CHANNEL,
  });
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Module-level singleton — null when SLACK_WEBHOOK_URL is not set. */
export const slackNotifier: SlackNotifier | null = createSlackNotifierFromEnv();
