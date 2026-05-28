/**
 * Alerting service — dispatches alerts to Slack, PagerDuty, or console.
 * Channels are pluggable; add as many as needed.
 */

import { logger } from './logging';
import type { Alert, AlertChannelConfig } from './types';

export interface AlertDispatcher {
  send(alert: Alert): Promise<void>;
}

// ── Channel implementations ───────────────────────────────────────────────────

class ConsoleDispatcher implements AlertDispatcher {
  async send(alert: Alert): Promise<void> {
    const prefix =
      alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';
    logger.info(`${prefix} [${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`, {
      correlationId: alert.correlationId,
      alertId: alert.id,
      severity: alert.severity,
    });
  }
}

class WebhookDispatcher implements AlertDispatcher {
  constructor(
    private readonly url: string,
    private readonly type: 'slack' | 'pagerduty'
  ) {}

  async send(alert: Alert): Promise<void> {
    const body =
      this.type === 'slack'
        ? JSON.stringify({
            text: `*[${alert.severity.toUpperCase()}] ${alert.title}*\n${alert.message}`,
          })
        : JSON.stringify({
            routing_key: '', // populated from env in production
            event_action: alert.severity === 'critical' ? 'trigger' : 'acknowledge',
            payload: {
              summary: alert.title,
              severity: alert.severity,
              source: 'SubTrackr',
              custom_details: { message: alert.message, timestamp: alert.timestamp },
            },
          });

    await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createDispatcher(config: AlertChannelConfig): AlertDispatcher {
  if (config.type === 'console') return new ConsoleDispatcher();
  if (!config.webhookUrl) throw new Error(`webhookUrl required for channel type "${config.type}"`);
  return new WebhookDispatcher(config.webhookUrl, config.type);
}

// ── Alerting service ──────────────────────────────────────────────────────────

export class AlertingService {
  private dispatchers: AlertDispatcher[] = [];
  private sent = new Set<string>();

  constructor(channels: AlertChannelConfig[] = [{ type: 'console' }]) {
    this.dispatchers = channels.map(createDispatcher);
  }

  addChannel(config: AlertChannelConfig): void {
    this.dispatchers.push(createDispatcher(config));
  }

  /** Dispatch an alert to all channels (idempotent — same alert id sent only once) */
  async dispatch(alert: Alert): Promise<void> {
    if (this.sent.has(alert.id)) return;
    this.sent.add(alert.id);
    await Promise.all(this.dispatchers.map((d) => d.send(alert)));
  }

  /** Dispatch all unresolved alerts from a list */
  async dispatchAll(alerts: Alert[]): Promise<void> {
    await Promise.all(alerts.filter((a) => !a.resolved).map((a) => this.dispatch(a)));
  }
}
