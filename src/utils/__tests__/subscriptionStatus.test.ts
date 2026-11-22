import { getSubscriptionStatus, isPausedSubscription } from '../subscriptionStatus';
import { SubscriptionLifecycleStatus } from '../../types/subscription';

describe('subscriptionStatus utils', () => {
  it('detects paused status', () => {
    expect(isPausedSubscription({ isActive: false, status: SubscriptionLifecycleStatus.PAUSED })).toBe(true);
    expect(getSubscriptionStatus({ isActive: true, status: SubscriptionLifecycleStatus.ACTIVE })).toBe(SubscriptionLifecycleStatus.ACTIVE);
  });
});
