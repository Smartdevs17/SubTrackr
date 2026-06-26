import { by, device } from 'detox';
import { assertVisualSnapshot } from './helpers/visualRegression';
import { launchSeededApp, openSubscriptionByName } from './helpers/subscriptionFlows';
import { waitForVisible } from './helpers/waits';
import { fixtures, NETFLIX_FIXTURE } from './helpers/testData';

describe('Subscription Visual Regression', () => {
  beforeEach(async () => {
    // Seed identical, frozen data so screenshots are byte-stable across runs.
    await launchSeededApp(fixtures.portfolio);
  });

  it('captures home and detail visual baselines within tolerance', async () => {
    await waitForVisible(by.id('home-screen'));
    const homeShot = (await device.takeScreenshot('home-screen')) as unknown as string;
    // Slightly looser tolerance for the list screen (scroll position / shadows).
    assertVisualSnapshot('home-screen', homeShot, { maxDiffRatio: 0.02 });

    await openSubscriptionByName(NETFLIX_FIXTURE.name);
    await waitForVisible(by.id('subscription-detail-screen'));
    const detailShot = (await device.takeScreenshot(
      'subscription-detail-screen'
    )) as unknown as string;
    assertVisualSnapshot('subscription-detail-screen', detailShot);
  });
});
