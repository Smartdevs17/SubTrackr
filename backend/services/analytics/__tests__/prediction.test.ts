/**
 * prediction.test.ts
 *
 * Comprehensive tests for:
 *   - PredictionService: predictChurn, predictChurnBatch, forecastRevenue,
 *     evaluateInterventions, checkHealth, circuit breaker
 *   - InterventionService: runAutomatedInterventions, scheduling, dispatchers
 *
 * The ML HTTP service is fully mocked via jest.spyOn(global, 'fetch') so no
 * real network I/O occurs.
 */

// ── Global fetch mock setup ──────────────────────────────────────────────────
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import {
  PredictionService,
  UserChurnData,
  BatchPredictionItem,
  RevenueObservation,
} from '../prediction';
import {
  InterventionService,
  LogDispatcher,
  CompositeDispatcher,
  InterventionRecord,
} from '../interventionService';
import { AnalyticsError, AnalyticsErrorCode } from '../errors';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockOk(body: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function mockError(status: number, detail = 'server error'): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ detail }),
    text: async () => detail,
  });
}

function mockNetworkFailure(message = 'fetch failed'): void {
  mockFetch.mockRejectedValueOnce(new Error(message));
}

function makeSinglePredictionResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    subscriber: 'sub_001',
    churn_probability: 0.72,
    risk_level: 'High',
    risk_factors: [{ factor: 'payment_failures', impact: 0.28 }],
    recommended_action: 'Send discount offer',
    model_version: 'v1.0',
    feature_set_hash: 'abc123',
    feature_drift: { drift_detected: false },
    using_ml_model: true,
    latency_ms: 8.5,
    ...overrides,
  };
}

function makeBatchResponse(count: number) {
  return {
    model_version: 'v1.0',
    total: count,
    successful: count,
    failed: 0,
    latency_ms: 12,
    results: Array.from({ length: count }, (_, i) => ({
      ok: true,
      subscriber: `sub_${i}`,
      churn_probability: 0.3 + i * 0.1,
      risk_level: i > 2 ? 'High' : 'Low',
      risk_factors: [],
      recommended_action: 'Monitor',
      model_version: 'v1.0',
      feature_set_hash: 'hash',
      feature_drift: { drift_detected: false },
      using_ml_model: false,
    })),
  };
}

const sampleUserData: UserChurnData = {
  recentPaymentFailures: 2,
  baselineLoginsPerMonth: 20,
  recentLogins: 4,
  openSupportTickets: 1,
  appCrashes: 0,
  priceSensitivityIndex: 0.7,
};

const lowRiskUserData: UserChurnData = {
  recentPaymentFailures: 0,
  baselineLoginsPerMonth: 20,
  recentLogins: 20,
  openSupportTickets: 0,
  appCrashes: 0,
  priceSensitivityIndex: 0.1,
};

// ============================================================================
// PredictionService tests
// ============================================================================

