import { Subscription, SubscriptionLifecycleStatus } from '../types/subscription';

export function isPausedSubscription(sub: Pick<Subscription, 'isActive' | 'status'>): boolean {
  return sub.status === SubscriptionLifecycleStatus.PAUSED || sub.isActive === false;
}

export function getSubscriptionStatus(sub: Pick<Subscription, 'isActive' | 'status'>): SubscriptionLifecycleStatus {
  if (sub.status) return sub.status;
  return sub.isActive ? SubscriptionLifecycleStatus.ACTIVE : SubscriptionLifecycleStatus.PAUSED;
}
