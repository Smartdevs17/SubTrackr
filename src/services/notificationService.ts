import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import type { Subscription } from '../types/subscription';
import {
  NOTIFICATION_TYPE_META,
  type DeliveryResult,
  type NotificationChannel,
  type NotificationRecord,
  type NotificationType,
} from '../types/notification';
import { useNotificationPreferencesStore } from '../store/notificationPreferencesStore';
import { navigationRef } from '../navigation/navigationRef';

export const NOTIFICATION_DATA_TYPE = {
  RENEWAL_REMINDER: 'renewal_reminder',
  CHARGE_SUCCESS: 'charge_success',
  CHARGE_FAILED: 'charge_failed',
  TRANSACTION_QUEUE: 'transaction_queue',
  SLA_BREACH: 'sla_breach',
  DUNNING_RETRY: 'dunning_retry',
  DUNNING_WARNING: 'dunning_warning',
  DUNNING_SUSPENDED: 'dunning_suspended',
  DUNNING_CANCELLED: 'dunning_cancelled',
  DUNNING_RECOVERY: 'dunning_recovery',
} as const;

const ANDROID_CHANNEL_ID = 'billing';

let handlerConfigured = false;

function isNotificationsSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export function configureNotificationHandler(): void {
  if (!isNotificationsSupported() || handlerConfigured) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  handlerConfigured = true;
}

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Billing & renewals',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export async function getPermissionStatus(): Promise<Notifications.PermissionStatus> {
  if (!isNotificationsSupported()) return Notifications.PermissionStatus.DENIED;
  const settings = await Notifications.getPermissionsAsync();
  return settings.status;
}

export async function requestNotificationPermissions(): Promise<Notifications.PermissionStatus> {
  if (!isNotificationsSupported()) return Notifications.PermissionStatus.DENIED;
  configureNotificationHandler();
  await ensureAndroidNotificationChannel();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === Notifications.PermissionStatus.GRANTED) {
    return existing.status;
  }
  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  return requested.status;
}

function computeReminderDate(nextBilling: Date): Date | null {
  const billing = new Date(nextBilling.getTime());
  const oneDayBefore = new Date(billing.getTime() - 24 * 60 * 60 * 1000);
  const now = Date.now();
  if (oneDayBefore.getTime() > now) {
    return oneDayBefore;
  }
  const oneHourBefore = new Date(billing.getTime() - 60 * 60 * 1000);
  if (oneHourBefore.getTime() > now) {
    return oneHourBefore;
  }
  return null;
}

function subscriptionAllowsNotifications(sub: Subscription): boolean {
  return sub.isActive && sub.notificationsEnabled !== false;
}

async function scheduleRenewalReminder(sub: Subscription): Promise<void> {
  if (!isNotificationsSupported()) return;
  const status = await getPermissionStatus();
  if (status !== Notifications.PermissionStatus.GRANTED) return;

  const reminderDate = computeReminderDate(new Date(sub.nextBillingDate));
  if (!reminderDate) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Renewal soon: ${sub.name}`,
      body: `Your subscription renews on ${new Date(sub.nextBillingDate).toLocaleDateString()}. Check your balance.`,
      data: {
        type: NOTIFICATION_DATA_TYPE.RENEWAL_REMINDER,
        subscriptionId: sub.id,
      },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderDate,
      channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
    },
  });
}

/** Cancel all scheduled renewal reminders, then reschedule for eligible subscriptions. */
export async function syncRenewalReminders(subscriptions: Subscription[]): Promise<void> {
  if (!isNotificationsSupported()) return;
  configureNotificationHandler();
  await ensureAndroidNotificationChannel();

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of scheduled) {
    const data = item.content.data as { type?: string } | undefined;
    if (data?.type === NOTIFICATION_DATA_TYPE.RENEWAL_REMINDER) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
  }

  for (const sub of subscriptions) {
    if (!subscriptionAllowsNotifications(sub)) continue;
    await scheduleRenewalReminder(sub);
  }
}

export async function presentChargeSuccessNotification(sub: Subscription): Promise<void> {
  if (!isNotificationsSupported()) return;
  const status = await getPermissionStatus();
  if (status !== Notifications.PermissionStatus.GRANTED) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Payment successful: ${sub.name}`,
      body: `Your ${sub.currency} ${sub.price} charge completed.`,
      data: {
        type: NOTIFICATION_DATA_TYPE.CHARGE_SUCCESS,
        subscriptionId: sub.id,
      },
      sound: 'default',
    },
    trigger: null,
  });
}

