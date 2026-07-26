/**
 * Module-level tests for analytics domain.
 * Validates error codes and DI container integration.
 */
import { Container } from '../../container';
import { AnalyticsError, AnalyticsErrorCode } from '../errors';

describe('Analytics Module', () => {
  // ── Error handling ──────────────────────────────────────────────────────────

  describe('AnalyticsError', () => {
    it('creates predictionFailed error', () => {
      const err = AnalyticsError.predictionFailed('0xabc', 'insufficient_history');
      expect(err.code).toBe(AnalyticsErrorCode.PREDICTION_FAILED);
      expect(err.details).toEqual({ subscriberAddress: '0xabc', reason: 'insufficient_history' });
    });

    it('creates insufficientData error', () => {
      const err = AnalyticsError.insufficientData('churn_rate');
      expect(err.code).toBe(AnalyticsErrorCode.INSUFFICIENT_DATA);
      expect(err.details).toEqual({ metric: 'churn_rate' });
    });

    it('creates oracleFetchFailed error', () => {
      const err = AnalyticsError.oracleFetchFailed('ETH', 'timeout');
      expect(err.code).toBe(AnalyticsErrorCode.ORACLE_FETCH_FAILED);
      expect(err.details).toEqual({ token: 'ETH', reason: 'timeout' });
    });

    it('all error codes are unique within the module', () => {
      const codes = Object.values(AnalyticsErrorCode);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  // ── DI Container bindings ───────────────────────────────────────────────────

  describe('DI Container', () => {
    let container: Container;

    beforeEach(() => {
      container = new Container();
    });

    it('resolves IPredictionService', () => {
      container.bind('IPredictionService', () => ({ predictChurn: jest.fn() }));
      expect(container.resolve('IPredictionService')).toBeDefined();
    });

    it('resolves IRecommendationService', () => {
      container.bind('IRecommendationService', () => ({ getRecommendations: jest.fn() }));
      expect(container.resolve('IRecommendationService')).toBeDefined();
    });

    it('resolves IComplianceReportService', () => {
      container.bind('IComplianceReportService', () => ({ generateComplianceReport: jest.fn() }));
      expect(container.resolve('IComplianceReportService')).toBeDefined();
    });

    it('resolves ICampaignService', () => {
      container.bind('ICampaignService', () => ({ createCampaign: jest.fn() }));
      expect(container.resolve('ICampaignService')).toBeDefined();
    });
  });
});
