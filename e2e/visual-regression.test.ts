import { by, device, element, waitFor } from 'detox';
import { assertVisualSnapshot } from './helpers/visualRegression';
import {
  createSubscription,
  launchCleanApp,
  openSubscriptionByName,
} from './helpers/subscriptionFlows';

describe('Subscription Visual Regression', () => {
  beforeEach(async () => {
    await launchCleanApp();
  });

  it('captures home and detail visual baselines', async () => {
    await waitFor(element(by.id('home-screen')))
      .toBeVisible()
      .withTimeout(10000);
    const homeShot = (await device.takeScreenshot('home-screen')) as unknown as string;
    assertVisualSnapshot('home-screen', homeShot);

    const subName = 'E2E Visual Baseline';
    await createSubscription(subName, '8.49');
    await openSubscriptionByName(subName);

    await waitFor(element(by.id('subscription-detail-screen')))
      .toBeVisible()
      .withTimeout(10000);
    const detailShot = (await device.takeScreenshot(
      'subscription-detail-screen'
    )) as unknown as string;
    assertVisualSnapshot('subscription-detail-screen', detailShot);
  });
});
