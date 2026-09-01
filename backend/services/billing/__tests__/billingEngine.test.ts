import { BillingEngine } from '../billingEngine';
import { PricingStrategyFactory } from '../strategyFactory';
import { PricingContext } from '../pricingStrategy';

describe('BillingEngine Strategy Pattern Integration', () => {
  beforeEach(() => {
    PricingStrategyFactory.reset();
  });

  const sampleContext: PricingContext = {
    planId: 'plan-pro-01',
    subscriberAddress: '0x1234567890abcdef',
    currentPrice: 49.99,
    currency: 'USD',
    usageData: {
      sessionsPerWeek: 12,
      retentionRate: 0.95,
      apiCallsThisPeriod: 5500,
      storageUsedMB: 1024,
      seatsActive: 5,
    },
  };

  it('should initialize with default config', () => {
    const engine = new BillingEngine();
    expect(engine.getAvailableStrategies()).toEqual([
      'flat_rate',
      'usage_based',
      'tiered',
      'dynamic',
    ]);
  });

  it('should calculate price using default flat_rate for basic plan', () => {
    const engine = new BillingEngine();
    const result = engine.calculatePrice('basic', sampleContext);

    expect(result.strategyName).toBe('flat_rate');
    expect(result.price).toBe(49.99);
    expect(result.breakdown.finalPrice).toBe(49.99);
  });

  it('should calculate price using tiered strategy for premium plan', () => {
    const engine = new BillingEngine();
    const result = engine.calculatePrice('premium', sampleContext);

    expect(result.strategyName).toBe('tiered');
    expect(result.price).toBeGreaterThan(0);
  });

  it('should allow runtime strategy override', () => {
    const engine = new BillingEngine();
    const result = engine.calculatePrice('basic', sampleContext, 'usage_based');

    expect(result.strategyName).toBe('usage_based');
  });

  it('should process billing charge and record history', () => {
    const engine = new BillingEngine();
    const record = engine.processCharge('enterprise', sampleContext);

    expect(record.subscriptionId).toBe('plan-pro-01');
    expect(record.amount).toBeGreaterThan(0);
    expect(record.currency).toBe('USD');

    const history = engine.getBillingHistory('0x1234567890abcdef');
    expect(history.length).toBe(1);
    expect(history[0].subscriptionId).toBe('plan-pro-01');
  });

  it('should generate A/B test variants and analytics', () => {
    const engine = new BillingEngine();
    engine.calculatePrice('basic', sampleContext);

    const variants = engine.getABTestVariants('basic', 49.99);
    expect(variants.length).toBeGreaterThan(0);

    const analytics = engine.getAnalytics('flat_rate');
    expect(analytics.length).toBe(1);
    expect(analytics[0].totalCalculations).toBe(2); // calculatePrice + getABTestVariants
  });
});
