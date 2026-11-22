import AsyncStorage from '@react-native-async-storage/async-storage';
import * as planService from '../planService';

jest.mock('@react-native-async-storage/async-storage');

describe('planService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  describe('Plan Management', () => {
    it('should get all plans', async () => {
      const plans = await planService.getAllPlans();

      expect(plans).toBeDefined();
      expect(plans.length).toBeGreaterThan(0);
      expect(plans[0]).toHaveProperty('id');
      expect(plans[0]).toHaveProperty('name');
      expect(plans[0]).toHaveProperty('price');
    });

    it('should filter plans by billing cycle', async () => {
      const monthlyPlans = await planService.getAllPlans('monthly');

      expect(monthlyPlans.every((p) => p.billingCycle === 'monthly')).toBe(true);
    });

    it('should get plan by id', async () => {
      const plans = await planService.getAllPlans();
      const firstPlan = plans[0];

      const plan = await planService.getPlanById(firstPlan.id);

      expect(plan).toBeDefined();
      expect(plan?.id).toBe(firstPlan.id);
    });

    it('should get plans by tier', async () => {
      const premiumPlans = await planService.getPlansByTier('premium');

      expect(premiumPlans.every((p) => p.tier === 'premium')).toBe(true);
    });
  });

  describe('Plan Comparison', () => {
    it('should compare multiple plans', async () => {
      const plans = await planService.getAllPlans();
      const planIds = plans.slice(0, 2).map((p) => p.id);

      const comparison = await planService.comparePlans(planIds);

      expect(comparison).toBeDefined();
      expect(comparison.plans).toHaveLength(2);
      expect(comparison.comparisonMatrix).toBeDefined();
      expect(comparison.recommendations).toBeDefined();
    });

    it('should throw error when comparing less than 2 plans', async () => {
      await expect(planService.comparePlans(['plan-1'])).rejects.toThrow(
        'At least 2 plans required for comparison'
      );
    });

    it('should generate recommendations', async () => {
      const plans = await planService.getAllPlans();
      const planIds = plans.map((p) => p.id);

      const comparison = await planService.comparePlans(planIds);

      expect(comparison.recommendations.length).toBeGreaterThan(0);
      expect(comparison.recommendations[0]).toHaveProperty('planId');
      expect(comparison.recommendations[0]).toHaveProperty('reason');
      expect(comparison.recommendations[0]).toHaveProperty('confidence');
    });

    it('should build comparison matrix with categories', async () => {
      const plans = await planService.getAllPlans();
      const planIds = plans.slice(0, 3).map((p) => p.id);

      const comparison = await planService.comparePlans(planIds);

      expect(comparison.comparisonMatrix.length).toBeGreaterThan(0);
      expect(comparison.comparisonMatrix[0]).toHaveProperty('category');
      expect(comparison.comparisonMatrix[0]).toHaveProperty('features');
    });
  });

  describe('Plan Switching', () => {
    it('should switch to a new plan', async () => {
      const plans = await planService.getAllPlans();
      const currentPlan = plans[0];
      const targetPlan = plans[1];

      const request = {
        currentPlanId: currentPlan.id,
        targetPlanId: targetPlan.id,
        userId: 'user-123',
        prorated: true,
      };

      const response = await planService.switchPlan(request);

      expect(response.success).toBe(true);
      expect(response.switchId).toBeDefined();
      expect(response.currentPlan.id).toBe(currentPlan.id);
      expect(response.newPlan.id).toBe(targetPlan.id);
      expect(response.message).toContain('Successfully switched');
    });

    it('should calculate proration when upgrading', async () => {
      const plans = await planService.getAllPlans();
      const basicPlan = plans.find((p) => p.tier === 'basic');
      const premiumPlan = plans.find((p) => p.tier === 'premium');

      if (!basicPlan || !premiumPlan) {
        throw new Error('Required plans not found');
      }

      const request = {
        currentPlanId: basicPlan.id,
        targetPlanId: premiumPlan.id,
        userId: 'user-123',
        prorated: true,
      };

      const response = await planService.switchPlan(request);

      expect(response.prorationCharge).toBeDefined();
      expect(response.prorationCharge).toBeGreaterThan(0);
    });

    it('should throw error when plan not found', async () => {
      const request = {
        currentPlanId: 'non-existent',
        targetPlanId: 'also-non-existent',
        userId: 'user-123',
        prorated: false,
      };

      await expect(planService.switchPlan(request)).rejects.toThrow('Plan not found');
    });
  });

  describe('Switch History', () => {
    it('should save switch history', async () => {
      const plans = await planService.getAllPlans();
      const request = {
        currentPlanId: plans[0].id,
        targetPlanId: plans[1].id,
        userId: 'user-123',
        prorated: false,
      };

      await planService.switchPlan(request);
      const history = await planService.getSwitchHistory('user-123');

      expect(history.length).toBeGreaterThan(0);
      expect(history[0].userId).toBe('user-123');
      expect(history[0].status).toBe('completed');
    });

    it('should filter history by user', async () => {
      const plans = await planService.getAllPlans();

      await planService.switchPlan({
        currentPlanId: plans[0].id,
        targetPlanId: plans[1].id,
        userId: 'user-123',
        prorated: false,
      });

      await planService.switchPlan({
        currentPlanId: plans[0].id,
        targetPlanId: plans[1].id,
        userId: 'user-456',
        prorated: false,
      });

      const userHistory = await planService.getSwitchHistory('user-123');

      expect(userHistory.every((h) => h.userId === 'user-123')).toBe(true);
    });
  });

  describe('Plan Analytics', () => {
    it('should calculate plan analytics', async () => {
      const analytics = await planService.getPlanAnalytics();

      expect(analytics).toBeDefined();
      expect(analytics.totalPlans).toBeGreaterThan(0);
      expect(analytics.activeSubscriptionsByPlan).toBeDefined();
      expect(analytics.revenueByPlan).toBeDefined();
      expect(analytics.switchesLastMonth).toBeGreaterThanOrEqual(0);
      expect(analytics.popularPlan).toBeDefined();
      expect(analytics.conversionRate).toBeGreaterThanOrEqual(0);
      expect(analytics.churnRate).toBeGreaterThanOrEqual(0);
    });

    it('should track revenue by plan', async () => {
      const analytics = await planService.getPlanAnalytics();
      const revenueKeys = Object.keys(analytics.revenueByPlan);

      expect(revenueKeys.length).toBeGreaterThan(0);
      revenueKeys.forEach((key) => {
        expect(analytics.revenueByPlan[key]).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
