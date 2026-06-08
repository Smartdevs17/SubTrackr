import { DomainError } from '../shared/errors';
import { ErrorCode } from '../shared/apiResponse';

/**
 * Analytics module error codes.
 * All codes follow pattern: ANALYTICS_[CATEGORY]_[SPECIFIC]
 */
export const AnalyticsErrorCode = {
  PREDICTION_FAILED: 'ANALYTICS_PREDICTION_FAILED' as ErrorCode,
  RECOMMENDATION_FAILED: 'ANALYTICS_RECOMMENDATION_FAILED' as ErrorCode,
  REPORT_GENERATION_FAILED: 'ANALYTICS_REPORT_GENERATION_FAILED' as ErrorCode,
  DATA_PIPELINE_FAILED: 'ANALYTICS_DATA_PIPELINE_FAILED' as ErrorCode,
  DATA_WAREHOUSE_FAILED: 'ANALYTICS_DATA_WAREHOUSE_FAILED' as ErrorCode,
  CAMPAIGN_CREATION_FAILED: 'ANALYTICS_CAMPAIGN_CREATION_FAILED' as ErrorCode,
  COUPON_VALIDATION_FAILED: 'ANALYTICS_COUPON_VALIDATION_FAILED' as ErrorCode,
  ORACLE_FETCH_FAILED: 'ANALYTICS_ORACLE_FETCH_FAILED' as ErrorCode,
  INSUFFICIENT_DATA: 'ANALYTICS_INSUFFICIENT_DATA' as ErrorCode,
  RETENTION_ANALYSIS_FAILED: 'ANALYTICS_RETENTION_ANALYSIS_FAILED' as ErrorCode,
} as const;

export class AnalyticsError extends DomainError {
  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(code, message, details);
  }

  static predictionFailed(subscriberAddress: string, reason: string): AnalyticsError {
    return new AnalyticsError(
      AnalyticsErrorCode.PREDICTION_FAILED,
      `Churn prediction failed for ${subscriberAddress}: ${reason}`,
      { subscriberAddress, reason }
    );
  }

  static insufficientData(metric: string): AnalyticsError {
    return new AnalyticsError(
      AnalyticsErrorCode.INSUFFICIENT_DATA,
      `Insufficient data to compute ${metric}`,
      { metric }
    );
  }

  static oracleFetchFailed(token: string, reason: string): AnalyticsError {
    return new AnalyticsError(
      AnalyticsErrorCode.ORACLE_FETCH_FAILED,
      `Oracle price fetch failed for ${token}: ${reason}`,
      { token, reason }
    );
  }
}
