/**
 * Proration Service Tests
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1117
 */

import { ProrationService, calculateCycleDays } from '../domain/prorationService';
import { BillingCycle } from '../../../src/types/subscription';
import type { ProrationCalculationRequest } from '../../../src/types/prorationCalculator';

describe('ProrationService', () => {
  let service: ProrationService;

  const baseRequest: ProrationCalculationRequest = {
    subscriptionId: 'sub_001',
    currentPlanId: 'basic',
    currentPlanName: 'Basic',
    currentPrice: 9.99,
    currentCycle: BillingCycle.MONTHLY,
    newPlanId: 'premium',
    newPlanName: 'Premium',
    newPrice: 29.99,
    newCycle: BillingCycle.MONTHLY,
    cycleStartDate: '2026-09-01',
    cycleEndDate: '2026-10-01',
    effectiveDate: '2026-09-15',
  };

  beforeEach(() => {
    service = new ProrationService();
  });

  describe('calculateCycleDays', () => {
    it('should compute days between two dates', () => {
      expect(calculateCycleDays('2026-09-01', '2026-10-01')).toBe(30);
      expect(calculateCycleDays('2026-01-01', '2026-02-01')).toBe(31);
    });

    it('should return at least 1 day', () => {
      expect(calculateCycleDays('2026-09-01', '2026-09-01')).toBe(1);
    });
  });

  describe('preview', () => {
    it('should calculate proration for an upgrade', () => {
      const result = service.preview(baseRequest);

      expect(result.mode).toBe('upgrade');
      expect(result.currentPlan.id).toBe('basic');
      expect(result.newPlan.id).toBe('premium');
      expect(result.daysRemaining).toBeGreaterThan(0);
      expect(result.daysUsed).toBeGreaterThan(0);
      expect(result.isCredit).toBe(false); // upgrade = charge, not credit
      expect(result.netProratedAmount).toBeGreaterThan(0);
      expect(result.breakdown).toHaveLength(2);
      expect(result.explanationText).toContain('Basic');
      expect(result.explanationText).toContain('Premium');
    });

    it('should calculate proration for a downgrade as a credit', () => {
      const result = service.preview({
        ...baseRequest,
        currentPlanId: 'premium',
        currentPlanName: 'Premium',
        currentPrice: 29.99,
        newPlanId: 'basic',
        newPlanName: 'Basic',
        newPrice: 9.99,
      });

      expect(result.mode).toBe('downgrade');
      expect(result.isCredit).toBe(true);
      expect(result.netProratedAmount).toBeGreaterThan(0);
    });

    it('should detect billing cycle change when price is same', () => {
      const result = service.preview({
        ...baseRequest,
        currentPrice: 9.99,
        newPrice: 9.99,
        newCycle: BillingCycle.YEARLY,
      });

      expect(result.mode).toBe('billing_cycle_change');
    });

    it('should include tax when configured', () => {
      const result = service.preview({
        ...baseRequest,
        config: { includeTax: true, defaultTaxRate: 10 },
      });

      expect(result.taxAmount).toBeGreaterThan(0);
      expect(result.breakdown).toHaveLength(3);
      expect(result.breakdown[2].type).toBe('tax');
    });

    it('should generate transparent breakdown items', () => {
      const result = service.preview(baseRequest);

      const unusedItem = result.breakdown.find((b) => b.type === 'unused_portion');
      expect(unusedItem).toBeDefined();
      expect(unusedItem!.isCredit).toBe(true);
      expect(unusedItem!.daysRemaining).toBe(result.daysRemaining);

      const newItem = result.breakdown.find((b) => b.type === 'new_portion');
      expect(newItem).toBeDefined();
      expect(newItem!.isCredit).toBe(false);
    });

    it('should populate transparencySummary', () => {
      const result = service.preview(baseRequest);

      expect(result.transparencySummary.unusedCreditFromOldPlan).toBeGreaterThan(0);
      expect(result.transparencySummary.chargeForNewPlan).toBeGreaterThan(0);
      expect(result.transparencySummary.finalAmountToBillOrCredit).toBeGreaterThan(0);
    });
  });

  describe('calculateAndStore', () => {
    it('should persist a proration record in preview status', () => {
      const record = service.calculateAndStore(baseRequest);

      expect(record.id).toBeDefined();
      expect(record.status).toBe('preview');
      expect(record.subscriptionId).toBe('sub_001');
      expect(record.result.mode).toBe('upgrade');
    });
  });

  describe('apply', () => {
    it('should mark a record as applied', () => {
      const record = service.calculateAndStore(baseRequest);
      const applied = service.apply(record.id);

      expect(applied).not.toBeNull();
      expect(applied!.status).toBe('applied');
      expect(applied!.appliedAt).toBeDefined();
    });

    it('should return null for unknown record', () => {
      expect(service.apply('nonexistent')).toBeNull();
    });
  });

  describe('cancel', () => {
    it('should mark a record as cancelled', () => {
      const record = service.calculateAndStore(baseRequest);
      const cancelled = service.cancel(record.id);

      expect(cancelled).not.toBeNull();
      expect(cancelled!.status).toBe('cancelled');
    });
  });

  describe('listBySubscription', () => {
    it('should list records for a subscription', () => {
      service.calculateAndStore(baseRequest);
      service.calculateAndStore({ ...baseRequest, newPlanId: 'enterprise', newPlanName: 'Enterprise', newPrice: 49.99 });

      const records = service.listBySubscription('sub_001');
      expect(records).toHaveLength(2);
    });

    it('should return empty for unknown subscription', () => {
      expect(service.listBySubscription('unknown')).toHaveLength(0);
    });
  });

  describe('getAnalytics', () => {
    it('should aggregate proration analytics', () => {
      service.calculateAndStore(baseRequest);
      service.calculateAndStore({
        ...baseRequest,
        currentPlanId: 'premium',
        currentPlanName: 'Premium',
        currentPrice: 29.99,
        newPlanId: 'basic',
        newPlanName: 'Basic',
        newPrice: 9.99,
      });

      const analytics = service.getAnalytics();

      expect(analytics.totalCalculations).toBe(2);
      expect(analytics.totalUpgrades).toBe(1);
      expect(analytics.totalDowngrades).toBe(1);
      expect(analytics.mostCommonUpgradePath).not.toBeNull();
      expect(analytics.prorationVolumeByMonth.length).toBeGreaterThan(0);
    });
  });
});