export async function presentChargeFailedNotification(
  sub: Subscription,
  detail?: string
): Promise<void> {
  if (!isNotificationsSupported()) return;
  const status = await getPermissionStatus();
  if (status !== Notifications.PermissionStatus.GRANTED) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Payment failed: ${sub.name}`,
      body: detail ?? 'We could not complete your renewal. Check your payment method or balance.',
      data: {
        type: NOTIFICATION_DATA_TYPE.CHARGE_FAILED,
        subscriptionId: sub.id,
      },
      sound: 'default',
    },
    trigger: null,
  });
}

export async function presentTransactionQueueNotification(
  title: string,
  body: string
): Promise<void> {
  if (!isNotificationsSupported()) return;
  const status = await getPermissionStatus();
  if (status !== Notifications.PermissionStatus.GRANTED) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: {
        type: NOTIFICATION_DATA_TYPE.TRANSACTION_QUEUE,
      },
      sound: 'default',
    },
    trigger: null,
  });
}

export async function presentSlaBreachNotification(input: {
  merchantName: string;
  uptimeTarget: number;
  uptimePercentage: number;
  creditAmount: number;
}): Promise<void> {
  if (!isNotificationsSupported()) return;
  const status = await getPermissionStatus();
  if (status !== Notifications.PermissionStatus.GRANTED) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `SLA breach: ${input.merchantName}`,
      body: `Uptime dropped to ${input.uptimePercentage.toFixed(2)}% against a ${input.uptimeTarget}% target. Credit due: ${input.creditAmount}.`,
      data: {
        type: NOTIFICATION_DATA_TYPE.SLA_BREACH,
        merchantName: input.merchantName,
        uptimeTarget: input.uptimeTarget,
        uptimePercentage: input.uptimePercentage,
        creditAmount: input.creditAmount,
      },
      sound: 'default',
    },
    trigger: null,
  });
}

export async function presentLocalNotification(input: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  if (!isNotificationsSupported()) return;
  const status = await getPermissionStatus();
  if (status !== Notifications.PermissionStatus.GRANTED) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      sound: 'default',
    },
    trigger: null,
  });
}

// ── Dunning Notifications ──────────────────────────────────────────────

export async function presentDunningRetryNotification(
  sub: Subscription,
  attempt: number,
  maxAttempts: number
): Promise<void> {
  if (!isNotificationsSupported()) return;
  const status = await getPermissionStatus();
  if (status !== Notifications.PermissionStatus.GRANTED) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Payment retry: ${sub.name}`,
      body: `Retrying payment (${attempt}/${maxAttempts}). No action needed.`,
      data: {
        type: NOTIFICATION_DATA_TYPE.DUNNING_RETRY,
        subscriptionId: sub.id,
        dunningStage: 'retry',
      },
      sound: 'default',
    },
    trigger: null,
  });
}

export async function presentDunningWarningNotification(
  sub: Subscription,
  attempts: number
): Promise<void> {
  if (!isNotificationsSupported()) return;
  const status = await getPermissionStatus();
  if (status !== Notifications.PermissionStatus.GRANTED) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Action needed: ${sub.name}`,
      body: `${attempts} payment attempts failed. Update your payment method to avoid interruption.`,
      data: {
        type: NOTIFICATION_DATA_TYPE.DUNNING_WARNING,
        subscriptionId: sub.id,
        dunningStage: 'warn',
      },
      sound: 'default',
    },
    trigger: null,
  });
}

export async function presentDunningSuspendedNotification(sub: Subscription): Promise<void> {
  if (!isNotificationsSupported()) return;
  const status = await getPermissionStatus();
  if (status !== Notifications.PermissionStatus.GRANTED) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${sub.name} suspended`,
      body: 'Your subscription has been suspended due to payment issues. Update your payment method to restore service.',
      data: {
        type: NOTIFICATION_DATA_TYPE.DUNNING_SUSPENDED,
        subscriptionId: sub.id,
        dunningStage: 'suspend',
      },
      sound: 'default',
    },
    trigger: null,
  });
}

