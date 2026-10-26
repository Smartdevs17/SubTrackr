import { advisoryLockService, AdvisoryLockService, LockingError } from '../shared/locking';
import { SubscriptionError } from './errors';
import { logger } from '../shared/logging';

export class SubscriptionLockIntegration {
  constructor(private lockService: AdvisoryLockService = advisoryLockService) {}

  async transitionStateWithLock(
    subscriptionId: string,
    transitionFn: () => Promise<void>
  ): Promise<void> {
    try {
      await this.lockService.withLock(subscriptionId, transitionFn);
    } catch (err) {
      if (err instanceof LockingError) {
        logger.error('Subscription state transition lock failed', { subscriptionId, error: err.message });
        throw SubscriptionError.invalidState(
          subscriptionId,
          'locked',
          err.message
        );
      }
      throw err;
    }
  }
}

export const subscriptionLockIntegration = new SubscriptionLockIntegration();
