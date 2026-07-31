import { by, expect, element } from 'detox';
import { launchCleanApp } from './helpers/subscriptionFlows';

describe('App Launch', () => {
  beforeAll(async () => {
    await launchCleanApp();
  });

  it('should launch the app properly', async () => {
    await expect(element(by.id('app-root'))).toExist();
    await expect(element(by.id('home-screen'))).toBeVisible();
    await expect(element(by.text('SubTrackr'))).toBeVisible();
  });
});
