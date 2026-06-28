/**
 * Rate-limit anomaly detection gateway (#615).
 *
 * Behavioral anomaly scoring (Isolation Forest) + adaptive rate limiting that
 * catches distributed attacks which static per-IP / per-key limits miss.
 */

export { IsolationForest, makeRng, type FeatureVector } from "./isolationForest";
export {
  extractFeatures,
  toVector,
  FEATURE_ORDER,
  type RequestSample,
  type FeatureBreakdown,
} from "./featureExtraction";
export { AnomalyDetector, type AnomalyResult } from "./anomalyDetector";
export {
  decideLimit,
  isAllowlisted,
  severityFor,
  type AdaptiveConfig,
  type LimitDecision,
  type LimitAction,
  type Severity,
} from "./adaptiveRateLimit";
export { createAdaptiveRateLimitMiddleware } from "./middleware/adaptiveRateLimitMiddleware";
