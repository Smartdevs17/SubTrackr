import { by, element, expect, waitFor } from 'detox';
import {
  createSubscription,
  launchCleanApp,
  openSubscriptionByName,
} from './helpers/subscriptionFlows';

describe('Subscription Charging Flow E2E', () => {
  beforeAll(async () => {
    await launchCleanApp();
  });

  beforeEach(async () => {
    await launchCleanApp();
  });

  it('simulates successful and failed billing events', async () => {
    const subName = 'E2E Charge Flow';
    await createSubscription(subName, '11.99');
    await openSubscriptionByName(subName);

    await expect(element(by.id('simulate-charge-success-button'))).toBeVisible();
    await element(by.id('simulate-charge-success-button')).tap();

    await waitFor(element(by.id('simulate-charge-failed-button')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('simulate-charge-failed-button')).tap();

    // Validate action controls still available after charging operations.
    await expect(element(by.id('cancel-subscription-button'))).toBeVisible();
    await expect(element(by.id('pause-resume-subscription-button'))).toBeVisible();
  });
});
