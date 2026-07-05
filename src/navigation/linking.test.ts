import { linkingConfig } from './linking';

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `subtrackr://${path}`,
}));

describe('linkingConfig', () => {
  it('includes both the custom scheme and https prefixes', () => {
    expect(linkingConfig.prefixes).toEqual(
      expect.arrayContaining(['subtrackr://', 'https://subtrackr.app'])
    );
  });

  it('maps the subscription detail path to the correct screen', () => {
    expect(
      (linkingConfig.config?.screens as { HomeTab?: { screens?: { SubscriptionDetail?: string } } })
        ?.HomeTab?.screens?.SubscriptionDetail
    ).toBe('subscription/:id');
  });
});
