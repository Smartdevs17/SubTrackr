/**
 * Subscription lifecycle notifier.
 *
 * Single entry point for raising subscription-related notifications across
 * every available channel in one call.  Callers (subscription service,
 * payment processor, trial manager, etc.) call the typed helpers here
 * instead of reaching into individual providers.
 *
 * Channels used per event
 * ───────────────────────
 *  charge_failed     → NotificationCenterService (push, email, sms)
 *                    + Slack alert
 *                    + Webhook event (payment.failed)
 *  charge_success    → NotificationCenterService (push, in_app)
 *                    + Webhook event (payment.succeeded)
 *  renewal_reminder  → NotificationCenterService (push, email)
 *                    + Slack alert (informational)
 *  trial_ending      → NotificationCenterService (push, email)
 *  subscription.cancelled / paused / resumed / expired / upgraded / downgraded
 *                    → NotificationCenterService (push, email)
 *                    + Slack alert
 *                    + Webhook event
 *  security_alert    → NotificationCenterService (push, email, sms) critical
 *                    + Slack alert
 */

import { notificationCenterService } from './notificationCenterService';
import type { SlackNotifier } from './slack';
import type { IWebhookDeliveryService } from './interfaces';
import type {
  WebhookEventInput,
  WebhookEventType,
  WebhookSubscriptionSnapshot,
  WebhookPlanSnapshot,
} from '../../../src/types/webhook';
import type { NotificationType } from '../../../src/types/notification';

// ─── Types ────────────────────────────────────────────────────────────────────

/** User context needed for every notification. */
export interface NotificationRecipient {
  userId: string;
  /** Display name for templates, e.g. "Jane Smith". */
  name?: string;
  /** E-mail address — required for the `email` channel. */
  email?: string;
  /** E.164 phone number — required for the `sms` channel. */
  phone?: string;
}

/** Subscription metadata surfaced in messages and webhook payloads. */
export interface SubscriptionContext {
  subscriptionId: string;
  subscriptionName: string;
  merchantId: string;
  merchantName?: string;
  amount?: number;
  currency?: string;
  /** ISO-8601 date string for renewal / trial expiry. */
  nextDate?: string;
  webhookId?: string;
  planSnapshot?: WebhookPlanSnapshot;
  subscriptionSnapshot?: WebhookSubscriptionSnapshot;
  previousStatus?: string;
  currentStatus?: string;
}

export interface SubscriptionNotifierDeps {
  slackNotifier: SlackNotifier | null;
  webhookService: IWebhookDeliveryService | null;
}

// ─── Helper: build webhook event input ───────────────────────────────────────

function buildWebhookInput(
  eventType: WebhookEventType,
  recipient: NotificationRecipient,
  ctx: SubscriptionContext
): WebhookEventInput | null {
  if (!ctx.webhookId) return null;
  if (!ctx.subscriptionSnapshot || !ctx.planSnapshot) return null;

  return {
    webhookId: ctx.webhookId,
    merchantId: ctx.merchantId,
    eventType,
    subscription: ctx.subscriptionSnapshot,
    plan: ctx.planSnapshot,
    previousStatus: ctx.previousStatus ?? '',
    currentStatus: ctx.currentStatus ?? '',
  };
}

// ─── Helper: build data bag for NotificationCenterService ────────────────────

function buildDataBag(
  recipient: NotificationRecipient,
  ctx: SubscriptionContext
): Record<string, string> {
  const bag: Record<string, string> = {
    notificationType: '',       // filled per call
    subscriptionId: ctx.subscriptionId,
    subscriptionName: ctx.subscriptionName,
    merchantId: ctx.merchantId,
  };
  if (recipient.email) bag['email'] = recipient.email;
  if (recipient.phone) bag['phone'] = recipient.phone;
  if (recipient.name) bag['userName'] = recipient.name;
  if (ctx.merchantName) bag['merchant_name'] = ctx.merchantName;
  if (ctx.amount !== undefined) bag['amount'] = String(ctx.amount);
  if (ctx.currency) bag['currency'] = ctx.currency;
  if (ctx.nextDate) bag['next_billing_date'] = ctx.nextDate;
  return bag;
}

// ─── SubscriptionNotifier ─────────────────────────────────────────────────────

export class SubscriptionNotifier {
  constructor(private readonly deps: SubscriptionNotifierDeps) {}

  // ── Payment events ──────────────────────────────────────────────────────────

