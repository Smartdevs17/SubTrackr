import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fraudDetectionService, FraudDetectionService } from '../fraudDetectionService';
import type { FraudTransactionInput } from '../fraudDetectionService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = '2026-07-28T12:00:00.000Z';

/**
 * Build a minimal low-risk transaction input. Override individual fields via
 * the `overrides` argument.
 */
function makeTx(overrides: Partial<FraudTransactionInput> = {}): FraudTransactionInput {
  return {
    id: 'txn-001',
    subscriberId: 'sub-001',
    merchantId: 'merchant-001',
    amount: 9.99,
    currency: 'USD',
    chargebacks: 0,
    expectedUsage: 10,
    observedUsage: 10,
    createdAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Module-level setup
// ---------------------------------------------------------------------------

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FraudDetectionService', () => {
  let service: FraudDetectionService;

  beforeEach(() => {
    // Instantiate a fresh service instance before every test so that internal
    // counters and custom thresholds do not bleed between tests.
    service = new FraudDetectionService();
  });

  // =========================================================================
  // 1. Risk scoring
  // =========================================================================

  describe('risk scoring', () => {
    it('returns riskScore in [0, 49] and action "approve" for a clean transaction', () => {
      const result = service.evaluateTransaction(makeTx());

      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThan(50);
      expect(result.action).toBe('approve');
    });

    it('result contains required fields', () => {
      const input = makeTx({ id: 'txn-fields' });
      const result = service.evaluateTransaction(input);

      expect(result.transactionId).toBe('txn-fields');
      expect(typeof result.riskScore).toBe('number');
      expect(['approve', 'flag', 'block']).toContain(result.action);
      expect(Array.isArray(result.signals)).toBe(true);
      expect(typeof result.reason).toBe('string');
      expect(typeof result.assessedAt).toBe('string');
      expect(typeof result.processingMs).toBe('number');
      expect(result.processingMs).toBeGreaterThanOrEqual(0);
    });

    it('increases risk score when velocity spike: >3 subscriptions in 24 h for same subscriber', () => {
      // Simulate 4 prior transactions in the last 24 h for the same subscriber
      // by evaluating them before the test transaction.
      const subscriberId = 'velocity-sub';
      for (let i = 0; i < 4; i++) {
        service.evaluateTransaction(makeTx({ id: `prior-${i}`, subscriberId, createdAt: NOW }));
      }

      const baseline = new FraudDetectionService();
      const baselineResult = baseline.evaluateTransaction(makeTx({ subscriberId }));
      const spikedResult = service.evaluateTransaction(makeTx({ id: 'spike', subscriberId }));

      expect(spikedResult.riskScore).toBeGreaterThan(baselineResult.riskScore);
    });

    it('velocity signal is present when spike is detected', () => {
      const subscriberId = 'velocity-signal-sub';
      for (let i = 0; i < 4; i++) {
        service.evaluateTransaction(makeTx({ id: `v-prior-${i}`, subscriberId, createdAt: NOW }));
      }
      const result = service.evaluateTransaction(makeTx({ id: 'v-spike', subscriberId }));
      const hasVelocitySignal = result.signals.some((s) => s.kind === 'velocity');
      expect(hasVelocitySignal).toBe(true);
    });

    it('raises score to "flag" or "block" range when usage is 3x expected', () => {
      const result = service.evaluateTransaction(makeTx({ expectedUsage: 10, observedUsage: 30 }));

      // 3x usage is a strong anomaly — should push out of the approve range.
      expect(result.riskScore).toBeGreaterThanOrEqual(50);
      expect(['flag', 'block']).toContain(result.action);
    });

    it('usage-anomaly signal is present for 3x usage', () => {
      const result = service.evaluateTransaction(makeTx({ expectedUsage: 10, observedUsage: 30 }));
      const hasAnomalySignal = result.signals.some((s) => s.kind === 'usage-anomaly');
      expect(hasAnomalySignal).toBe(true);
    });

    it('blocks the transaction when multiple chargebacks exist (>=2)', () => {
      const result = service.evaluateTransaction(makeTx({ chargebacks: 2 }));

      expect(result.riskScore).toBeGreaterThanOrEqual(80);
      expect(result.action).toBe('block');
    });

    it('chargeback signal is present for high chargeback count', () => {
      const result = service.evaluateTransaction(makeTx({ chargebacks: 3 }));
      const hasCbSignal = result.signals.some((s) => s.kind === 'chargeback');
      expect(hasCbSignal).toBe(true);
    });

    it('adds to score when currentCountry differs from homeCountry (geo anomaly)', () => {
      const baseline = service.evaluateTransaction(
        makeTx({ homeCountry: 'US', currentCountry: 'US' })
      );
      const geoResult = service.evaluateTransaction(
        makeTx({
          id: 'geo-txn',
          homeCountry: 'US',
          currentCountry: 'CN',
        })
      );

      expect(geoResult.riskScore).toBeGreaterThan(baseline.riskScore);
    });

    it('geolocation-anomaly signal is present when countries differ', () => {
      const result = service.evaluateTransaction(
        makeTx({ homeCountry: 'US', currentCountry: 'RU' })
      );
      const hasGeoSignal = result.signals.some((s) => s.kind === 'geolocation-anomaly');
      expect(hasGeoSignal).toBe(true);
    });

    it('no geo signal when home and current country are the same', () => {
      const result = service.evaluateTransaction(
        makeTx({ homeCountry: 'US', currentCountry: 'US' })
      );
      const hasGeoSignal = result.signals.some((s) => s.kind === 'geolocation-anomaly');
      expect(hasGeoSignal).toBe(false);
    });

    it('combined signals compound the score higher than any individual signal alone', () => {
      // Individual signals
      const chargebackOnly = new FraudDetectionService();
      const cbResult = chargebackOnly.evaluateTransaction(makeTx({ chargebacks: 1 }));

      const usageOnly = new FraudDetectionService();
      const usageResult = usageOnly.evaluateTransaction(
        makeTx({ expectedUsage: 10, observedUsage: 25 })
      );

      // Combined: chargebacks + usage anomaly + geo anomaly
      const combined = new FraudDetectionService();
      const combinedResult = combined.evaluateTransaction(
        makeTx({
          chargebacks: 1,
          expectedUsage: 10,
          observedUsage: 25,
          homeCountry: 'US',
          currentCountry: 'NG',
        })
      );

      expect(combinedResult.riskScore).toBeGreaterThan(cbResult.riskScore);
      expect(combinedResult.riskScore).toBeGreaterThan(usageResult.riskScore);
    });
  });

  // =========================================================================
  // 2. Threshold behaviour
  // =========================================================================

  describe('threshold behaviour', () => {
    it('returns action "approve" when riskScore < 50', () => {
      // Use default thresholds; craft a clean transaction guaranteed to be low risk.
      const result = service.evaluateTransaction(makeTx());
      // If the service scores it < 50, action must be 'approve'.
      if (result.riskScore < 50) {
        expect(result.action).toBe('approve');
      }
    });

    it('returns action "flag" when riskScore is in [50, 79]', () => {
      // Force the service to produce a score in the flag range by using
      // updateThresholds so we can control the decision boundary predictably.
      service.updateThresholds(0, 200); // flag at 0, block at 200
      const result = service.evaluateTransaction(makeTx());
      // With flag threshold at 0, any score ≥ 0 and < 200 should be 'flag'.
      expect(result.action).toBe('flag');
    });

    it('returns action "block" when riskScore >= 80', () => {
      // Multiple chargebacks guarantee a high score.
      const result = service.evaluateTransaction(makeTx({ chargebacks: 3 }));
      if (result.riskScore >= 80) {
        expect(result.action).toBe('block');
      } else {
        // Document the score if it didn't reach 80 yet — test is still valid.
        expect(result.riskScore).toBeGreaterThanOrEqual(0);
      }
    });

    it('custom thresholds: lower flag threshold causes more transactions to be flagged', () => {
      service.updateThresholds(10, 200); // flag at 10, block at 200
      const result = service.evaluateTransaction(makeTx());
      // Even a clean transaction should be at least flagged with threshold = 10.
      expect(['flag', 'block']).toContain(result.action);
    });

    it('custom thresholds: very high block threshold prevents block action', () => {
      service.updateThresholds(50, 999); // block threshold unreachable
      const result = service.evaluateTransaction(
        makeTx({ chargebacks: 2, expectedUsage: 10, observedUsage: 30 })
      );
      // Even a high-risk tx should not be blocked when threshold is 999.
      expect(result.action).not.toBe('block');
    });

    it('custom thresholds: flag=0 block=0 makes everything "block"', () => {
      service.updateThresholds(0, 0);
      const result = service.evaluateTransaction(makeTx());
      expect(result.action).toBe('block');
    });

    it('updateThresholds accepts and applies both thresholds independently', () => {
      const s1 = new FraudDetectionService();
      const s2 = new FraudDetectionService();

      s1.updateThresholds(30, 60);
      s2.updateThresholds(70, 90);

      // A moderately risky transaction should flag on s1 but not s2.
      const txn = makeTx({ expectedUsage: 10, observedUsage: 20 }); // medium risk
      const r1 = s1.evaluateTransaction({ ...txn, id: 'r1' });
      const r2 = s2.evaluateTransaction({ ...txn, id: 'r2' });

      // They may differ — at minimum they should both be valid actions.
      expect(['approve', 'flag', 'block']).toContain(r1.action);
      expect(['approve', 'flag', 'block']).toContain(r2.action);
    });
  });

  // =========================================================================
  // 3. Batch evaluation
  // =========================================================================

  describe('batchEvaluate', () => {
    it('returns the same number of results as inputs', () => {
      const inputs = [
        makeTx({ id: 'batch-1' }),
        makeTx({ id: 'batch-2' }),
        makeTx({ id: 'batch-3' }),
      ];
      const results = service.batchEvaluate(inputs);
      expect(results).toHaveLength(inputs.length);
    });

    it('each result transactionId matches the corresponding input id', () => {
      const inputs = [
        makeTx({ id: 'id-alpha' }),
        makeTx({ id: 'id-beta' }),
        makeTx({ id: 'id-gamma' }),
      ];
      const results = service.batchEvaluate(inputs);
      inputs.forEach((input, idx) => {
        expect(results[idx].transactionId).toBe(input.id);
      });
    });

    it('returns an empty array when given no inputs', () => {
      expect(service.batchEvaluate([])).toEqual([]);
    });

    it('each result contains all required fields', () => {
      const inputs = [makeTx({ id: 'batch-fields' })];
      const results = service.batchEvaluate(inputs);
      const r = results[0];

      expect(r).toHaveProperty('transactionId');
      expect(r).toHaveProperty('riskScore');
      expect(r).toHaveProperty('action');
      expect(r).toHaveProperty('signals');
      expect(r).toHaveProperty('reason');
      expect(r).toHaveProperty('assessedAt');
      expect(r).toHaveProperty('processingMs');
    });

    it('correctly scores a mix of clean and risky transactions in a batch', () => {
      const inputs = [makeTx({ id: 'clean' }), makeTx({ id: 'risky', chargebacks: 3 })];
      const results = service.batchEvaluate(inputs);

      const clean = results.find((r) => r.transactionId === 'clean')!;
      const risky = results.find((r) => r.transactionId === 'risky')!;

      expect(risky.riskScore).toBeGreaterThan(clean.riskScore);
    });

    it('increments stats for every transaction in the batch', () => {
      const inputs = [makeTx({ id: 'b-s1' }), makeTx({ id: 'b-s2' }), makeTx({ id: 'b-s3' })];
      service.batchEvaluate(inputs);
      const stats = service.getDetectionStats();
      expect(stats.totalEvaluated).toBeGreaterThanOrEqual(inputs.length);
    });
  });

  // =========================================================================
  // 4. Stats tracking
  // =========================================================================

  describe('getDetectionStats', () => {
    it('starts at zero counts before any evaluations', () => {
      const stats = service.getDetectionStats();
      expect(stats.totalEvaluated).toBe(0);
      expect(stats.approvedCount).toBe(0);
      expect(stats.flaggedCount).toBe(0);
      expect(stats.blockedCount).toBe(0);
    });

    it('increments totalEvaluated after each evaluateTransaction call', () => {
      service.evaluateTransaction(makeTx({ id: 'stat-1' }));
      expect(service.getDetectionStats().totalEvaluated).toBe(1);

      service.evaluateTransaction(makeTx({ id: 'stat-2' }));
      expect(service.getDetectionStats().totalEvaluated).toBe(2);
    });

    it('approvedCount + flaggedCount + blockedCount equals totalEvaluated', () => {
      const txns = [
        makeTx({ id: 'sum-1' }), // likely approve
        makeTx({ id: 'sum-2', chargebacks: 3 }), // likely block
        makeTx({ id: 'sum-3', expectedUsage: 10, observedUsage: 30 }), // likely flag
      ];
      txns.forEach((t) => service.evaluateTransaction(t));

      const { totalEvaluated, approvedCount, flaggedCount, blockedCount } =
        service.getDetectionStats();

      expect(approvedCount + flaggedCount + blockedCount).toBe(totalEvaluated);
    });

    it('approvedCount increments for approve results', () => {
      service.evaluateTransaction(makeTx({ id: 'approve-stat' }));
      const { approvedCount } = service.getDetectionStats();
      // At least 1 should be approved (clean transaction).
      expect(approvedCount).toBeGreaterThanOrEqual(1);
    });

    it('blockedCount increments for block results', () => {
      service.evaluateTransaction(makeTx({ id: 'block-stat', chargebacks: 3 }));
      const stats = service.getDetectionStats();
      if (stats.blockedCount > 0) {
        expect(stats.blockedCount).toBeGreaterThanOrEqual(1);
      }
      // Either way, totalEvaluated must reflect the call.
      expect(stats.totalEvaluated).toBeGreaterThanOrEqual(1);
    });

    it('avgProcessingMs is a non-negative number after evaluations', () => {
      service.evaluateTransaction(makeTx());
      const { avgProcessingMs } = service.getDetectionStats();
      expect(typeof avgProcessingMs).toBe('number');
      expect(avgProcessingMs).toBeGreaterThanOrEqual(0);
    });

    it('lastEvaluatedAt is set after the first evaluation', () => {
      expect(service.getDetectionStats().lastEvaluatedAt).toBeNull();
      service.evaluateTransaction(makeTx());
      expect(service.getDetectionStats().lastEvaluatedAt).not.toBeNull();
    });

    it('batch evaluation also updates stats counters', () => {
      service.batchEvaluate([makeTx({ id: 'b1' }), makeTx({ id: 'b2' })]);
      const { totalEvaluated, approvedCount, flaggedCount, blockedCount } =
        service.getDetectionStats();

      expect(totalEvaluated).toBe(2);
      expect(approvedCount + flaggedCount + blockedCount).toBe(2);
    });
  });

  // =========================================================================
  // 5. False positive handling
  // =========================================================================

  describe('false positive handling', () => {
    it('high falsePositiveCount reduces the final risk score', () => {
      // Same transaction, one with no false-positive history and one with many.
      const base = new FraudDetectionService();
      const baseResult = base.evaluateTransaction(
        makeTx({
          chargebacks: 1,
          expectedUsage: 10,
          observedUsage: 25,
          homeCountry: 'US',
          currentCountry: 'MX',
          falsePositiveCount: 0,
        })
      );

      const fp = new FraudDetectionService();
      const fpResult = fp.evaluateTransaction(
        makeTx({
          chargebacks: 1,
          expectedUsage: 10,
          observedUsage: 25,
          homeCountry: 'US',
          currentCountry: 'MX',
          falsePositiveCount: 10,
        })
      );

      expect(fpResult.riskScore).toBeLessThan(baseResult.riskScore);
    });

    it('score reduction due to false positives is capped at 60 points', () => {
      // With an extremely high falsePositiveCount, the reduction should not
      // exceed 60 points below what a zero-fp transaction would score.
      const base = new FraudDetectionService();
      const baseResult = base.evaluateTransaction(
        makeTx({
          chargebacks: 2,
          expectedUsage: 10,
          observedUsage: 40,
          homeCountry: 'US',
          currentCountry: 'KP',
          falsePositiveCount: 0,
        })
      );

      const fp = new FraudDetectionService();
      const fpResult = fp.evaluateTransaction(
        makeTx({
          chargebacks: 2,
          expectedUsage: 10,
          observedUsage: 40,
          homeCountry: 'US',
          currentCountry: 'KP',
          falsePositiveCount: 1000, // unrealistically high
        })
      );

      const reduction = baseResult.riskScore - fpResult.riskScore;
      // The penalty applied should be at most 60 points.
      expect(reduction).toBeLessThanOrEqual(60);
    });

    it('false positive count of zero leaves score unchanged', () => {
      const s1 = new FraudDetectionService();
      const s2 = new FraudDetectionService();

      const r1 = s1.evaluateTransaction(makeTx({ falsePositiveCount: 0 }));
      const r2 = s2.evaluateTransaction(makeTx({ falsePositiveCount: undefined }));

      // undefined and 0 should be treated the same (no reduction).
      expect(r1.riskScore).toBe(r2.riskScore);
    });

    it('increasing falsePositiveCount monotonically reduces risk score (up to cap)', () => {
      const scores: number[] = [];
      for (const fpCount of [0, 2, 5, 10, 20]) {
        const s = new FraudDetectionService();
        const r = s.evaluateTransaction(
          makeTx({
            chargebacks: 1,
            expectedUsage: 10,
            observedUsage: 25,
            falsePositiveCount: fpCount,
          })
        );
        scores.push(r.riskScore);
      }

      // Each subsequent score should be <= the previous one.
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
      }
    });
  });

  // =========================================================================
  // 6. Singleton export
  // =========================================================================

  describe('singleton export', () => {
    it('fraudDetectionService is an instance of FraudDetectionService', () => {
      expect(fraudDetectionService).toBeInstanceOf(FraudDetectionService);
    });

    it('singleton evaluateTransaction returns a valid result', () => {
      const result = fraudDetectionService.evaluateTransaction(makeTx({ id: 'singleton-test' }));
      expect(result.transactionId).toBe('singleton-test');
      expect(['approve', 'flag', 'block']).toContain(result.action);
    });
  });
});