export async function presentDunningCancelledNotification(sub: Subscription): Promise<void> {
  if (!isNotificationsSupported()) return;
  const status = await getPermissionStatus();
  if (status !== Notifications.PermissionStatus.GRANTED) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${sub.name} cancelled`,
      body: 'Your subscription has been cancelled due to unresolved payment issues.',
      data: {
        type: NOTIFICATION_DATA_TYPE.DUNNING_CANCELLED,
        subscriptionId: sub.id,
        dunningStage: 'cancel',
      },
      sound: 'default',
    },
    trigger: null,
  });
}

export async function presentDunningRecoveryNotification(sub: Subscription): Promise<void> {
  if (!isNotificationsSupported()) return;
  const status = await getPermissionStatus();
  if (status !== Notifications.PermissionStatus.GRANTED) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Payment recovered: ${sub.name}`,
      body: 'Your payment was successfully processed. Your subscription is active.',
      data: {
        type: NOTIFICATION_DATA_TYPE.DUNNING_RECOVERY,
        subscriptionId: sub.id,
      },
      sound: 'default',
    },
    trigger: null,
  });
}

// ── Multi-channel delivery ─────────────────────────────────────────────
//
// Push is delivered on-device through Expo; email, SMS and in-app are handed
// to transports the host app registers, so this module stays free of any
// specific provider.

/** Sends one rendered message on one channel. Resolves false on refusal. */
export type ChannelTransport = (input: {
  channel: NotificationChannel;
  subject: string;
  body: string;
  data?: Record<string, string>;
}) => Promise<boolean>;

const transports = new Map<NotificationChannel, ChannelTransport>();

export function registerChannelTransport(
  channel: NotificationChannel,
  transport: ChannelTransport
): void {
  transports.set(channel, transport);
}

export function clearChannelTransports(): void {
  transports.clear();
}

const pushTransport: ChannelTransport = async ({ subject, body, data }) => {
  if (!isNotificationsSupported()) return false;
  const status = await getPermissionStatus();
  if (status !== Notifications.PermissionStatus.GRANTED) return false;

  await Notifications.scheduleNotificationAsync({
    content: { title: subject, body, data: data ?? {}, sound: 'default' },
    trigger: null,
  });
  return true;
};

function transportFor(channel: NotificationChannel): ChannelTransport | undefined {
  if (channel === 'push') return transports.get('push') ?? pushTransport;
  return transports.get(channel);
}

/** True when `date` falls inside the subscriber's quiet window. */
function isInQuietHours(
  date: Date,
  quietHours: { enabled: boolean; startHour: number; endHour: number }
): boolean {
  if (!quietHours.enabled) return false;
  const hour = date.getUTCHours();
  return quietHours.startHour < quietHours.endHour
    ? hour >= quietHours.startHour && hour < quietHours.endHour
    : hour >= quietHours.startHour || hour < quietHours.endHour;
}

/** The next moment outside the quiet window, or `date` if already outside. */
function nextDeliveryTime(
  date: Date,
  quietHours: { enabled: boolean; startHour: number; endHour: number }
): Date {
  if (!isInQuietHours(date, quietHours)) return date;
  const result = new Date(date);
  result.setUTCHours(quietHours.endHour, 0, 0, 0);
  if (result <= date) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
}

