/**
 * mobile/src/screens/gift/__tests__/giftShareLogic.test.ts
 *
 * Unit tests for pure gift-share business logic, validation rules,
 * code generation, and expiry calculations.
 */

import {
  BASE_CLAIM_URL,
  DEFAULT_EXPIRY_DAYS,
  DEFAULT_SAMPLE_SUBSCRIPTIONS,
  MAX_EXPIRY_DAYS,
  MAX_PERSONAL_MESSAGE_LENGTH,
  MIN_EXPIRY_DAYS,
  buildShareableUrl,
  calculateGiftExpiry,
  createMockGiftResult,
  detectRecipientType,
  generateGiftCode,
  validateEmail,
  validateGiftEligibility,
  validatePersonalMessage,
  validateRecipient,
  validateStellarAddress,
} from '../giftShareLogic';
import type { GiftableSubscription, GiftShareFormState } from '../types';

describe('giftShareLogic', () => {
  describe('validateEmail', () => {
    it('returns true for standard email formats', () => {
      expect(validateEmail('alice@example.com')).toBe(true);
      expect(validateEmail('bob.smith+tag@domain.co.uk')).toBe(true);
      expect(validateEmail('user_123@sub.domain.org')).toBe(true);
    });

    it('returns false for invalid email formats or empty strings', () => {
      expect(validateEmail('')).toBe(false);
      expect(validateEmail('notanemail')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
      expect(validateEmail('@domain.com')).toBe(false);
      expect(validateEmail('user@domain')).toBe(false);
    });
  });

  describe('validateStellarAddress', () => {
    // Valid 56-char base32 Stellar public key
    const validKey = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

    it('returns true for valid 56-character Stellar public keys', () => {
      expect(validateStellarAddress(validKey)).toBe(true);
    });

    it('returns false for invalid prefixes, lengths, or characters', () => {
      expect(validateStellarAddress('')).toBe(false);
      // Starts with S (Secret seed), not G
      expect(
        validateStellarAddress('SBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
      ).toBe(false);
      // Too short
      expect(validateStellarAddress('GBBD47IF6LWK7P7MDEVSCWR7DPUW')).toBe(false);
      // Contains invalid base32 characters ('0', '1', '8', '9' where not allowed)
      expect(
        validateStellarAddress('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA0')
      ).toBe(false);
    });
  });

  describe('detectRecipientType', () => {
    it('detects stellar_address when starting with G and 56 characters', () => {
      const stellar = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
      expect(detectRecipientType(stellar)).toBe('stellar_address');
    });

    it('defaults to email for any other inputs', () => {
      expect(detectRecipientType('user@example.com')).toBe('email');
      expect(detectRecipientType('invalid-input')).toBe('email');
    });
  });

  describe('validateRecipient', () => {
    it('validates a correct email address', () => {
      const res = validateRecipient('recipient@subtrackr.com');
      expect(res.isValid).toBe(true);
      expect(res.type).toBe('email');
      expect(res.error).toBeUndefined();
    });

    it('validates a correct Stellar address', () => {
      const key = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
      const res = validateRecipient(key);
      expect(res.isValid).toBe(true);
      expect(res.type).toBe('stellar_address');
      expect(res.error).toBeUndefined();
    });

    it('rejects empty input', () => {
      const res = validateRecipient('   ');
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('required');
    });

    it('rejects an invalid Stellar address format', () => {
      const invalidKey = 'G1234567890123456789012345678901234567890123456789012345';
      const res = validateRecipient(invalidKey);
      expect(res.isValid).toBe(false);
      expect(res.type).toBe('stellar_address');
      expect(res.error).toContain('Invalid Stellar');
    });

    it('rejects an invalid email format', () => {
      const res = validateRecipient('not-an-email');
      expect(res.isValid).toBe(false);
      expect(res.type).toBe('email');
      expect(res.error).toContain('valid email');
    });
  });

  describe('validatePersonalMessage', () => {
    it('allows empty or valid length messages', () => {
      expect(validatePersonalMessage('').isValid).toBe(true);
      expect(validatePersonalMessage('Enjoy this Netflix subscription!').isValid).toBe(true);
      expect(validatePersonalMessage('a'.repeat(MAX_PERSONAL_MESSAGE_LENGTH)).isValid).toBe(true);
    });

    it('rejects messages exceeding the maximum character limit', () => {
      const tooLong = 'a'.repeat(MAX_PERSONAL_MESSAGE_LENGTH + 1);
      const res = validatePersonalMessage(tooLong);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain(`must not exceed ${MAX_PERSONAL_MESSAGE_LENGTH} characters`);
    });
  });

  describe('validateGiftEligibility', () => {
    const baseSub: GiftableSubscription = {
      id: 'sub_test',
      name: 'Test Sub',
      planTier: 'pro',
      billingCycle: 'monthly',
      price: 10,
      currency: 'USD',
      renewalDate: '2026-12-01',
      status: 'active',
      isGiftable: true,
    };

    it('allows active, giftable subscriptions', () => {
      expect(validateGiftEligibility(baseSub).isEligible).toBe(true);
    });

    it('disallows canceled subscriptions', () => {
      const res = validateGiftEligibility({ ...baseSub, status: 'canceled' });
      expect(res.isEligible).toBe(false);
      expect(res.reason).toContain('Canceled');
    });

    it('disallows paused subscriptions', () => {
      const res = validateGiftEligibility({ ...baseSub, status: 'paused' });
      expect(res.isEligible).toBe(false);
      expect(res.reason).toContain('Paused');
    });

    it('disallows subscriptions with explicit isGiftable = false', () => {
      const res = validateGiftEligibility({
        ...baseSub,
        isGiftable: false,
        nonGiftableReason: 'Team admin authorization required.',
      });
      expect(res.isEligible).toBe(false);
      expect(res.reason).toBe('Team admin authorization required.');
    });
  });

  describe('generateGiftCode', () => {
    it('generates a code with format SUB-XXXX-XXXX', () => {
      const code = generateGiftCode();
      expect(code).toMatch(/^SUB-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    });

    it('supports custom prefix', () => {
      const code = generateGiftCode('GIFT');
      expect(code.startsWith('GIFT-')).toBe(true);
    });

    it('generates unique codes', () => {
      const codes = new Set();
      for (let i = 0; i < 50; i++) {
        codes.add(generateGiftCode());
      }
      expect(codes.size).toBe(50);
    });
  });

  describe('buildShareableUrl', () => {
    it('constructs encoded claim URL with claim code', () => {
      const url = buildShareableUrl('SUB-ABCD-EFGH');
      expect(url).toBe(`${BASE_CLAIM_URL}?code=SUB-ABCD-EFGH`);
    });

    it('safely encodes special characters in code', () => {
      const url = buildShareableUrl('CODE+123');
      expect(url).toContain('CODE%2B123');
    });
  });

  describe('calculateGiftExpiry', () => {
    const fixedDate = new Date('2026-11-23T12:00:00Z');

    it('exposes standard expiry constraints', () => {
      expect(DEFAULT_EXPIRY_DAYS).toBe(7);
      expect(MIN_EXPIRY_DAYS).toBe(1);
      expect(MAX_EXPIRY_DAYS).toBe(30);
    });

    it('calculates expiry accurately for 7 days', () => {
      const { createdAt, expiresAt } = calculateGiftExpiry(7, fixedDate);
      expect(createdAt).toBe('2026-11-23T12:00:00.000Z');
      expect(expiresAt).toBe('2026-11-30T12:00:00.000Z');
    });

    it('clamps expiry days to MIN_EXPIRY_DAYS (1) and MAX_EXPIRY_DAYS (30)', () => {
      const minExpiry = calculateGiftExpiry(-5, fixedDate);
      expect(minExpiry.expiresAt).toBe('2026-11-24T12:00:00.000Z'); // 1 day

      const maxExpiry = calculateGiftExpiry(100, fixedDate);
      expect(maxExpiry.expiresAt).toBe('2026-12-23T12:00:00.000Z'); // 30 days
    });
  });

  describe('createMockGiftResult', () => {
    it('generates full GiftShareResult based on form state and subscription', () => {
      const sub = DEFAULT_SAMPLE_SUBSCRIPTIONS[0];
      const formState: GiftShareFormState = {
        subscriptionId: sub.id,
        recipientInput: 'friend@test.com',
        recipientType: 'email',
        deliveryMethod: 'share_link',
        personalMessage: 'Enjoy this!',
        expiresInDays: 7,
        allowSenderRevoke: true,
      };

      const result = createMockGiftResult(formState, sub);

      expect(result.giftId).toMatch(/^gift_/);
      expect(result.subscriptionId).toBe(sub.id);
      expect(result.subscriptionName).toBe(sub.name);
      expect(result.recipient).toBe('friend@test.com');
      expect(result.recipientType).toBe('email');
      expect(result.claimCode).toMatch(/^SUB-/);
      expect(result.shareableUrl).toContain(result.claimCode);
      expect(result.status).toBe('pending');
      expect(result.personalMessage).toBe('Enjoy this!');
    });
  });
});
