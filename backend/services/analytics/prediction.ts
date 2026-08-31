/**
 * prediction.ts
 *
 * Production-ready TypeScript client for the SubTrackr ML Service.
 * Features:
 *   - Retry with exponential back-off (3 attempts, jittered)
 *   - Per-request timeout (configurable, default 10 s)
 *   - Simple in-process circuit breaker (open after 5 consecutive failures)
 *   - Health-check helper
 *   - Camel ↔ snake_case mapping between TS and Python
 *   - Full typing for all request / response shapes
 *   - Batch API that respects the 500-item limit of the ML service
 */

import { AnalyticsError, AnalyticsErrorCode } from './errors';

// ── Configuration ──────────────────────────────────────────────────────────────
const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';
const DEFAULT_TIMEOUT_MS = Number(process.env.ML_SERVICE_TIMEOUT_MS ?? 10_000);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 200;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 30_000;
const MAX_BATCH_SIZE = 500;

// ── Public Types ───────────────────────────────────────────────────────────────

export interface UserChurnData {
  recentPaymentFailures: number;
  baselineLoginsPerMonth: number;
  recentLogins: number;
  openSupportTickets: number;
  appCrashes?: number;
  priceSensitivityIndex: number;
}

export interface RiskFactor {
  factor: string;
  impact: number;
}

export interface ChurnPrediction {
  subscriber: string;
  churnProbability: number;
  riskLevel: 'High' | 'Medium' | 'Low';
  riskFactors: RiskFactor[];
  recommendedAction: string;
  modelVersion?: string;
  featureSetHash?: string;
  featureDriftDetected?: boolean;
  usingMlModel?: boolean;
  latencyMs?: number;
}

export interface RevenueObservation {
  period: string;
  revenue: number;
}

export interface ForecastPoint {
  period: string;
  expectedRevenue: number;
  lowerBound: number;
  upperBound: number;
}

export interface BatchPredictionItem {
  subscriberAddress: string;
  userData: UserChurnData;
}

export interface BatchPredictionResult {
  predictions: ChurnPrediction[];
  failedSubscribers: string[];
  modelVersion?: string;
}

export interface InterventionRecommendation {
  subscriber: string;
  churnProbability: number;
  riskLevel: 'High' | 'Medium' | 'Low';
  riskFactors: RiskFactor[];
  recommendedAction: string;
  interventionType: string;
  featureDriftDetected: boolean;
}

export interface InterventionEvaluationResult {
  modelVersion?: string;
  evaluated: number;
  skipped: number;
  interventionsRecommended: number;
  latencyMs?: number;
  interventions: InterventionRecommendation[];
}

export interface MlServiceHealth {
  status: 'ok' | 'degraded' | 'unavailable';
  modelVersion?: string;
  service?: string;
  responseTimeMs?: number;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Minimal promise-based timeout wrapper. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`ML service request timed out after ${ms} ms`)), ms),
    ),
  ]);
}

