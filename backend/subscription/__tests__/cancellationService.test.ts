/**
 * Cancellation Service Tests
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1119
 */

import { CancellationService } from '../domain/cancellationService';

describe('CancellationService', () => {
  let service: CancellationService;

  beforeEach(() => {
    service = new CancellationService();
  });

  describe('initiate', () => {
    it('should create a pending cancellation for end_of_period mode', () => {
      const { cancellation, retentionOffer } = service.initiate({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        mode: 'end_of_period',
        reason: 'too_expensive',
        nextBillingDate: '2026-10-01',
      });

      expect(cancellation.status).toBe('pending');
      expect(cancellation.mode).toBe('end_of_period');
      expect(cancellation.subscriptionId).toBe('sub_001');
      expect(retentionOffer).not.toBeNull();
      expect(retentionOffer!.type).toBe('discount');
      expect(retentionOffer!.discountPercent).toBe(20);
      expect(cancellation.retentionOfferId).toBe(retentionOffer!.id);
    });

    it('should create an active cancellation for immediate mode', () => {
      const { cancellation } = service.initiate({
        subscriptionId: 'sub_002',
        userId: 'user_002',
        mode: 'immediate',
      });

      expect(cancellation.status).toBe('active');
    });

    it('should throw if an active cancellation already exists', () => {
      service.initiate({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        mode: 'end_of_period',
      });

      expect(() =>
        service.initiate({
          subscriptionId: 'sub_001',
          userId: 'user_001',
          mode: 'end_of_period',
        }),
      ).toThrow('already has an active cancellation');
    });

    it('should generate retention offer for known reasons', () => {
      const cases: Array<{ reason: string; expectedType: string }> = [
        { reason: 'too_expensive', expectedType: 'discount' },
        { reason: 'not_using', expectedType: 'pause' },
        { reason: 'missing_features', expectedType: 'feature_unlock' },
        { reason: 'found_alternative', expectedType: 'plan_downgrade' },
      ];

      for (const { reason, expectedType } of cases) {
        const svc = new CancellationService();
        const { retentionOffer } = svc.initiate({
          subscriptionId: 'sub_test',
          userId: 'user_test',
          mode: 'end_of_period',
          reason: reason as any,
        });
        expect(retentionOffer).not.toBeNull();
        expect(retentionOffer!.type).toBe(expectedType);
      }
    });

    it('should return null retention offer for "other" reason', () => {
      const { retentionOffer } = service.initiate({
        subscriptionId: 'sub_003',
        userId: 'user_003',
        mode: 'end_of_period',
        reason: 'other',
      });
      expect(retentionOffer).toBeNull();
    });
  });

  describe('acceptOffer', () => {
    it('should accept an offer and revert the cancellation', () => {
      const { cancellation, retentionOffer } = service.initiate({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        mode: 'end_of_period',
        reason: 'too_expensive',
      });

      const result = service.acceptOffer(retentionOffer!.id);

      expect(result.offer.status).toBe('accepted');
      expect(result.offer.acceptedAt).toBeDefined();
      expect(result.cancellation).not.toBeNull();
      expect(result.cancellation!.status).toBe('reverted');
    });

    it('should throw for unknown offer', () => {
      expect(() => service.acceptOffer('nonexistent')).toThrow('not found');
    });

    it('should throw for already accepted offer', () => {
      const { retentionOffer } = service.initiate({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        mode: 'end_of_period',
        reason: 'too_expensive',
      });
      service.acceptOffer(retentionOffer!.id);
      expect(() => service.acceptOffer(retentionOffer!.id)).toThrow('already accepted');
    });
  });

  describe('declineOffer', () => {
    it('should decline an offer', () => {
      const { retentionOffer } = service.initiate({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        mode: 'end_of_period',
        reason: 'too_expensive',
      });

      const offer = service.declineOffer(retentionOffer!.id);
      expect(offer.status).toBe('declined');
      expect(offer.declinedAt).toBeDefined();
    });
  });

  describe('submitFeedback', () => {
    it('should store feedback and link to cancellation', () => {
      const { cancellation } = service.initiate({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        mode: 'end_of_period',
        reason: 'too_expensive',
      });

      const feedback = service.submitFeedback({
        subscriptionId: 'sub_001',
        reason: 'too_expensive',
        comment: 'Too pricey for my needs',
        rating: 3,
      });

      expect(feedback.reason).toBe('too_expensive');
      expect(feedback.rating).toBe(3);

      const updated = service.getCancellation(cancellation.id);
      expect(updated!.feedbackId).toBe(feedback.id);
    });

    it('should reject invalid rating', () => {
      expect(() =>
        service.submitFeedback({
          subscriptionId: 'sub_001',
          reason: 'other',
          rating: 6,
        }),
      ).toThrow('Rating must be between 1 and 5');
    });
  });

  describe('revert', () => {
    it('should revert a pending cancellation directly', () => {
      const { cancellation } = service.initiate({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        mode: 'end_of_period',
      });

      const reverted = service.revert(cancellation.id);
      expect(reverted.status).toBe('reverted');
      expect(reverted.revertedAt).toBeDefined();
    });
  });

  describe('processExpirations', () => {
    it('should expire offers past their expiry and activate pending cancellations', () => {
      const { cancellation, retentionOffer } = service.initiate({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        mode: 'end_of_period',
        reason: 'too_expensive',
        nextBillingDate: new Date(Date.now() + 1000).toISOString(),
      });

      // Fast-forward past both offer expiry and cancellation effective date
      const future = Date.now() + 10 * 24 * 60 * 60 * 1000;
      const result = service.processExpirations(future);

      expect(result.expiredOffers).toHaveLength(1);
      expect(result.expiredOffers[0].id).toBe(retentionOffer!.id);
      expect(result.activatedCancellations).toHaveLength(1);
      expect(result.activatedCancellations[0].id).toBe(cancellation.id);
      expect(result.activatedCancellations[0].status).toBe('active');
    });
  });

  describe('getAnalytics', () => {
    it('should compute retention and offer analytics', () => {
      service.trackSubscriptionCreation('sub_001', Date.now() - 60 * 24 * 60 * 60 * 1000);
      service.initiate({
        subscriptionId: 'sub_001',
        userId: 'user_001',
        mode: 'end_of_period',
        reason: 'too_expensive',
      });

      service.trackSubscriptionCreation('sub_002', Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { retentionOffer } = service.initiate({
        subscriptionId: 'sub_002',
        userId: 'user_002',
        mode: 'end_of_period',
        reason: 'not_using',
      });
      service.acceptOffer(retentionOffer!.id);

      const analytics = service.getAnalytics();

      expect(analytics.totalCancellations).toBe(2);
      expect(analytics.revertedCancellations).toBe(1);
      expect(analytics.retentionRate).toBe(50);
      expect(analytics.offerAcceptanceRate).toBe(50);
      expect(analytics.byReason['too_expensive']).toBe(1);
      expect(analytics.byReason['not_using']).toBe(1);
      expect(analytics.averageTimeToCancel).toBeGreaterThan(0);
    });
  });
});
