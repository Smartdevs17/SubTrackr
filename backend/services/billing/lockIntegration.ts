import { advisoryLockService, AdvisoryLockService, LockingError } from '../shared/locking';
import { BillingError } from './errors';
import { logger } from '../shared/logging';

export class BillingLockIntegration {
  constructor(private lockService: AdvisoryLockService = advisoryLockService) {}

  async chargeWithLock(subscriptionId: string, chargeFn: () => Promise<void>): Promise<void> {
    try {
      await this.lockService.withLock(subscriptionId, chargeFn);
    } catch (err) {
      if (err instanceof LockingError) {
        logger.error('Billing lock acquisition failed', { subscriptionId, error: err.message });
        throw BillingError.paymentFailed(subscriptionId, `Lock error: ${err.message}`);
      }
      throw err;
    }
  }

  async cancelWithLock(subscriptionId: string, cancelFn: () => Promise<void>): Promise<void> {
    try {
      await this.lockService.withLock(subscriptionId, cancelFn);
    } catch (err) {
      if (err instanceof LockingError) {
        logger.error('Cancel lock acquisition failed', { subscriptionId, error: err.message });
        throw BillingError.paymentFailed(subscriptionId, `Lock error: ${err.message}`);
      }
      throw err;
    }
  }

  async pauseWithLock(subscriptionId: string, pauseFn: () => Promise<void>): Promise<void> {
    try {
      await this.lockService.withLock(subscriptionId, pauseFn);
    } catch (err) {
      if (err instanceof LockingError) {
        logger.error('Pause lock acquisition failed', { subscriptionId, error: err.message });
        throw BillingError.paymentFailed(subscriptionId, `Lock error: ${err.message}`);
      }
      throw err;
    }
  }

  async resumeWithLock(subscriptionId: string, resumeFn: () => Promise<void>): Promise<void> {
    try {
      await this.lockService.withLock(subscriptionId, resumeFn);
    } catch (err) {
      if (err instanceof LockingError) {
        logger.error('Resume lock acquisition failed', { subscriptionId, error: err.message });
        throw BillingError.paymentFailed(subscriptionId, `Lock error: ${err.message}`);
      }
      throw err;
    }
  }

  async upgradeWithLock(subscriptionId: string, upgradeFn: () => Promise<void>): Promise<void> {
    try {
      await this.lockService.withLock(subscriptionId, upgradeFn);
    } catch (err) {
      if (err instanceof LockingError) {
        logger.error('Upgrade lock acquisition failed', { subscriptionId, error: err.message });
        throw BillingError.paymentFailed(subscriptionId, `Lock error: ${err.message}`);
      }
      throw err;
    }
  }
}

export const billingLockIntegration = new BillingLockIntegration();
