import { TrialManagementService, WebhookPayload } from '../trialService';

describe('TrialManagementService', () => {
  let service: TrialManagementService;

  beforeEach(() => {
    service = new TrialManagementService('http://mock-webhook.local/events');
  });

  describe('checkTrialsEndingSoon', () => {
    it('should generate alerts for trials ending within the threshold', () => {
      const now = Date.now();
      const oneDayInMs = 24 * 60 * 60 * 1000;
      
      const subscriptions = [
        { id: 1, status: 'Trialing', nextChargeAt: (now + oneDayInMs) / 1000 }, // ending in 1 day
        { id: 2, status: 'Trialing', nextChargeAt: (now + 5 * oneDayInMs) / 1000 }, // ending in 5 days (too far)
        { id: 3, status: 'Active', nextChargeAt: (now + oneDayInMs) / 1000 }, // not a trial
      ];

      const alerts = service.checkTrialsEndingSoon(subscriptions, 3);
      
      expect(alerts).toHaveLength(1);
      expect(alerts[0].subscriptionId).toBe(1);
      expect(alerts[0].event).toBe('trial_ending_soon');
      expect(alerts[0].data.timeRemainingDays).toBe(2); // Math.ceil(timeRemaining / oneDayInMs) 
    });
  });

  describe('processExpiredTrials', () => {
    it('should return IDs of expired trials', () => {
      const now = Date.now();
      const oneDayInMs = 24 * 60 * 60 * 1000;
      
      const subscriptions = [
        { id: 1, status: 'Trialing', nextChargeAt: (now - oneDayInMs) / 1000 }, // expired 1 day ago
        { id: 2, status: 'Trialing', nextChargeAt: (now + oneDayInMs) / 1000 }, // still active
      ];

      const expiredIds = service.processExpiredTrials(subscriptions);
      
      expect(expiredIds).toHaveLength(1);
      expect(expiredIds[0]).toBe(1);
    });
  });

  describe('getTrialAnalytics', () => {
    it('should correctly calculate conversion rate', () => {
      const analytics = service.getTrialAnalytics(100, 25);
      
      expect(analytics.totalTrials).toBe(100);
      expect(analytics.convertedTrials).toBe(25);
      expect(analytics.conversionRate).toBe(0.25);
    });

    it('should handle zero historical trials', () => {
      const analytics = service.getTrialAnalytics(0, 0);
      
      expect(analytics.conversionRate).toBe(0);
    });
  });
});
