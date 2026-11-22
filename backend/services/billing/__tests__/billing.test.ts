import { PricingStrategyFactory, PlanType } from '../strategyFactory';
import { PricingContext } from '../pricingStrategy';
import { BillingEngine } from '../billingEngine';
import { PricingAnalyticsService } from '../billingAnalytics';

describe('PricingStrategyFactory', () => {
  afterEach(() => {
    PricingStrategyFactory.reset();
  });

  it('should create flat_rate strategy for basic plans', () => {
    const strategy = PricingStrategyFactory.resolveStrategy({ planType: 'basic' });
    expect(strategy.name).toBe('flat_rate');
  });

  it('should create tiered strategy for premium plans', () => {
    const strategy = PricingStrategyFactory.resolveStrategy({ planType: 'premium' });
    expect(strategy.name).toBe('tiered');
  });

  it('should create dynamic strategy for enterprise plans', () => {
    const strategy = PricingStrategyFactory.resolveStrategy({ planType: 'enterprise' });
    expect(strategy.name).toBe('dynamic');
  });

  it('should allow strategy override', () => {
    const strategy = PricingStrategyFactory.resolveStrategy({
      planType: 'basic',
      strategyOverride: 'usage_based',
    });
    expect(strategy.name).toBe('usage_based');
  });

  it('should return available strategies', () => {
    const strategies = PricingStrategyFactory.getAvailableStrategies();
    expect(strategies).toContain('flat_rate');
    expect(strategies).toContain('usage_based');
    expect(strategies).toContain('tiered');
    expect(strategies).toContain('dynamic');
  });
});

describe('Pricing Strategies', () => {
  const baseContext: PricingContext = {
    planId: 'plan_1',
    subscriberAddress: '0xABC',
    currentPrice: 10.0,
    currency: 'USD',
    usageData: {
      sessionsPerWeek: 5,
      retentionRate: 0.7,
      apiCallsThisPeriod: 500,
      storageUsedMB: 200,
      seatsActive: 3,
    },
  };

  describe('FlatRateStrategy', () => {
    it('should calculate flat rate price', () => {
      const strategy = PricingStrategyFactory.getStrategy('flat_rate');
      const result = strategy.calculatePrice(baseContext);
      expect(result.price).toBeGreaterThan(0);
      expect(result.strategyName).toBe('flat_rate');
      expect(result.breakdown).toBeDefined();
    });
  });

  describe('UsageBasedStrategy', () => {
    it('should calculate usage-based price', () => {
      const strategy = PricingStrategyFactory.getStrategy('usage_based');
      const result = strategy.calculatePrice(baseContext);
      expect(result.price).toBeGreaterThanOrEqual(0);
      expect(result.strategyName).toBe('usage_based');
    });
  });

  describe('TieredPricingStrategy', () => {
    it('should calculate tiered price', () => {
      const strategy = PricingStrategyFactory.getStrategy('tiered');
      const result = strategy.calculatePrice(baseContext);
      expect(result.price).toBeGreaterThan(0);
      expect(result.strategyName).toBe('tiered');
    });
  });

  describe('DynamicPricingStrategy', () => {
    it('should calculate dynamic price', () => {
      const strategy = PricingStrategyFactory.getStrategy('dynamic');
      const result = strategy.calculatePrice(baseContext);
      expect(result.price).toBeGreaterThan(0);
      expect(result.strategyName).toBe('dynamic');
      expect(result.metadata).toHaveProperty('recommendation');
    });
  });
});

describe('BillingEngine', () => {
  it('should calculate price for a plan type', () => {
    const engine = new BillingEngine();
    const result = engine.calculatePrice('basic', {
      planId: 'plan_1',
      subscriberAddress: '0xABC',
      currentPrice: 10.0,
      currency: 'USD',
    });
    expect(result.price).toBeGreaterThan(0);
  });

  it('should process a charge and record billing history', () => {
    const engine = new BillingEngine();
    const record = engine.processCharge('basic', {
      planId: 'plan_1',
      subscriberAddress: '0xABC',
      currentPrice: 10.0,
      currency: 'USD',
    });
    expect(record.amount).toBeGreaterThan(0);
    expect(engine.getBillingHistory()).toHaveLength(1);
  });

  it('should get AB test variants', () => {
    const engine = new BillingEngine();
    const variants = engine.getABTestVariants('basic', 10.0);
    expect(variants.length).toBeGreaterThan(0);
  });
});

describe('PricingAnalyticsService', () => {
  it('should track pricing events', () => {
    const service = new PricingAnalyticsService();
    service.trackPricingEvent(
      { price: 10.0, strategyName: 'flat_rate', breakdown: {} as any, metadata: {} },
      'basic',
      '0xABC'
    );
    const metrics = service.getRevenueMetrics();
    expect(metrics.totalRevenue).toBe(10.0);
  });
});