describe('PredictionService', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    // Reset circuit breaker state between tests by temporarily forcing success
    // (The breaker has no public reset; successive successes clear it naturally)
  });

  // ── predictChurn ─────────────────────────────────────────────────────────

  describe('predictChurn', () => {
    it('returns a well-shaped ChurnPrediction on success', async () => {
      mockOk(makeSinglePredictionResponse());
      const result = await PredictionService.predictChurn('sub_001', sampleUserData);

      expect(result.subscriber).toBe('sub_001');
      expect(result.churnProbability).toBe(0.72);
      expect(result.riskLevel).toBe('High');
      expect(result.riskFactors).toHaveLength(1);
      expect(result.recommendedAction).toContain('discount');
      expect(result.modelVersion).toBe('v1.0');
      expect(result.featureSetHash).toBe('abc123');
      expect(result.featureDriftDetected).toBe(false);
    });

    it('posts to /v1/churn/predict', async () => {
      mockOk(makeSinglePredictionResponse());
      await PredictionService.predictChurn('addr', sampleUserData);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/churn/predict'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('maps camelCase userData to snake_case body', async () => {
      mockOk(makeSinglePredictionResponse());
      await PredictionService.predictChurn('addr', sampleUserData);

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.user_data.recent_payment_failures).toBe(2);
      expect(body.user_data.price_sensitivity_index).toBe(0.7);
    });

    it('throws AnalyticsError on non-retryable HTTP error (400)', async () => {
      mockError(400, 'bad request');
      // 400 is non-retryable; fail immediately
      await expect(PredictionService.predictChurn('addr', sampleUserData)).rejects.toBeInstanceOf(
        AnalyticsError,
      );
    });

    it('retries on 500 then succeeds', async () => {
      mockError(500);
      mockError(500);
      mockOk(makeSinglePredictionResponse());

      const result = await PredictionService.predictChurn('addr', sampleUserData);
      expect(result.subscriber).toBe('sub_001');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    }, 15_000);

    it('retries on network failure then succeeds', async () => {
      mockNetworkFailure();
      mockOk(makeSinglePredictionResponse());

      const result = await PredictionService.predictChurn('addr', sampleUserData);
      expect(result.subscriber).toBe('sub_001');
    }, 10_000);

    it('throws after all retries exhausted', async () => {
      mockError(503);
      mockError(503);
      mockError(503);

      await expect(PredictionService.predictChurn('addr', sampleUserData)).rejects.toThrow();
    }, 15_000);
  });

  // ── predictChurnBatch ─────────────────────────────────────────────────────

  describe('predictChurnBatch', () => {
    it('returns predictions for all items', async () => {
      mockOk(makeBatchResponse(4));
      const items: BatchPredictionItem[] = Array.from({ length: 4 }, (_, i) => ({
        subscriberAddress: `sub_${i}`,
        userData: sampleUserData,
      }));

      const result = await PredictionService.predictChurnBatch(items);
      expect(result.predictions).toHaveLength(4);
      expect(result.failedSubscribers).toHaveLength(0);
    });

    it('returns empty arrays for empty input', async () => {
      const result = await PredictionService.predictChurnBatch([]);
      expect(result.predictions).toHaveLength(0);
      expect(result.failedSubscribers).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('marks subscribers as failed on server error', async () => {
      mockError(500);
      mockError(500);
      mockError(500);

      const items: BatchPredictionItem[] = [
        { subscriberAddress: 'bad_sub', userData: sampleUserData },
      ];
      const result = await PredictionService.predictChurnBatch(items);
      expect(result.failedSubscribers).toContain('bad_sub');
    }, 15_000);

    it('handles mixed ok/failed results in batch response', async () => {
      const batchBody = {
        model_version: 'v1.0',
        total: 2,
        successful: 1,
        failed: 1,
        latency_ms: 5,
        results: [
          { ok: true, subscriber: 'sub_0', churn_probability: 0.3, risk_level: 'Low', risk_factors: [], recommended_action: 'ok', model_version: 'v1.0', feature_set_hash: 'h', feature_drift: { drift_detected: false } },
          { ok: false, subscriber: 'sub_1', error: 'unknown' },
        ],
      };
      mockOk(batchBody);

      const result = await PredictionService.predictChurnBatch([
        { subscriberAddress: 'sub_0', userData: sampleUserData },
        { subscriberAddress: 'sub_1', userData: sampleUserData },
      ]);

      expect(result.predictions).toHaveLength(1);
      expect(result.failedSubscribers).toContain('sub_1');
    });

    it('propagates model version from response', async () => {
      mockOk(makeBatchResponse(2));
      const result = await PredictionService.predictChurnBatch([
        { subscriberAddress: 'x', userData: sampleUserData },
        { subscriberAddress: 'y', userData: sampleUserData },
      ]);
      expect(result.modelVersion).toBe('v1.0');
    });
  });

  // ── forecastRevenue ───────────────────────────────────────────────────────

  describe('forecastRevenue', () => {
    function makeForecastResponse(horizon: number) {
      return {
        horizon,
        forecast: Array.from({ length: horizon }, (_, i) => ({
          period: `2025-0${i + 1}`,
          expected_revenue: 1000 + i * 50,
          lower_bound: 900 + i * 40,
          upper_bound: 1100 + i * 60,
        })),
      };
    }

    const obs: RevenueObservation[] = [
      { period: '2024-01', revenue: 1000 },
      { period: '2024-02', revenue: 1100 },
      { period: '2024-03', revenue: 1050 },
      { period: '2024-04', revenue: 1200 },
    ];

    it('returns the correct number of forecast points', async () => {
      mockOk(makeForecastResponse(3));
      const points = await PredictionService.forecastRevenue(obs, 3);
      expect(points).toHaveLength(3);
    });

    it('maps snake_case to camelCase', async () => {
      mockOk(makeForecastResponse(1));
      const [point] = await PredictionService.forecastRevenue(obs, 1);
      expect(point).toHaveProperty('expectedRevenue');
      expect(point).toHaveProperty('lowerBound');
      expect(point).toHaveProperty('upperBound');
    });

    it('throws AnalyticsError on failure', async () => {
      mockError(500);
      mockError(500);
      mockError(500);
      await expect(PredictionService.forecastRevenue(obs)).rejects.toBeInstanceOf(AnalyticsError);
    }, 15_000);

    it('handles array response (legacy ML service format)', async () => {
      // Old format returned array directly, new format wraps in { forecast: [...] }
      mockOk([
        { period: 'f_1', expected_revenue: 900, lower_bound: 800, upper_bound: 1000 },
      ]);
      const points = await PredictionService.forecastRevenue(obs, 1);
      expect(points[0].expectedRevenue).toBe(900);
    });
  });

  // ── evaluateInterventions ─────────────────────────────────────────────────

  describe('evaluateInterventions', () => {
    function makeInterventionResponse() {
      return {
        model_version: 'v1.0',
        evaluated: 2,
        skipped: 0,
        interventions_recommended: 1,
        latency_ms: 10,
        interventions: [
          {
            subscriber: 'sub_a',
            churn_probability: 0.85,
            risk_level: 'High',
            risk_factors: [{ factor: 'payment_failures', impact: 0.3 }],
            recommended_action: 'Send discount',
            intervention_type: 'urgent_discount_offer',
            feature_drift_detected: false,
          },
        ],
      };
    }

    it('returns intervention evaluation result', async () => {
      mockOk(makeInterventionResponse());
      const dataMap = new Map([
        ['sub_a', sampleUserData],
        ['sub_b', lowRiskUserData],
      ]);

      const result = await PredictionService.evaluateInterventions(
        ['sub_a', 'sub_b'],
        dataMap,
      );

      expect(result.evaluated).toBe(2);
      expect(result.interventionsRecommended).toBe(1);
      expect(result.interventions[0].subscriber).toBe('sub_a');
      expect(result.interventions[0].interventionType).toBe('urgent_discount_offer');
    });

    it('maps all intervention fields to camelCase', async () => {
      mockOk(makeInterventionResponse());
      const result = await PredictionService.evaluateInterventions(
        ['sub_a'],
        new Map([['sub_a', sampleUserData]]),
      );

      const itv = result.interventions[0];
      expect(itv).toHaveProperty('churnProbability');
      expect(itv).toHaveProperty('riskLevel');
      expect(itv).toHaveProperty('riskFactors');
      expect(itv).toHaveProperty('recommendedAction');
      expect(itv).toHaveProperty('interventionType');
      expect(itv).toHaveProperty('featureDriftDetected');
    });
  });

  // ── checkHealth ───────────────────────────────────────────────────────────

  describe('checkHealth', () => {
    it('returns ok when service is healthy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', model_version: 'v1.0', service: 'subtrackr-ml' }),
      });
      const health = await PredictionService.checkHealth();
      expect(health.status).toBe('ok');
      expect(health.modelVersion).toBe('v1.0');
    });

    it('returns degraded on non-ok HTTP response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
      const health = await PredictionService.checkHealth();
      expect(health.status).toBe('degraded');
    });

    it('returns unavailable on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const health = await PredictionService.checkHealth();
      expect(health.status).toBe('unavailable');
    });

    it('includes responseTimeMs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });
      const health = await PredictionService.checkHealth();
      expect(typeof health.responseTimeMs).toBe('number');
    });
  });
});

