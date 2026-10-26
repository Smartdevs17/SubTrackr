import { CLVPredictionService, CLVInput } from '../clvPredictionService';

describe('CLVPredictionService', () => {
  let service: CLVPredictionService;

  beforeEach(() => {
    service = new CLVPredictionService();
  });

  const mockInput: CLVInput = {
    userId: 'user-001',
    transactionCount: 12,
    totalRevenue: 1200,
    daysSinceFirstPurchase: 365,
    daysSinceLastPurchase: 5,
    averageOrderValue: 100,
  };

  describe('predictCLV', () => {
    it('should return a prediction with all required fields', () => {
      const result = service.predictCLV(mockInput);

      expect(result).toBeDefined();
      expect(result.userId).toBe('user-001');
      expect(result.model).toBe('hybrid-bg-nbd');
      expect(result.predictedCLV).toBeGreaterThanOrEqual(0);
      expect(result.confidenceInterval.lower).toBeLessThanOrEqual(result.predictedCLV);
      expect(result.confidenceInterval.upper).toBeGreaterThanOrEqual(result.predictedCLV);
      expect(result.expectedTransactions12M).toBeGreaterThanOrEqual(0);
      expect(result.expectedMonthlyValue).toBeGreaterThanOrEqual(0);
      expect(result.predictedLifespanMonths).toBeGreaterThanOrEqual(0);
      expect(result.churnProbability).toBeGreaterThanOrEqual(0);
      expect(result.churnProbability).toBeLessThanOrEqual(1);
      expect(result.computedAt).toBeInstanceOf(Date);
    });

    it('should return zero CLV for customers with no transactions', () => {
      const result = service.predictCLV({
        ...mockInput,
        transactionCount: 0,
        totalRevenue: 0,
      });

      expect(result.predictedCLV).toBe(0);
      expect(result.churnProbability).toBe(1);
      expect(result.expectedTransactions12M).toBe(0);
    });

    it('should return zero CLV for customers with negative revenue', () => {
      const result = service.predictCLV({
        ...mockInput,
        totalRevenue: -100,
      });

      expect(result.predictedCLV).toBe(0);
    });

    it('should predict higher CLV for active customers vs dormant ones', () => {
      const activeCustomer: CLVInput = {
        userId: 'active',
        transactionCount: 20,
        totalRevenue: 2000,
        daysSinceFirstPurchase: 365,
        daysSinceLastPurchase: 1,
        averageOrderValue: 100,
      };

      const dormantCustomer: CLVInput = {
        userId: 'dormant',
        transactionCount: 2,
        totalRevenue: 200,
        daysSinceFirstPurchase: 365,
        daysSinceLastPurchase: 350,
        averageOrderValue: 100,
      };

      const activeResult = service.predictCLV(activeCustomer);
      const dormantResult = service.predictCLV(dormantCustomer);

      expect(activeResult.predictedCLV).toBeGreaterThan(dormantResult.predictedCLV);
      expect(activeResult.churnProbability).toBeLessThan(dormantResult.churnProbability);
      expect(activeResult.expectedTransactions12M).toBeGreaterThan(dormantResult.expectedTransactions12M);
    });

    it('should cap lifespan at maximum', () => {
      const result = service.predictCLV({
        userId: 'loyal',
        transactionCount: 100,
        totalRevenue: 10000,
        daysSinceFirstPurchase: 1095, // 3 years
        daysSinceLastPurchase: 1,
        averageOrderValue: 100,
      });

      expect(result.predictedLifespanMonths).toBeLessThanOrEqual(120);
    });

    it('should produce a confidence interval that brackets the prediction', () => {
      const result = service.predictCLV(mockInput);

      expect(result.confidenceInterval.lower).toBeLessThanOrEqual(result.predictedCLV);
      expect(result.confidenceInterval.upper).toBeGreaterThanOrEqual(result.predictedCLV);
    });
  });

  describe('predictCLVBatch', () => {
    it('should return predictions for all inputs', () => {
      const inputs: CLVInput[] = [
        mockInput,
        { ...mockInput, userId: 'user-002', transactionCount: 5, totalRevenue: 500 },
        { ...mockInput, userId: 'user-003', transactionCount: 30, totalRevenue: 3000 },
      ];

      const results = service.predictCLVBatch(inputs);

      expect(results).toHaveLength(3);
      expect(results[0].userId).toBe('user-001');
      expect(results[1].userId).toBe('user-002');
      expect(results[2].userId).toBe('user-003');
    });

    it('should handle empty input array', () => {
      const results = service.predictCLVBatch([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('segmentByCLV', () => {
    it('should segment customers into VIP, Growth, and Standard tiers', () => {
      const inputs: CLVInput[] = Array.from({ length: 10 }, (_, i) => ({
        userId: `user-${i}`,
        transactionCount: (i + 1) * 3,
        totalRevenue: (i + 1) * 300,
        daysSinceFirstPurchase: 365,
        daysSinceLastPurchase: Math.max(1, (10 - i) * 10),
        averageOrderValue: 100,
      }));

      const results = service.predictCLVBatch(inputs);
      const segments = service.segmentByCLV(results);

      expect(segments).toHaveLength(3);
      expect(segments[0].tier).toBe('VIP');
      expect(segments[1].tier).toBe('Growth');
      expect(segments[2].tier).toBe('Standard');

      // VIP should have higher total CLV than Standard
      expect(segments[0].totalCLV).toBeGreaterThan(segments[2].totalCLV);
    });

    it('should handle empty results', () => {
      const segments = service.segmentByCLV([]);
      expect(segments).toHaveLength(0);
    });

    it('should include totalCLV in each segment', () => {
      const results = service.predictCLVBatch([mockInput, { ...mockInput, userId: 'u2' }]);
      const segments = service.segmentByCLV(results);

      segments.forEach((s) => {
        expect(s.totalCLV).toBeGreaterThanOrEqual(0);
        expect(s.customers.length).toBeGreaterThan(0);
      });
    });
  });
});