  async notifyChargeFailed(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext
  ): Promise<void> {
    const type: NotificationType = 'charge_failed';
    const data: Record<string, string> = {
      ...buildDataBag(recipient, ctx),
      notificationType: type,
    };

    // 1. Multi-channel notification (push, email, sms per subscriber prefs)
    await notificationCenterService.deliver({
      userId: recipient.userId,
      type,
      variables: data,
      fallbackSubject: `Payment failed — ${ctx.subscriptionName}`,
      fallbackBody:
        `We couldn't process your payment` +
        (ctx.amount && ctx.currency
          ? ` of ${ctx.currency} ${ctx.amount}`
          : '') +
        ` for ${ctx.subscriptionName}. Please update your payment method.`,
      data,
    });

    // 2. Slack alert
    await this.deps.slackNotifier
      ?.sendSubscriptionAlert({
        eventType: 'payment.failed',
        subscriptionId: ctx.subscriptionId,
        subscriptionName: ctx.subscriptionName,
        userId: recipient.userId,
        merchantId: ctx.merchantId,
        amount: ctx.amount,
        currency: ctx.currency,
      })
      .catch((e) => console.error('[SubscriptionNotifier] Slack charge_failed failed:', e));

    // 3. Webhook delivery
    const webhookInput = buildWebhookInput('payment.failed', recipient, ctx);
    if (webhookInput) {
      await this.deps.webhookService
        ?.deliverEvent(webhookInput)
        .catch((e) => console.error('[SubscriptionNotifier] Webhook payment.failed failed:', e));
    }
  }

  async notifyChargeSuccess(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext
  ): Promise<void> {
    const type: NotificationType = 'charge_success';
    const data: Record<string, string> = {
      ...buildDataBag(recipient, ctx),
      notificationType: type,
    };

    await notificationCenterService.deliver({
      userId: recipient.userId,
      type,
      variables: data,
      fallbackSubject: `Payment confirmed — ${ctx.subscriptionName}`,
      fallbackBody:
        `Your payment` +
        (ctx.amount && ctx.currency ? ` of ${ctx.currency} ${ctx.amount}` : '') +
        ` for ${ctx.subscriptionName} was successful.`,
      data,
    });

    const webhookInput = buildWebhookInput('payment.succeeded', recipient, ctx);
    if (webhookInput) {
      await this.deps.webhookService
        ?.deliverEvent(webhookInput)
        .catch((e) => console.error('[SubscriptionNotifier] Webhook payment.succeeded failed:', e));
    }
  }

  // ── Subscription lifecycle ──────────────────────────────────────────────────

  async notifyRenewalReminder(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext
  ): Promise<void> {
    const type: NotificationType = 'renewal_reminder';
    const data: Record<string, string> = {
      ...buildDataBag(recipient, ctx),
      notificationType: type,
    };

    await notificationCenterService.deliver({
      userId: recipient.userId,
      type,
      variables: data,
      fallbackSubject: `Upcoming renewal — ${ctx.subscriptionName}`,
      fallbackBody:
        `Your ${ctx.subscriptionName} subscription renews on ${ctx.nextDate ?? 'soon'}` +
        (ctx.amount && ctx.currency ? ` for ${ctx.currency} ${ctx.amount}` : '') +
        '.', 
      data,
    });

    await this.deps.slackNotifier
      ?.sendSubscriptionAlert({
        eventType: 'renewal_reminder',
        subscriptionId: ctx.subscriptionId,
        subscriptionName: ctx.subscriptionName,
        userId: recipient.userId,
        merchantId: ctx.merchantId,
        amount: ctx.amount,
        currency: ctx.currency,
        extra: ctx.nextDate ? { 'Renews on': ctx.nextDate } : undefined,
      })
      .catch((e) => console.error('[SubscriptionNotifier] Slack renewal_reminder failed:', e));
  }

  async notifyTrialEnding(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext
  ): Promise<void> {
    const type: NotificationType = 'trial_ending';
    const data: Record<string, string> = {
      ...buildDataBag(recipient, ctx),
      notificationType: type,
    };

    await notificationCenterService.deliver({
      userId: recipient.userId,
      type,
      variables: data,
      fallbackSubject: `Trial ending soon — ${ctx.subscriptionName}`,
      fallbackBody:
        `Your free trial for ${ctx.subscriptionName} ends on ${ctx.nextDate ?? 'soon'}. ` +
        (ctx.amount && ctx.currency
          ? `After that, you'll be charged ${ctx.currency} ${ctx.amount}.`
          : 'Update your plan to keep access.'),
      data,
    });

    const webhookInput = buildWebhookInput('trial.ending_soon', recipient, ctx);
    if (webhookInput) {
      await this.deps.webhookService
        ?.deliverEvent(webhookInput)
        .catch((e) => console.error('[SubscriptionNotifier] Webhook trial.ending_soon failed:', e));
    }
  }

  async notifySubscriptionCancelled(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext
  ): Promise<void> {
    await this._notifyLifecycle(
      recipient,
      ctx,
      'subscription.cancelled',
      `Subscription cancelled — ${ctx.subscriptionName}`,
      `Your ${ctx.subscriptionName} subscription has been cancelled. ` +
        `You'll keep access until the end of the current billing period.`
    );
  }

  async notifySubscriptionPaused(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext
  ): Promise<void> {
    await this._notifyLifecycle(
      recipient,
      ctx,
      'subscription.paused',
      `Subscription paused — ${ctx.subscriptionName}`,
      `Your ${ctx.subscriptionName} subscription has been paused.`
    );
  }

  async notifySubscriptionResumed(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext
  ): Promise<void> {
    await this._notifyLifecycle(
      recipient,
      ctx,
      'subscription.resumed',
      `Subscription resumed — ${ctx.subscriptionName}`,
      `Your ${ctx.subscriptionName} subscription is now active again.`
    );
  }

