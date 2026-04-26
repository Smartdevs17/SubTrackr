import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import type { Subscription } from '../types/subscription';
import { navigationRef } from '../navigation/navigationRef';

export const NOTIFICATION_DATA_TYPE = {
  RENEWAL_REMINDER: 'renewal_reminder',
  CHARGE_SUCCESS: 'charge_success',
  CHARGE_FAILED: 'charge_failed',
  TRANSACTION_QUEUE: 'transaction_queue',
  SLA_BREACH: 'sla_breach',
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