/** Jittered exponential back-off sleep. */
function retryDelay(attempt: number): Promise<void> {
  const jitter = Math.random() * RETRY_BASE_DELAY_MS;
  const delay = RETRY_BASE_DELAY_MS * 2 ** attempt + jitter;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/** Returns true for HTTP status codes worth retrying (5xx, 429). */
function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

// ── Circuit Breaker ────────────────────────────────────────────────────────────

class CircuitBreaker {
  private failures = 0;
  private openAt: number | null = null;

  isOpen(): boolean {
    if (this.openAt === null) return false;
    if (Date.now() - this.openAt >= CIRCUIT_RESET_MS) {
      // Half-open: allow one probe
      this.openAt = null;
      this.failures = 0;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openAt = null;
  }

  recordFailure(): void {
    this.failures++;
    if (this.failures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.openAt = Date.now();
    }
  }
}

const _breaker = new CircuitBreaker();

// ── Core fetch with retry + circuit breaker ───────────────────────────────────

async function mlFetch(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  if (_breaker.isOpen()) {
    throw new Error('ML service circuit breaker is open – requests temporarily blocked');
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await withTimeout(
        fetch(`${ML_SERVICE_URL}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        timeoutMs,
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const err = new Error(`ML service responded ${response.status}: ${detail}`);
        if (!isRetryable(response.status)) {
          _breaker.recordFailure();
          throw err;
        }
        lastError = err;
      } else {
        _breaker.recordSuccess();
        return response.json();
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      _breaker.recordFailure();
    }

    if (attempt < MAX_RETRIES - 1) {
      await retryDelay(attempt);
    }
  }

  throw lastError ?? new Error('ML service request failed after retries');
}

// ── camelCase ↔ snake_case helpers ────────────────────────────────────────────

function toSnakeUserData(d: UserChurnData): Record<string, number> {
  return {
    recent_payment_failures: d.recentPaymentFailures,
    baseline_logins_per_month: d.baselineLoginsPerMonth,
    recent_logins: d.recentLogins,
    open_support_tickets: d.openSupportTickets,
    app_crashes: d.appCrashes ?? 0,
    price_sensitivity_index: d.priceSensitivityIndex,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCamelPrediction(raw: any, modelVersion?: string): ChurnPrediction {
  return {
    subscriber: raw.subscriber,
    churnProbability: raw.churn_probability,
    riskLevel: raw.risk_level as 'High' | 'Medium' | 'Low',
    riskFactors: (raw.risk_factors ?? []).map((f: any) => ({
      factor: f.factor,
      impact: f.impact,
    })),
    recommendedAction: raw.recommended_action,
    modelVersion: raw.model_version ?? modelVersion,
    featureSetHash: raw.feature_set_hash,
    featureDriftDetected: raw.feature_drift?.drift_detected ?? false,
    usingMlModel: raw.using_ml_model,
    latencyMs: raw.latency_ms,
  };
}

// ── Public PredictionService class ────────────────────────────────────────────

export class PredictionService {
  // ── Single prediction ────────────────────────────────────────────────────────

  static async predictChurn(
    subscriberAddress: string,
    userData: UserChurnData,
  ): Promise<ChurnPrediction> {
    try {
      const raw = await mlFetch('/v1/churn/predict', {
        subscriber: subscriberAddress,
        user_data: toSnakeUserData(userData),
      }) as any;

      return toCamelPrediction(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new AnalyticsError(
        AnalyticsErrorCode.PREDICTION_FAILED,
        `Churn prediction failed for ${subscriberAddress}: ${reason}`,
        { subscriberAddress, reason },
      );
    }
  }

  // ── Batch prediction (auto-chunks at MAX_BATCH_SIZE) ─────────────────────────

  static async predictChurnBatch(
    items: BatchPredictionItem[],
  ): Promise<BatchPredictionResult> {
    if (items.length === 0) {
      return { predictions: [], failedSubscribers: [], modelVersion: undefined };
    }

    const predictions: ChurnPrediction[] = [];
    const failedSubscribers: string[] = [];
    let modelVersion: string | undefined;

    // Process in chunks to stay within the ML service's 500-item limit
    for (let offset = 0; offset < items.length; offset += MAX_BATCH_SIZE) {
      const chunk = items.slice(offset, offset + MAX_BATCH_SIZE);

      try {
        const raw = await mlFetch('/v1/churn/predict/batch', {
          items: chunk.map((i) => ({
            subscriber: i.subscriberAddress,
            user_data: toSnakeUserData(i.userData),
          })),
        }) as any;

        modelVersion = raw.model_version ?? modelVersion;

        for (const result of raw.results ?? []) {
          if (result.ok) {
            predictions.push(toCamelPrediction(result, modelVersion));
          } else {
            failedSubscribers.push(result.subscriber);
          }
        }
      } catch (err) {
        // Mark all chunk members as failed
        chunk.forEach((i) => failedSubscribers.push(i.subscriberAddress));
      }
    }

    return { predictions, failedSubscribers, modelVersion };
  }

  // ── Revenue forecast ─────────────────────────────────────────────────────────

  static async forecastRevenue(
    observations: RevenueObservation[],
    horizon = 3,
  ): Promise<ForecastPoint[]> {
    try {
      const raw = await mlFetch('/v1/churn/forecast', { observations, horizon }) as any;
      const points: ForecastPoint[] = (raw.forecast ?? raw).map((p: any) => ({
        period: p.period,
        expectedRevenue: p.expected_revenue,
        lowerBound: p.lower_bound,
        upperBound: p.upper_bound,
      }));
      return points;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new AnalyticsError(
        AnalyticsErrorCode.PREDICTION_FAILED,
        `Revenue forecast failed: ${reason}`,
        { reason },
      );
    }
  }

  // ── Intervention evaluation ──────────────────────────────────────────────────

  static async evaluateInterventions(
    subscriberIds: string[],
    userDataMap: Map<string, UserChurnData>,
    options: { riskThreshold?: 'High' | 'Medium'; timeoutMs?: number } = {},
  ): Promise<InterventionEvaluationResult> {
    const { riskThreshold = 'High', timeoutMs = DEFAULT_TIMEOUT_MS } = options;

    // Convert Map to plain object for serialisation
    const userDataObj: Record<string, Record<string, number>> = {};
    for (const [id, data] of userDataMap.entries()) {
      userDataObj[id] = toSnakeUserData(data);
    }

    try {
      const raw = await mlFetch(
        '/v1/interventions/evaluate',
        {
          subscribers: subscriberIds,
          user_data_map: userDataObj,
          risk_threshold: riskThreshold,
        },
        timeoutMs,
      ) as any;

      return {
        modelVersion: raw.model_version,
        evaluated: raw.evaluated,
        skipped: raw.skipped,
        interventionsRecommended: raw.interventions_recommended,
        latencyMs: raw.latency_ms,
        interventions: (raw.interventions ?? []).map((i: any) => ({
          subscriber: i.subscriber,
          churnProbability: i.churn_probability,
          riskLevel: i.risk_level as 'High' | 'Medium' | 'Low',
          riskFactors: (i.risk_factors ?? []).map((f: any) => ({
            factor: f.factor,
            impact: f.impact,
          })),
          recommendedAction: i.recommended_action,
          interventionType: i.intervention_type,
          featureDriftDetected: i.feature_drift_detected ?? false,
        })),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new AnalyticsError(
        AnalyticsErrorCode.PREDICTION_FAILED,
        `Intervention evaluation failed: ${reason}`,
        { reason },
      );
    }
  }

  // ── Health check ─────────────────────────────────────────────────────────────

  static async checkHealth(timeoutMs = 5_000): Promise<MlServiceHealth> {
    const start = Date.now();
    try {
      const response = await withTimeout(
        fetch(`${ML_SERVICE_URL}/health`),
        timeoutMs,
      );
      const responseTimeMs = Date.now() - start;

      if (!response.ok) {
        return { status: 'degraded', responseTimeMs };
      }

      const body = (await response.json()) as any;
      return {
        status: body.status === 'ok' ? 'ok' : 'degraded',
        modelVersion: body.model_version,
        service: body.service,
        responseTimeMs,
      };
    } catch {
      return { status: 'unavailable', responseTimeMs: Date.now() - start };
    }
  }

  // ── Expose breaker state for observability ───────────────────────────────────

  static isCircuitOpen(): boolean {
    return _breaker.isOpen();
  }
}