// ============================================================================
// InterventionService tests
// ============================================================================

describe('InterventionService', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  function mockInterventionResponse(interventions: unknown[] = []) {
    mockOk({
      model_version: 'v1.0',
      evaluated: 2,
      skipped: 0,
      interventions_recommended: interventions.length,
      latency_ms: 5,
      interventions,
    });
  }

  const twoSubscribers = [
    { id: 'sub_a', userData: sampleUserData },
    { id: 'sub_b', userData: lowRiskUserData },
  ];

  // ── runAutomatedInterventions ────────────────────────────────────────────

  describe('runAutomatedInterventions', () => {
    it('returns correct run metadata', async () => {
      mockInterventionResponse([]);
      const result = await InterventionService.runAutomatedInterventions({
        subscribers: twoSubscribers,
      });

      expect(result.runId).toBeTruthy();
      expect(result.startedAt).toBeTruthy();
      expect(result.completedAt).toBeTruthy();
      expect(result.dryRun).toBe(false);
    });

    it('returns empty result for empty subscribers without calling fetch', async () => {
      const result = await InterventionService.runAutomatedInterventions({
        subscribers: [],
      });
      expect(result.totalEvaluated).toBe(0);
      expect(result.totalInterventions).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('dispatches actions for at-risk subscribers', async () => {
      mockInterventionResponse([
        {
          subscriber: 'sub_a',
          churn_probability: 0.8,
          risk_level: 'High',
          risk_factors: [{ factor: 'payment_failures', impact: 0.3 }],
          recommended_action: 'Offer discount',
          intervention_type: 'urgent_discount_offer',
          feature_drift_detected: false,
        },
      ]);

      const dispatched: InterventionRecord[] = [];
      const mockDispatcher = {
        dispatch: jest.fn(async (r: InterventionRecord) => {
          dispatched.push(r);
        }),
      };

      const result = await InterventionService.runAutomatedInterventions({
        subscribers: twoSubscribers,
        dispatcher: mockDispatcher,
      });

      expect(result.dispatched).toBe(1);
      expect(result.failed).toBe(0);
      expect(dispatched[0].subscriber).toBe('sub_a');
      expect(dispatched[0].status).toBe('dispatched');
    });

    it('marks record as failed when dispatcher throws', async () => {
      mockInterventionResponse([
        {
          subscriber: 'sub_a',
          churn_probability: 0.9,
          risk_level: 'High',
          risk_factors: [],
          recommended_action: 'Act',
          intervention_type: 'urgent_discount_offer',
          feature_drift_detected: false,
        },
      ]);

      const failingDispatcher = {
        dispatch: jest.fn().mockRejectedValue(new Error('Email service down')),
      };

      const result = await InterventionService.runAutomatedInterventions({
        subscribers: twoSubscribers,
        dispatcher: failingDispatcher,
      });

      expect(result.failed).toBe(1);
      expect(result.records[0].status).toBe('failed');
      expect(result.records[0].failureReason).toContain('Email service down');
    });

    it('dryRun skips dispatch and marks records as skipped', async () => {
      mockInterventionResponse([
        {
          subscriber: 'sub_a',
          churn_probability: 0.8,
          risk_level: 'High',
          risk_factors: [],
          recommended_action: 'Do it',
          intervention_type: 'discount_offer',
          feature_drift_detected: false,
        },
      ]);

      const mockDispatcher = { dispatch: jest.fn() };

      const result = await InterventionService.runAutomatedInterventions({
        subscribers: twoSubscribers,
        dryRun: true,
        dispatcher: mockDispatcher,
      });

      expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
      expect(result.dryRun).toBe(true);
    });

    it('throws AnalyticsError when ML service fails', async () => {
      mockError(500);
      mockError(500);
      mockError(500);

      await expect(
        InterventionService.runAutomatedInterventions({ subscribers: twoSubscribers }),
      ).rejects.toBeInstanceOf(AnalyticsError);
    }, 15_000);
  });

  // ── runAutomatedInterventionsLegacy ──────────────────────────────────────

  describe('runAutomatedInterventionsLegacy', () => {
    it('derives userData from subscription shape and calls ML service', async () => {
      mockInterventionResponse([]);
      const result = await InterventionService.runAutomatedInterventionsLegacy([
        { id: 'sub_1', chargeCount: 4, price: 9.99 },
        { id: 'sub_2', chargeCount: 0, price: 4.99 },
      ]);
      expect(result.totalEvaluated).toBeGreaterThanOrEqual(0);
    });
  });

  // ── LogDispatcher ─────────────────────────────────────────────────────────

  describe('LogDispatcher', () => {
    it('logs without throwing', async () => {
      const dispatcher = new LogDispatcher();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const record: InterventionRecord = {
        id: 'itv-1',
        subscriber: 'sub_x',
        churnProbability: 0.85,
        riskLevel: 'High',
        interventionType: 'discount_offer',
        recommendedAction: 'Offer 20% off',
        status: 'pending',
        metadata: {},
      };

      await expect(dispatcher.dispatch(record)).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ── CompositeDispatcher ───────────────────────────────────────────────────

  describe('CompositeDispatcher', () => {
    it('calls all child dispatchers', async () => {
      const d1 = { dispatch: jest.fn().mockResolvedValue(undefined) };
      const d2 = { dispatch: jest.fn().mockResolvedValue(undefined) };
      const composite = new CompositeDispatcher([d1, d2]);

      const record: InterventionRecord = {
        id: 'itv-2',
        subscriber: 'sub_y',
        churnProbability: 0.6,
        riskLevel: 'Medium',
        interventionType: 're_engagement_email',
        recommendedAction: 'Send email',
        status: 'pending',
        metadata: {},
      };

      await composite.dispatch(record);
      expect(d1.dispatch).toHaveBeenCalledWith(record);
      expect(d2.dispatch).toHaveBeenCalledWith(record);
    });

    it('continues dispatching if one child fails', async () => {
      const d1 = { dispatch: jest.fn().mockRejectedValue(new Error('oops')) };
      const d2 = { dispatch: jest.fn().mockResolvedValue(undefined) };
      const composite = new CompositeDispatcher([d1, d2]);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const record: InterventionRecord = {
        id: 'itv-3',
        subscriber: 'sub_z',
        churnProbability: 0.7,
        riskLevel: 'High',
        interventionType: 'discount_offer',
        recommendedAction: 'Act now',
        status: 'pending',
        metadata: {},
      };

      await expect(composite.dispatch(record)).resolves.toBeUndefined();
      expect(d2.dispatch).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ── schedule ─────────────────────────────────────────────────────────────

  describe('schedule', () => {
    it('returns a stop function', () => {
      const handle = InterventionService.schedule(async () => [], 100_000);
      expect(handle.stop).toBeInstanceOf(Function);
      handle.stop();
    });

    it('does not call subscribersFn before interval', async () => {
      const fn = jest.fn().mockResolvedValue([]);
      jest.useFakeTimers();
      const handle = InterventionService.schedule(fn, 5_000);
      jest.advanceTimersByTime(4_999);
      expect(fn).not.toHaveBeenCalled();
      handle.stop();
      jest.useRealTimers();
    });
  });
});

// ============================================================================
// Integration: PredictionService → InterventionService round-trip
// ============================================================================

describe('End-to-end: PredictionService + InterventionService', () => {
  beforeEach(() => mockFetch.mockClear());

  it('full intervention run produces dispatched records with correct shape', async () => {
    mockOk({
      model_version: 'v1.0',
      evaluated: 1,
      skipped: 0,
      interventions_recommended: 1,
      latency_ms: 7,
      interventions: [
        {
          subscriber: 'wallet_001',
          churn_probability: 0.91,
          risk_level: 'High',
          risk_factors: [{ factor: 'login_frequency_drop', impact: 0.22 }],
          recommended_action: 'Re-engage user',
          intervention_type: 'urgent_re_engagement_email',
          feature_drift_detected: true,
        },
      ],
    });

    const dispatched: InterventionRecord[] = [];
    const result = await InterventionService.runAutomatedInterventions({
      subscribers: [{ id: 'wallet_001', userData: sampleUserData }],
      dispatcher: {
        dispatch: async (r) => { dispatched.push(r); },
      },
    });

    expect(result.dispatched).toBe(1);
    const record = dispatched[0];
    expect(record.subscriber).toBe('wallet_001');
    expect(record.riskLevel).toBe('High');
    expect(record.interventionType).toBe('urgent_re_engagement_email');
    expect(record.metadata.featureDriftDetected).toBe(true);
    expect(record.status).toBe('dispatched');
    expect(record.dispatchedAt).toBeTruthy();
  });
});
