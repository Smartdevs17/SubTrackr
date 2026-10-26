import { HealthScoreService, HealthScoreInput } from '../healthScoreService';

describe('HealthScoreService', () => {
  let service: HealthScoreService;

  beforeEach(() => {
    service = new HealthScoreService();
  });

  const healthyInput: HealthScoreInput = {
    subscriptionId: 'sub-001',
    userId: 'user-001',
    planName: 'Pro',
    totalPayments: 12,
    failedPayments: 0,
    monthlyActiveDays: 25,
    totalDaysInPeriod: 30,
    subscriptionAgeDays: 365,
    openSupportTickets: 0,
    totalSupportTickets: 1,
    planLimit: 10000,
    currentUsage: 7000,
    daysSinceLastLogin: 1,
  };

  const atRiskInput: HealthScoreInput = {
    subscriptionId: 'sub-002',
    userId: 'user-002',
    planName: 'Basic',
    totalPayments: 6,
    failedPayments: 2,
    monthlyActiveDays: 10,
    totalDaysInPeriod: 30,
    subscriptionAgeDays: 180,
    openSupportTickets: 2,
    totalSupportTickets: 5,
    planLimit: 1000,
    currentUsage: 100,
    daysSinceLastLogin: 20,
  };

  const criticalInput: HealthScoreInput = {
    subscriptionId: 'sub-003',
    userId: 'user-003',
    planName: 'Basic',
    totalPayments: 3,
    failedPayments: 3,
    monthlyActiveDays: 2,
    totalDaysInPeriod: 30,
    subscriptionAgeDays: 30,
    openSupportTickets: 5,
    totalSupportTickets: 10,
    planLimit: 1000,
    currentUsage: 50,
    daysSinceLastLogin: 45,
  };

  describe('computeHealthScore', () => {
    it('should return a result with all required fields', () => {
      const result = service.computeHealthScore(healthyInput);

      expect(result).toBeDefined();
      expect(result.subscriptionId).toBe('sub-001');
      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(100);
      expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade);
      expect(['healthy', 'at-risk', 'critical', 'churning']).toContain(result.status);
      expect(result.factors).toHaveLength(5);
      expect(result.recommendation).toBeTruthy();
      expect(result.computedAt).toBeInstanceOf(Date);
    });

    it('should score healthy subscriptions highly', () => {
      const result = service.computeHealthScore(healthyInput);

      expect(result.overallScore).toBeGreaterThanOrEqual(75);
      expect(result.grade).toBe('A');
      expect(result.status).toBe('healthy');
    });

    it('should score at-risk subscriptions lower', () => {
      const result = service.computeHealthScore(atRiskInput);

      expect(result.overallScore).toBeLessThan(75);
      expect(result.overallScore).toBeGreaterThanOrEqual(40);
    });

    it('should score critical subscriptions very low', () => {
      const result = service.computeHealthScore(criticalInput);

      expect(result.overallScore).toBeLessThan(40);
      expect(['critical', 'churning']).toContain(result.status);
    });

    it('should have 5 factors with correct names', () => {
      const result = service.computeHealthScore(healthyInput);

      const factorNames = result.factors.map((f) => f.name);
      expect(factorNames).toContain('Payment Reliability');
      expect(factorNames).toContain('Usage Engagement');
      expect(factorNames).toContain('Tenure / Loyalty');
      expect(factorNames).toContain('Support Burden');
      expect(factorNames).toContain('Plan Utilization');
    });

    it('should have weights that sum to 1.0', () => {
      const result = service.computeHealthScore(healthyInput);

      const totalWeight = result.factors.reduce((sum, f) => sum + f.weight, 0);
      expect(totalWeight).toBeCloseTo(1.0, 5);
    });

    it('should handle zero payments gracefully', () => {
      const result = service.computeHealthScore({
        ...healthyInput,
        totalPayments: 0,
        failedPayments: 0,
      });

      const paymentFactor = result.factors.find((f) => f.name === 'Payment Reliability');
      expect(paymentFactor?.score).toBe(0);
      expect(paymentFactor?.status).toBe('critical');
    });

    it('should handle zero plan limit gracefully', () => {
      const result = service.computeHealthScore({
        ...healthyInput,
        planLimit: 0,
        currentUsage: 0,
      });

      const utilizationFactor = result.factors.find((f) => f.name === 'Plan Utilization');
      expect(utilizationFactor?.score).toBe(50);
    });

    it('should penalize long time since last login', () => {
      const recentLogin = service.computeHealthScore({
        ...healthyInput,
        daysSinceLastLogin: 1,
      });
      const longAgoLogin = service.computeHealthScore({
        ...healthyInput,
        daysSinceLastLogin: 45,
      });

      const recentEngagement = recentLogin.factors.find((f) => f.name === 'Usage Engagement');
      const longAgoEngagement = longAgoLogin.factors.find((f) => f.name === 'Usage Engagement');

      expect(longAgoEngagement?.score).toBeLessThan(recentEngagement?.score!);
    });

    it('should generate appropriate recommendations', () => {
      const healthyResult = service.computeHealthScore(healthyInput);
      const criticalResult = service.computeHealthScore(criticalInput);

      expect(healthyResult.recommendation).toContain('healthy');
      expect(criticalResult.recommendation.length).toBeGreaterThan(10);
    });
  });

  describe('computeBatch', () => {
    it('should compute scores for all inputs', () => {
      const inputs = [healthyInput, atRiskInput, criticalInput];
      const results = service.computeBatch(inputs);

      expect(results).toHaveLength(3);
      expect(results[0].subscriptionId).toBe('sub-001');
      expect(results[1].subscriptionId).toBe('sub-002');
      expect(results[2].subscriptionId).toBe('sub-003');
    });

    it('should handle empty input', () => {
      expect(service.computeBatch([])).toHaveLength(0);
    });
  });

  describe('generateSummary', () => {
    it('should generate correct summary statistics', () => {
      const results = service.computeBatch([healthyInput, atRiskInput, criticalInput]);
      const summary = service.generateSummary(results);

      expect(summary.totalSubscriptions).toBe(3);
      expect(summary.averageScore).toBeGreaterThan(0);
      expect(summary.healthyCount).toBeGreaterThanOrEqual(1);
      expect(summary.criticalCount).toBeGreaterThanOrEqual(1);
    });

    it('should populate grade and status distributions', () => {
      const results = service.computeBatch([healthyInput, atRiskInput, criticalInput]);
      const summary = service.generateSummary(results);

      expect(Object.keys(summary.gradeDistribution).length).toBeGreaterThan(0);
      expect(Object.keys(summary.statusDistribution).length).toBeGreaterThan(0);

      const totalGrades = Object.values(summary.gradeDistribution).reduce((a, b) => a + b, 0);
      expect(totalGrades).toBe(3);
    });

    it('should handle empty results', () => {
      const summary = service.generateSummary([]);

      expect(summary.totalSubscriptions).toBe(0);
      expect(summary.averageScore).toBe(0);
      expect(summary.healthyCount).toBe(0);
    });

    it('should count at-risk subscriptions correctly', () => {
      const results = service.computeBatch([healthyInput, atRiskInput]);
      const summary = service.generateSummary(results);

      expect(summary.atRiskCount).toBeGreaterThanOrEqual(1);
    });
  });
});