  async notifySubscriptionExpired(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext
  ): Promise<void> {
    await this._notifyLifecycle(
      recipient,
      ctx,
      'subscription.expired',
      `Subscription expired — ${ctx.subscriptionName}`,
      `Your ${ctx.subscriptionName} subscription has expired.`
    );
  }

  async notifySubscriptionUpgraded(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext
  ): Promise<void> {
    await this._notifyLifecycle(
      recipient,
      ctx,
      'subscription.upgraded',
      `Plan upgraded — ${ctx.subscriptionName}`,
      `Your ${ctx.subscriptionName} plan has been upgraded.`
    );
  }

  async notifySubscriptionDowngraded(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext
  ): Promise<void> {
    await this._notifyLifecycle(
      recipient,
      ctx,
      'subscription.downgraded',
      `Plan downgraded — ${ctx.subscriptionName}`,
      `Your ${ctx.subscriptionName} plan has been downgraded.`
    );
  }

  // ── Security ────────────────────────────────────────────────────────────────

  async notifySecurityAlert(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext,
    detail: string
  ): Promise<void> {
    const type: NotificationType = 'security_alert';
    const data: Record<string, string> = {
      ...buildDataBag(recipient, ctx),
      notificationType: type,
      detail,
    };

    // Critical — goes out immediately, ignores quiet hours.
    await notificationCenterService.deliver({
      userId: recipient.userId,
      type,
      variables: data,
      fallbackSubject: 'Security alert — SubTrackr',
      fallbackBody: detail,
      data,
    });

    await this.deps.slackNotifier
      ?.sendSubscriptionAlert({
        eventType: 'security_alert',
        userId: recipient.userId,
        merchantId: ctx.merchantId,
        extra: { Detail: detail },
      })
      .catch((e) => console.error('[SubscriptionNotifier] Slack security_alert failed:', e));
  }

  // ── Dunning ─────────────────────────────────────────────────────────────────

  async notifyDunning(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext,
    attemptNumber: number
  ): Promise<void> {
    const type: NotificationType = 'dunning';
    const data: Record<string, string> = {
      ...buildDataBag(recipient, ctx),
      notificationType: type,
      attempt: String(attemptNumber),
    };

    await notificationCenterService.deliver({
      userId: recipient.userId,
      type,
      variables: data,
      fallbackSubject: `Payment needed — ${ctx.subscriptionName}`,
      fallbackBody:
        `This is attempt ${attemptNumber} to recover payment for ${ctx.subscriptionName}. ` +
        `Please update your payment method to avoid service interruption.`,
      data,
    });

    await this.deps.slackNotifier
      ?.sendSubscriptionAlert({
        eventType: 'dunning',
        subscriptionId: ctx.subscriptionId,
        subscriptionName: ctx.subscriptionName,
        userId: recipient.userId,
        merchantId: ctx.merchantId,
        amount: ctx.amount,
        currency: ctx.currency,
        extra: { 'Attempt #': String(attemptNumber) },
      })
      .catch((e) => console.error('[SubscriptionNotifier] Slack dunning failed:', e));

    const webhookInput = buildWebhookInput('payment.retry_scheduled', recipient, ctx);
    if (webhookInput) {
      await this.deps.webhookService
        ?.deliverEvent(webhookInput)
        .catch((e) =>
          console.error('[SubscriptionNotifier] Webhook payment.retry_scheduled failed:', e)
        );
    }
  }

  // ── Generic lifecycle helper ─────────────────────────────────────────────────

  private async _notifyLifecycle(
    recipient: NotificationRecipient,
    ctx: SubscriptionContext,
    webhookEventType: WebhookEventType,
    subject: string,
    body: string
  ): Promise<void> {
    // Map webhook event type → notification type for preference resolution.
    const notifType: NotificationType = 'product_update'; // generic fallback

    const data: Record<string, string> = {
      ...buildDataBag(recipient, ctx),
      notificationType: notifType,
    };

    await notificationCenterService.deliver({
      userId: recipient.userId,
      type: notifType,
      variables: data,
      fallbackSubject: subject,
      fallbackBody: body,
      data,
    });

    await this.deps.slackNotifier
      ?.sendSubscriptionAlert({
        eventType: webhookEventType,
        subscriptionId: ctx.subscriptionId,
        subscriptionName: ctx.subscriptionName,
        userId: recipient.userId,
        merchantId: ctx.merchantId,
      })
      .catch((e) =>
        console.error(`[SubscriptionNotifier] Slack ${webhookEventType} failed:`, e)
      );

    const webhookInput = buildWebhookInput(webhookEventType, recipient, ctx);
    if (webhookInput) {
      await this.deps.webhookService
        ?.deliverEvent(webhookInput)
        .catch((e) =>
          console.error(`[SubscriptionNotifier] Webhook ${webhookEventType} failed:`, e)
        );
    }
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

import { slackNotifier } from './slack';
import { webhookDeliveryService } from './webhook';

export const subscriptionNotifier = new SubscriptionNotifier({
  slackNotifier,
  webhookService: webhookDeliveryService,
});
