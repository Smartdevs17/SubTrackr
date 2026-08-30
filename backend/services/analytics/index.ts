// ── Churn prediction + intervention automation (ML-powered) ──────────────────
export { PredictionService as MlPredictionService } from './prediction';
export type {
  UserChurnData as MlUserChurnData,
  ChurnPrediction as MlChurnPrediction,
  RiskFactor as MlRiskFactor,
  RevenueObservation as MlRevenueObservation,
  ForecastPoint as MlForecastPoint,
  BatchPredictionItem,
  BatchPredictionResult,
  InterventionRecommendation,
  InterventionEvaluationResult,
  MlServiceHealth,
} from './prediction';
export {
  InterventionService,
  LogDispatcher,
  CompositeDispatcher,
  legacyRunAutomatedInterventions,
} from './interventionService';
export type {
  InterventionType,
  InterventionStatus,
  InterventionRecord,
  RunInterventionsOptions,
  RunInterventionsResult,
  InterventionDispatcher,
} from './interventionService';

// ── Existing exports ──────────────────────────────────────────────────────────
export { CampaignService } from './campaignService';
export type { Campaign, CouponCode, PromotionRule, CampaignTargeting, StackingConfig, CampaignAnalytics, CampaignOverlap, CouponValidation } from './campaignService';
export { generateComplianceReport, formatComplianceReport } from './complianceReport';
export type { ComplianceReport, EncryptionStatus, KeyManagementStatus, PiiAccessSummary, DataMaskingStatus } from './complianceReport';
export { DataPipelineService } from './dataPipeline';
export { DataWarehouseService } from './dataWarehouse';
export { PredictionService } from './predictionService';
export type { ChurnPrediction, RiskFactor, UserChurnData, ForecastPoint, RevenueObservation } from './predictionService';
export { RecommendationService } from './recommendationService';
export type { Recommendation, RecommendationContext } from './recommendationService';
export { RetentionService } from './retentionService';
export { OracleMonitorService, oracleMonitorService } from './oracleMonitorService';
export type { IPredictionService, IRecommendationService, IComplianceReportService, ICampaignService } from './interfaces';
export { AnalyticsError, AnalyticsErrorCode } from './errors';
export { CohortService } from './cohortService';
export { getChurnRiskForCohort } from './cohortChurnRiskService';
export { RetentionCalculator, RETENTION_CURVE_DAYS } from './retentionCalculator';
export { cohortTableToCsv, ltvBreakdownToCsv, cohortTableToPdf, churnBreakdownToPdf, buildSimplePdf } from './cohortReportExport';
export { SubscriberRecordRepository, subscriberRecordRepository } from './subscriberRecordRepository';
export { AnalyticsDashboardApi, analyticsDashboardApi } from './analyticsDashboardApi';
export {
  analyzeTrend,
  calculateAccuracy,
  generateVisualizationData,
  generateRevenueForecast,
  generateForecastAlerts,
} from './revenueForecastService';
export type {
  RevenueDataPoint,
  ForecastPoint as RevenueForecastPoint,
  TrendAnalysis,
  ForecastAccuracy,
  RevenueForecastResult,
  ForecastVisualizationData,
  ForecastAlert,
  ForecastGranularity,
  TrendDirection,
  ForecastModel,
} from './revenueForecastService';
