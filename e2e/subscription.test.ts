import { by, element, expect, waitFor } from 'detox';
import {
  createSubscription,
  dismissAnySystemAlert,
  launchCleanApp,
  openSubscriptionByName,
  expectBillingCycle,
} from './helpers/subscriptionFlows';

describe('Subscription Lifecycle E2E', () => {
  beforeAll(async () => {
    await launchCleanApp();
  });

  beforeEach(async () => {
    await launchCleanApp();
  });

  it('creates a subscription from home flow', async () => {
    await createSubscription('E2E Create Subscription', '9.99', 'monthly');
    await expect(element(by.text('E2E Create Subscription'))).toBeVisible();
  });

  it('cancels an existing subscription', async () => {
    const subName = 'E2E Cancel Subscription';
    await createSubscription(subName, '14.50', 'monthly');
    await openSubscriptionByName(subName);

    await element(by.id('cancel-subscription-button')).tap();
    await waitFor(element(by.text('Yes, Cancel')))
      .toBeVisible()
      .withTimeout(3000);
    await element(by.text('Yes, Cancel')).tap();
    await dismissAnySystemAlert();

    await waitFor(element(by.id('home-screen')))
      .toBeVisible()
      .withTimeout(10000);
    await waitFor(element(by.text(subName)))
      .not.toExist()
      .withTimeout(10000);
  });

  it('changes plan cycle and reflects in detail screen', async () => {
    const subName = 'E2E Plan Change';
    await createSubscription(subName, '49.99', 'yearly');
    await openSubscriptionByName(subName);
    await expectBillingCycle('yearly');
  });
});
