import type { Subscription } from '../types/subscription';
import { presentLocalNotification } from './notificationService';

export const SUBSCRIPTION_EVENT = {
  ADDED: 'subscription_added',
  PAUSED: 'subscription_paused',
  RESUMED: 'subscription_resumed',
  CANCELLED: 'subscription_cancelled',
  PRICE_CHANGED: 'price_changed',
} as const;

export type SubscriptionEvent = (typeof SUBSCRIPTION_EVENT)[keyof typeof SUBSCRIPTION_EVENT];

function subscriptionAllowsNotifications(sub: Subscription): boolean {
  return sub.notificationsEnabled !== false;
}

/**
 * Push a local notification for a subscription lifecycle event.
 * Uses the existing permission + channel path in notificationService.
 */
export async function notifySubscriptionEvent(
  event: SubscriptionEvent,
  sub: Subscription,
  extras?: { previousPrice?: number }
): Promise<void> {
  if (!subscriptionAllowsNotifications(sub)) return;

  const payload = buildPayload(event, sub, extras);
  if (!payload) return;

  await presentLocalNotification({
    title: payload.title,
    body: payload.body,
    data: {
      type: event,
      subscriptionId: sub.id,
    },
  });
}

function buildPayload(
  event: SubscriptionEvent,
  sub: Subscription,
  extras?: { previousPrice?: number }
): { title: string; body: string } | null {
  switch (event) {
    case SUBSCRIPTION_EVENT.ADDED:
      return {
        title: `Tracking ${sub.name}`,
        body: `We'll remind you before the ${sub.price} ${sub.currency} renewal.`,
      };
    case SUBSCRIPTION_EVENT.PAUSED:
      return {
        title: `${sub.name} paused`,
        body: 'Billing is paused. Resume anytime to keep this subscription tracked.',
      };
    case SUBSCRIPTION_EVENT.RESUMED:
      return {
        title: `${sub.name} resumed`,
        body: `Next charge is ${new Date(sub.nextBillingDate).toLocaleDateString()}.`,
      };
    case SUBSCRIPTION_EVENT.CANCELLED:
      return {
        title: `${sub.name} cancelled`,
        body: 'This subscription was removed and will no longer send billing alerts.',
      };
    case SUBSCRIPTION_EVENT.PRICE_CHANGED:
      return {
        title: `${sub.name} price updated`,
        body:
          extras?.previousPrice !== undefined
            ? `Price changed from ${extras.previousPrice} to ${sub.price} ${sub.currency}.`
            : `New price is ${sub.price} ${sub.currency}.`,
      };
    default:
      return null;
  }
}
