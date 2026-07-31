import { validateAddSubscriptionParams, validateSubscriptionId } from './deepLinkValidator';

describe('deepLinkValidator', () => {
  describe('validateSubscriptionId', () => {
    it('returns valid for a correct alphanumeric ID', () => {
      expect(validateSubscriptionId('abc_123-XYZ')).toEqual({ isValid: true });
    });

    it('returns invalid for undefined, null, and empty string', () => {
      expect(validateSubscriptionId(undefined)).toEqual({
        isValid: false,
        error: 'Missing subscription ID',
      });
      expect(validateSubscriptionId(null)).toEqual({
        isValid: false,
        error: 'Missing subscription ID',
      });
      expect(validateSubscriptionId('')).toEqual({
        isValid: false,
        error: 'Missing subscription ID',
      });
    });

    it('returns invalid for IDs containing script tags or injection patterns', () => {
      expect(validateSubscriptionId('<script>alert(1)</script>')).toEqual({
        isValid: false,
        error: 'Invalid subscription ID format',
      });
      expect(validateSubscriptionId("1' OR 1=1 --")).toEqual({
        isValid: false,
        error: 'Invalid subscription ID format',
      });
    });
  });

  describe('validateAddSubscriptionParams', () => {
    it('returns sanitised name with HTML stripped', () => {
      const result = validateAddSubscriptionParams({
        name: ' <b>Netflix</b> ',
      });

      expect(result).toEqual({
        isValid: true,
        sanitised: { name: 'Netflix' },
        errors: [],
      });
    });

    it('returns invalid for negative amount', () => {
      const result = validateAddSubscriptionParams({ amount: -1 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid amount parameter');
      expect(result.sanitised.amount).toBeUndefined();
    });

    it('returns invalid for unknown cycle value', () => {
      const result = validateAddSubscriptionParams({ cycle: 'biweekly' });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid cycle parameter');
    });

    it('ignores unknown params and only processes known ones', () => {
      const result = validateAddSubscriptionParams({
        name: 'Spotify',
        amount: '9.99',
        cycle: 'monthly',
        extra: '<script>alert(1)</script>',
      });

      expect(result).toEqual({
        isValid: true,
        sanitised: {
          name: 'Spotify',
          amount: 9.99,
          cycle: 'monthly',
        },
        errors: [],
      });
    });

    it('accepts fully empty params', () => {
      expect(validateAddSubscriptionParams({})).toEqual({
        isValid: true,
        sanitised: {},
        errors: [],
      });
    });
  });
});
