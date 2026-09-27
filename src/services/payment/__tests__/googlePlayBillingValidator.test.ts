import {
  GooglePlayBillingValidator,
  GooglePlayPurchasePayload,
} from '../googlePlayBillingValidator';

describe('GooglePlayBillingValidator', () => {
  let validator: GooglePlayBillingValidator;

  beforeEach(() => {
    validator = new GooglePlayBillingValidator();
  });

  it('returns invalid state when payload fields are missing', async () => {
    const payload: GooglePlayPurchasePayload = {
      packageName: '',
      productId: 'sub_pro',
      purchaseToken: 'token_123',
      type: 'subs',
    };

    const result = await validator.validatePurchase(payload);

    expect(result.isValid).toBe(false);
    expect(result.purchaseState).toBe('INVALID');
    expect(result.error).toContain('Missing required validation fields');
  });

  it('validates a valid subscription purchase payload successfully', async () => {
    const payload: GooglePlayPurchasePayload = {
      packageName: 'com.subtrackr.app',
      productId: 'sub_pro_monthly',
      purchaseToken: 'valid_sub_token_123',
      type: 'subs',
    };

    const result = await validator.validatePurchase(payload);

    expect(result.isValid).toBe(true);
    expect(result.purchaseState).toBe('PURCHASED');
    expect(result.autoRenewing).toBe(true);
    expect(result.acknowledgementState).toBe('ACKNOWLEDGED');
    expect(result.orderId).toBeDefined();
    expect(result.isSandbox).toBe(false);
  });

  it('validates an in-app product purchase payload successfully', async () => {
    const payload: GooglePlayPurchasePayload = {
      packageName: 'com.subtrackr.app',
      productId: 'inapp_credits_100',
      purchaseToken: 'valid_inapp_token_456',
      type: 'inapp',
    };

    const result = await validator.validatePurchase(payload);

    expect(result.isValid).toBe(true);
    expect(result.purchaseState).toBe('PURCHASED');
    expect(result.acknowledgementState).toBe('ACKNOWLEDGED');
    expect(result.orderId).toBeDefined();
  });

  it('identifies sandbox/test account purchases from test token', async () => {
    const payload: GooglePlayPurchasePayload = {
      packageName: 'com.subtrackr.app',
      productId: 'sub_pro_monthly',
      purchaseToken: 'sandbox_test_token_789',
      type: 'subs',
    };

    const result = await validator.validatePurchase(payload);

    expect(result.isValid).toBe(true);
    expect(result.isSandbox).toBe(true);
  });

  it('handles invalid purchase tokens gracefully', async () => {
    const payload: GooglePlayPurchasePayload = {
      packageName: 'com.subtrackr.app',
      productId: 'sub_pro_monthly',
      purchaseToken: 'invalid_token_xyz',
      type: 'subs',
    };

    const result = await validator.validatePurchase(payload);

    expect(result.isValid).toBe(false);
    expect(result.purchaseState).toBe('INVALID');
    expect(result.error).toBe('Invalid purchase token');
  });

  it('caches validation responses for identical purchase tokens within TTL', async () => {
    const payload: GooglePlayPurchasePayload = {
      packageName: 'com.subtrackr.app',
      productId: 'sub_pro_monthly',
      purchaseToken: 'cached_token_abc',
      type: 'subs',
    };

    const result1 = await validator.validatePurchase(payload);
    const result2 = await validator.validatePurchase(payload);

    expect(result1).toEqual(result2);
  });

  it('returns false when signature verification fails', () => {
    const fakePublicKey =
      'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC3/yV6mY8v9zJ0u9A0M9...';
    const result = validator.verifySignature('{}', 'invalid_sig', fakePublicKey);

    expect(result).toBe(false);
  });
});
