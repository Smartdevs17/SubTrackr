import { getSubscriptionShareLink } from './shareLink';

describe('shareLink', () => {
  it('returns a correctly formatted URL', () => {
    expect(getSubscriptionShareLink('sub-123')).toBe('https://subtrackr.app/subscription/sub-123');
  });

  it('encodes special characters in the ID', () => {
    expect(getSubscriptionShareLink('id with spaces/?')).toBe(
      'https://subtrackr.app/subscription/id%20with%20spaces%2F%3F'
    );
  });
});
