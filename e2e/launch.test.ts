import { by, device, element, expect, waitFor } from 'detox';

describe('App Launch', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should launch the app properly', async () => {
    // Using robust wait to ensure app loads
    const appContainer = element(by.id('app-root')).atIndex(0);
    // If 'app-root' testID isn't set, we might expect another known element, 
    // adjusting based on what's available or failing gracefully for now.
    try {
      await waitFor(appContainer).toExist().withTimeout(10000);
    } catch (e) {
      // Fallback check if testIDs aren't fully injected yet
      await expect(element(by.text('SubTrackr')).atIndex(0)).toBeVisible();
    }
  });
});