export interface DeliverNotificationInput {
  type: NotificationType;
  userId?: string;
  /** Values substituted into the type's template. */
  variables?: Record<string, string>;
  /** Used when no template is registered for a channel. */
  subject?: string;
  body?: string;
  data?: Record<string, string>;
  /** Stop after the first channel that accepts, rather than fanning out. */
  firstSuccessOnly?: boolean;
  /** Overrides "now" for scheduling decisions. */
  at?: Date;
}

/**
 * Deliver one notification across the channels the subscriber has enabled for
 * its type, recording every attempt in history.
 *
 * A notification with no enabled channel is recorded as suppressed rather than
 * dropped, so analytics can tell "not sent" from "sent and ignored".
 * Non-critical notifications inside quiet hours are recorded as scheduled for
 * the end of the window; critical ones go out immediately.
 */
export async function deliverNotification(
  input: DeliverNotificationInput
): Promise<DeliveryResult> {
  const store = useNotificationPreferencesStore.getState();
  const meta = NOTIFICATION_TYPE_META[input.type];
  const userId = input.userId ?? 'me';
  const now = input.at ?? new Date();
  const channels = store.channelsFor(input.type);

  const result: DeliveryResult = {
    userId,
    type: input.type,
    delivered: [],
    failed: [],
    suppressed: [],
    records: [],
    scheduled: false,
  };

  const record = (patch: Omit<NotificationRecord, 'id' | 'userId' | 'type'>): NotificationRecord =>
    store.recordNotification({ ...patch, userId, type: input.type });

  if (channels.length === 0) {
    const suppressed = record({
      channel: meta.defaultChannels[0],
      title: input.subject ?? meta.label,
      body: input.body ?? '',
      status: 'suppressed',
      createdAt: now.toISOString(),
      reason: store.preferences.types[input.type]?.muted
        ? 'Muted by the subscriber'
        : 'No channel enabled for this notification type',
      data: input.data,
    });
    result.suppressed.push(suppressed.channel);
    result.records.push(suppressed);
    return result;
  }

  const deferUntil =
    meta.priority === 'critical' ? now : nextDeliveryTime(now, store.preferences.quietHours);
  const deferred = deferUntil.getTime() !== now.getTime();

  for (const channel of channels) {
    const rendered = store.renderFor(input.type, channel, input.variables, {
      subject: input.subject,
      body: input.body,
    });

    if (deferred) {
      result.records.push(
        record({
          channel,
          title: rendered.subject,
          body: rendered.body,
          status: 'scheduled',
          createdAt: now.toISOString(),
          scheduledFor: deferUntil.toISOString(),
          reason: 'Deferred past quiet hours',
          data: input.data,
        })
      );
      continue;
    }

    const transport = transportFor(channel);
    let accepted = false;
    let reason: string | undefined;

    if (!transport) {
      reason = `No transport registered for ${channel}`;
    } else {
      try {
        accepted = await transport({
          channel,
          subject: rendered.subject,
          body: rendered.body,
          data: input.data,
        });
        if (!accepted) reason = `${channel} transport refused the notification`;
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
    }

    result.records.push(
      record({
        channel,
        title: rendered.subject,
        body: rendered.body,
        status: accepted ? 'delivered' : 'failed',
        createdAt: now.toISOString(),
        sentAt: now.toISOString(),
        reason,
        data: input.data,
      })
    );

    if (accepted) {
      result.delivered.push(channel);
      if (input.firstSuccessOnly) break;
    } else {
      result.failed.push(channel);
    }
  }

  if (deferred) {
    result.scheduled = true;
    result.scheduledFor = deferUntil.toISOString();
  }

  return result;
}

export function navigateToSubscriptionFromNotification(subscriptionId: string): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('HomeTab', {
    screen: 'SubscriptionDetail',
    params: { id: subscriptionId },
  });
}

export function attachNotificationResponseListeners(): () => void {
  configureNotificationHandler();

  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as
      | { subscriptionId?: string }
      | undefined;
    if (data?.subscriptionId) {
      navigateToSubscriptionFromNotification(data.subscriptionId);
    }
  });

  return () => sub.remove();
}
