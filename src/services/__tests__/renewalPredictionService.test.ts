import { RenewalPredictionService } from '../renewalPredictionService';
import { Subscription, BillingCycle, SubscriptionCategory } from '../../types/subscription';

describe('RenewalPredictionService', () => {
  let service: RenewalPredictionService;

  beforeEach(() => {
    service = new RenewalPredictionService();
  });

  const createSubscription = (overrides?: Partial<Subscription>): Subscription => ({
    id: 'sub_1',
    name: 'Test Subscription',
    category: SubscriptionCategory.SOFTWARE,
    price: 9.99,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
    isActive: true,
    isCryptoEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('assessChurnRisk', () => {
    it('should return low risk for active subscription with normal renewal', () => {
      const sub = createSubscription();
      const assessment = service.assessChurnRisk(sub);

      expect(assessment.subscriptionId).toBe('sub_1');
      expect(assessment.riskLevel).toBe('low');
      expect(assessment.predictedRenewal).toBe(true);
    });

    it('should return high risk for paused subscription', () => {
      const sub = createSubscription({ isPaused: true });
      const assessment = service.assessChurnRisk(sub);

      expect(assessment.riskLevel).toBe('high');
      expect(assessment.predictedRenewal).toBe(false);
      expect(assessment.reason).toContain('paused');
    });

    it('should return high risk when notifications disabled', () => {
      const sub = createSubscription({ notificationsEnabled: false });
      const assessment = service.assessChurnRisk(sub);

      expect(assessment.riskLevel).toBe('high');
      expect(assessment.reason).toContain('notifications disabled');
    });

    it('should return high risk for imminent renewal (< 7 days)', () => {
      const sub = createSubscription({
        nextBillingDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });
      const assessment = service.assessChurnRisk(sub);

      expect(assessment.riskLevel).toBe('high');
      expect(assessment.reason).toContain('renewal imminent');
    });

    it('should return low risk for far future renewal (> 30 days)', () => {
      const sub = createSubscription({
        nextBillingDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      });
      const assessment = service.assessChurnRisk(sub);

      expect(assessment.riskLevel).toBe('low');
    });

    it('should increase risk for inactive subscriptions (60+ days)', () => {
      const sub = createSubscription({
        updatedAt: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000),
      });
      const assessment = service.assessChurnRisk(sub);

      expect(assessment.riskScore).toBeGreaterThan(60);
      expect(assessment.reason).toContain('inactive for 60+ days');
    });
  });

  describe('batchAssessChurnRisk', () => {
    it('should assess multiple subscriptions', () => {
      const subs = [
        createSubscription({ id: 'sub_1', isPaused: false }),
        createSubscription({ id: 'sub_2', isPaused: true }),
        createSubscription({ id: 'sub_3', notificationsEnabled: false }),
      ];

      const assessments = service.batchAssessChurnRisk(subs);

      expect(assessments).toHaveLength(3);
      expect(assessments[1].riskLevel).toBe('high'); // paused
      expect(assessments[2].riskLevel).toBe('high'); // notifications disabled
    });
  });

  describe('getHighRiskSubscriptions', () => {
    it('should filter only high risk subscriptions', () => {
      const subs = [
        createSubscription({ id: 'sub_1', isPaused: false }),
        createSubscription({ id: 'sub_2', isPaused: true }),
        createSubscription({ id: 'sub_3', notificationsEnabled: false }),
      ];

      const highRisk = service.getHighRiskSubscriptions(subs);

      expect(highRisk).toHaveLength(2);
      expect(highRisk.map(s => s.id)).toContain('sub_2');
      expect(highRisk.map(s => s.id)).toContain('sub_3');
    });
  });

  describe('generateNotificationPayload', () => {
    it('should generate high priority notification for high risk', () => {
      const sub = createSubscription({ isPaused: true });
      const assessment = service.assessChurnRisk(sub);
      const payload = service.generateNotificationPayload(assessment);

      expect(payload.priority).toBe('high');
      expect(payload.title).toContain('Renew');
      expect(payload.body).toContain('paused');
    });

    it('should generate normal priority notification for low risk', () => {
      const sub = createSubscription();
      const assessment = service.assessChurnRisk(sub);
      const payload = service.generateNotificationPayload(assessment);

      expect(payload.priority).toBe('normal');
    });
  });
});
