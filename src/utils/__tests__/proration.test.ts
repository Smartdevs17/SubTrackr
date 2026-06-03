import {
  previewProration,
  calculateUpgradeProration,
  calculateDowngradeProration,
  generateCreditMemo,
  applyCreditMemo,
  calculateNetProration,
  getPeriodDays,
  getRemainingDays,
} from '../proration';
import { Subscription, SubscriptionCategory, BillingCycle } from '../../types/subscription';

const makeSub = (overrides: Partial<Subscription> = {}): Subscription => {
  const nextBillingDate = new Date();
  nextBillingDate.setDate(nextBillingDate.getDate() + 15);
  return {
    id: 'sub-1',
    name: 'Test',
    category: SubscriptionCategory.SOFTWARE,
    price: 30,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate,
    isActive: true,
    isCryptoEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
};

describe('getPeriodDays', () => {
  it('returns 30 for monthly', () => expect(getPeriodDays(BillingCycle.MONTHLY)).toBe(30));
  it('returns 365 for yearly', () => expect(getPeriodDays(BillingCycle.YEARLY)).toBe(365));
  it('returns 7 for weekly', () => expect(getPeriodDays(BillingCycle.WEEKLY)).toBe(7));
  it('returns 30 for custom', () => expect(getPeriodDays(BillingCycle.CUSTOM)).toBe(30));
});

describe('previewProration', () => {
  it('is not a credit for upgrade (newPrice > oldPrice)', () => {
    const preview = previewProration(makeSub({ price: 10 }), 20, 'immediate');
    expect(preview.isCredit).toBe(false);
    expect(preview.amount).toBeGreaterThan(0);
  });

  it('is a credit for downgrade (newPrice < oldPrice)', () => {
    const preview = previewProration(makeSub({ price: 30 }), 10, 'immediate');
    expect(preview.isCredit).toBe(true);
    expect(preview.amount).toBeGreaterThan(0);
  });

  it('returns zero amount for end_of_period', () => {
    const preview = previewProration(makeSub(), 50, 'end_of_period');
    expect(preview.amount).toBe(0);
    expect(preview.effectiveDate).toBe('end_of_period');
  });

  it('returns zero when prices are equal', () => {
    const preview = previewProration(makeSub({ price: 20 }), 20, 'immediate');
    expect(preview.amount).toBe(0);
  });

  it('amount formula: (newPrice - oldPrice) * remainingDays / periodDays', () => {
    const sub = makeSub({ price: 30 });
    const remaining = getRemainingDays(sub);
    const preview = previewProration(sub, 60, 'immediate');
    const expected = Math.round(((60 - 30) * remaining) / 30 * 100) / 100;
    expect(preview.amount).toBeCloseTo(expected);
  });

  it('includes description string for upgrade', () => {
    const upgradePreview = previewProration(makeSub({ price: 10 }), 20, 'immediate');
    expect(upgradePreview.description).toContain('upgrade');
  });

  it('includes description string for downgrade', () => {
    const downgradePreview = previewProration(makeSub({ price: 30 }), 10, 'immediate');
    expect(downgradePreview.description).toContain('downgrade');
  });
});

describe('calculateUpgradeProration', () => {
  it('is not a credit', () => {
    const preview = calculateUpgradeProration(makeSub({ price: 10 }), 30);
    expect(preview.isCredit).toBe(false);
  });
});

describe('calculateDowngradeProration', () => {
  it('is a credit', () => {
    const preview = calculateDowngradeProration(makeSub({ price: 30 }), 10);
    expect(preview.isCredit).toBe(true);
  });
});

describe('generateCreditMemo', () => {
  it('creates memo with correct fields', () => {
    const memo = generateCreditMemo('sub-1', 15, 'downgrade credit');
    expect(memo.subscriptionId).toBe('sub-1');
    expect(memo.amount).toBe(15);
    expect(memo.remainingBalance).toBe(15);
    expect(memo.applied).toBe(false);
  });
});

describe('applyCreditMemo', () => {
  it('reduces charge by full memo when charge > credit', () => {
    const memo = generateCreditMemo('sub-1', 10, 'credit');
    const { finalCharge, updatedMemo } = applyCreditMemo(50, memo);
    expect(finalCharge).toBe(40);
    expect(updatedMemo.remainingBalance).toBe(0);
    expect(updatedMemo.applied).toBe(true);
  });

  it('reduces charge to zero and leaves partial balance', () => {
    const memo = generateCreditMemo('sub-1', 100, 'credit');
    const { finalCharge, updatedMemo } = applyCreditMemo(30, memo);
    expect(finalCharge).toBe(0);
    expect(updatedMemo.remainingBalance).toBe(70);
    expect(updatedMemo.applied).toBe(false);
  });

  it('does not apply if memo already applied', () => {
    const memo = { ...generateCreditMemo('sub-1', 10, 'credit'), applied: true };
    const { finalCharge } = applyCreditMemo(50, memo);
    expect(finalCharge).toBe(50);
  });
});

describe('calculateNetProration', () => {
  it('nets a positive and negative change to zero for equal amounts', () => {
    const sub = makeSub({ price: 20 });
    const result = calculateNetProration(sub, [
      { oldPrice: 20, newPrice: 30, effectiveDate: 'immediate' },
      { oldPrice: 30, newPrice: 20, effectiveDate: 'immediate' },
    ]);
    expect(result.amount).toBe(0);
  });
});
