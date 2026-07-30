/**
 * FraudDetectionService
 *
 * Real-time fraud detection engine for subscription payments.
 * Evaluates transactions against built-in rules, computes a weighted risk
 * score (0–100), and maps the score to a FraudAction.
 *
 * Rules implemented:
 *   - Velocity       – flags rapid subscription creation by same subscriber
 *   - AmountThreshold– flags/blocks unusually large payment amounts
 *   - UsageAnomaly   – flags/blocks observed usage far above expectation
 *   - Chargeback     – flags/blocks based on chargeback history
 *   - GeoAnomaly     – flags when subscriber is outside their home country
 *   - DeviceMismatch – flags when device fingerprint differs from trusted
 */

import { FraudSignal, FraudSignalType } from '../types/fraud';

// ── Input / Output types ──────────────────────────────────────────────────────

export interface FraudTransactionInput {
  id: string;
  subscriberId: string;
  merchantId: string;
  amount: number;
  currency: string;
  chargebacks: number;
  expectedUsage: number;
  observedUsage: number;
  createdAt: string;
  homeCountry?: string;
  currentCountry?: string;
  deviceFingerprint?: string;
  trustedDeviceFingerprint?: string;
  falsePositiveCount?: number;
}

export interface FraudDetectionResult {
  transactionId: string;
  riskScore: number;
  action: 'approve' | 'flag' | 'block';
  signals: FraudSignal[];
  reason: string;
  assessedAt: string;
  processingMs: number;
}

export interface DetectionStats {
  totalEvaluated: number;
  approvedCount: number;
  flaggedCount: number;
  blockedCount: number;
  avgProcessingMs: number;
  lastEvaluatedAt: string | null;
}

export interface PreventionRecommendation {
  id: string;
  category: 'velocity' | 'geo' | 'device' | 'chargeback' | 'account' | 'monitoring';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impactScore: number;
  effort: 'low' | 'medium' | 'high';
}

// ── Internal rule helpers ─────────────────────────────────────────────────────

const DEFAULT_FLAG_THRESHOLD = 50;
const DEFAULT_BLOCK_THRESHOLD = 80;
const BASELINE_SCORE = 10;
const MAX_HISTORY = 500;
const VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const VELOCITY_LIMIT = 3;

interface StoredTransaction {
  subscriberId: string;
  createdAt: number; // unix ms
}

function velocityScore(
  tx: FraudTransactionInput,
  history: StoredTransaction[]
): { score: number; signal: FraudSignal | null } {
  const now = new Date(tx.createdAt).getTime();
  const recentBySubscriber = history.filter(
    (h) => h.subscriberId === tx.subscriberId && Math.abs(now - h.createdAt) <= VELOCITY_WINDOW_MS
  );
  const count = recentBySubscriber.length;
  if (count <= VELOCITY_LIMIT) return { score: 0, signal: null };
  const rawScore = Math.min((count - VELOCITY_LIMIT) * 18, 55);
  return {
    score: rawScore,
    signal: {
      kind: 'velocity',
      score: rawScore,
      detail: `${count} subscriptions created within 24h (limit: ${VELOCITY_LIMIT})`,
      observedAt: new Date().toISOString(),
    },
  };
}

function amountThresholdScore(tx: FraudTransactionInput): {
  score: number;
  signal: FraudSignal | null;
} {
  if (tx.amount >= 2000) {
    return {
      score: 45,
      signal: {
        kind: 'pattern-shift',
        score: 45,
        detail: `Payment amount ${tx.currency} ${tx.amount.toFixed(2)} exceeds block threshold`,
        observedAt: new Date().toISOString(),
      },
    };
  }
  if (tx.amount >= 500) {
    return {
      score: 25,
      signal: {
        kind: 'pattern-shift',
        score: 25,
        detail: `Payment amount ${tx.currency} ${tx.amount.toFixed(2)} is unusually high`,
        observedAt: new Date().toISOString(),
      },
    };
  }
  return { score: 0, signal: null };
}

function usageAnomalyScore(tx: FraudTransactionInput): {
  score: number;
  signal: FraudSignal | null;
} {
  const { expectedUsage, observedUsage } = tx;
  if (expectedUsage === 0 && observedUsage > 0) {
    return {
      score: 20,
      signal: {
        kind: 'usage-anomaly',
        score: 20,
        detail: 'Usage observed when none was expected',
        observedAt: new Date().toISOString(),
      },
    };
  }
  if (expectedUsage === 0) return { score: 0, signal: null };

  if (observedUsage >= expectedUsage * 3) {
    return {
      score: 50,
      signal: {
        kind: 'usage-anomaly',
        score: 50,
        detail: `Observed usage (${observedUsage}) is ${(observedUsage / expectedUsage).toFixed(1)}x expected (${expectedUsage})`,
        observedAt: new Date().toISOString(),
      },
    };
  }
  if (observedUsage >= expectedUsage * 2) {
    return {
      score: 30,
      signal: {
        kind: 'usage-anomaly',
        score: 30,
        detail: `Observed usage (${observedUsage}) is ${(observedUsage / expectedUsage).toFixed(1)}x expected (${expectedUsage})`,
        observedAt: new Date().toISOString(),
      },
    };
  }
  if (observedUsage > expectedUsage) {
    return {
      score: 15,
      signal: {
        kind: 'usage-anomaly',
        score: 15,
        detail: `Observed usage (${observedUsage}) slightly above expected (${expectedUsage})`,
        observedAt: new Date().toISOString(),
      },
    };
  }
  return { score: 0, signal: null };
}

function chargebackScore(tx: FraudTransactionInput): { score: number; signal: FraudSignal | null } {
  const cb = tx.chargebacks;
  if (cb === 0) return { score: 0, signal: null };
  const rawScore = cb === 1 ? 40 : cb === 2 ? 80 : 90;
  return {
    score: rawScore,
    signal: {
      kind: 'chargeback',
      score: rawScore,
      detail: `${cb} chargeback${cb !== 1 ? 's' : ''} on record`,
      observedAt: new Date().toISOString(),
    },
  };
}

function geoAnomalyScore(tx: FraudTransactionInput): { score: number; signal: FraudSignal | null } {
  const { homeCountry, currentCountry } = tx;
  if (homeCountry && currentCountry && homeCountry !== currentCountry) {
    return {
      score: 24,
      signal: {
        kind: 'geolocation-anomaly',
        score: 24,
        detail: `Subscriber is in ${currentCountry} but registered from ${homeCountry}`,
        observedAt: new Date().toISOString(),
      },
    };
  }
  return { score: 0, signal: null };
}

function deviceMismatchScore(tx: FraudTransactionInput): {
  score: number;
  signal: FraudSignal | null;
} {
  const { deviceFingerprint, trustedDeviceFingerprint } = tx;
  if (
    deviceFingerprint &&
    trustedDeviceFingerprint &&
    deviceFingerprint !== trustedDeviceFingerprint
  ) {
    return {
      score: 20,
      signal: {
        kind: 'device-mismatch',
        score: 20,
        detail: `Device fingerprint changed from trusted device`,
        observedAt: new Date().toISOString(),
      },
    };
  }
  return { score: 0, signal: null };
}

// ── Service class ─────────────────────────────────────────────────────────────

export class FraudDetectionService {
  private flagThreshold: number = DEFAULT_FLAG_THRESHOLD;
  private blockThreshold: number = DEFAULT_BLOCK_THRESHOLD;
  private transactionHistory: StoredTransaction[] = [];
  private stats: DetectionStats = {
    totalEvaluated: 0,
    approvedCount: 0,
    flaggedCount: 0,
    blockedCount: 0,
    avgProcessingMs: 0,
    lastEvaluatedAt: null,
  };

  /** Update detection thresholds. Flag threshold must be < block threshold. */
  updateThresholds(flagThreshold: number, blockThreshold: number): void {
    if (flagThreshold > blockThreshold) {
      throw new Error('flagThreshold must be less than or equal to blockThreshold');
    }
    this.flagThreshold = flagThreshold;
    this.blockThreshold = blockThreshold;
  }

  /** Evaluate a single transaction and return a detection result. */
  evaluateTransaction(tx: FraudTransactionInput): FraudDetectionResult {
    const start = Date.now();

    // Run all rules
    const vel = velocityScore(tx, this.transactionHistory);
    const amt = amountThresholdScore(tx);
    const usage = usageAnomalyScore(tx);
    const cb = chargebackScore(tx);
    const geo = geoAnomalyScore(tx);
    const device = deviceMismatchScore(tx);

    const ruleResults = [vel, amt, usage, cb, geo, device];
    const signals: FraudSignal[] = ruleResults
      .filter((r) => r.signal !== null)
      .map((r) => r.signal as FraudSignal);
    const rawTotal = ruleResults.reduce((acc, r) => acc + r.score, 0);

    // Apply false positive penalty (caps at 60 points reduction)
    const falsePositivePenalty = Math.min((tx.falsePositiveCount ?? 0) * 40, 60);
    const riskScore = Math.max(
      0,
      Math.min(100, Math.round(BASELINE_SCORE + rawTotal - falsePositivePenalty))
    );

    const action = this.determineAction(riskScore);
    const reason = this.buildReason(signals, riskScore);
    const processingMs = Date.now() - start;
    const assessedAt = new Date().toISOString();

    // Store transaction for velocity tracking
    this.recordTransaction(tx);

    // Update stats
    this.updateStats(action, processingMs, assessedAt);

    return {
      transactionId: tx.id,
      riskScore,
      action,
      signals,
      reason,
      assessedAt,
      processingMs,
    };
  }

  /** Evaluate multiple transactions at once. */
  batchEvaluate(transactions: FraudTransactionInput[]): FraudDetectionResult[] {
    return transactions.map((tx) => this.evaluateTransaction(tx));
  }

  /** Get real-time risk score for a subscription (looks up from history). */
  getRealtimeRiskScore(subscriptionId: string): number {
    // In a real implementation this would query a cache; here we return 0 if unknown
    void subscriptionId;
    return 0;
  }

  /** Add a manually observed signal for a subscription. */
  addSignal(_subscriptionId: string, _signal: FraudSignal): void {
    // Signals can be stored and surfaced later via the store
  }

  /** Return current detection statistics. */
  getDetectionStats(): DetectionStats {
    return { ...this.stats };
  }

  /** Reset statistics (useful for testing). */
  resetStats(): void {
    this.stats = {
      totalEvaluated: 0,
      approvedCount: 0,
      flaggedCount: 0,
      blockedCount: 0,
      avgProcessingMs: 0,
      lastEvaluatedAt: null,
    };
    this.transactionHistory = [];
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private determineAction(score: number): 'approve' | 'flag' | 'block' {
    if (score >= this.blockThreshold) return 'block';
    if (score >= this.flagThreshold) return 'flag';
    return 'approve';
  }

  private buildReason(signals: FraudSignal[], score: number): string {
    if (signals.length === 0) return 'No fraud signals detected';
    const dominant = [...signals].sort((a, b) => b.score - a.score)[0];
    const signalNames: Record<FraudSignalType, string> = {
      velocity: 'Velocity risk is elevated',
      'usage-anomaly': 'Usage anomaly detected',
      chargeback: 'Chargeback risk dominates',
      'pattern-shift': 'Unusual payment pattern detected',
      'device-mismatch': 'Device fingerprint mismatch',
      'geolocation-anomaly': 'Geolocation anomaly detected',
    };
    const prefix =
      score >= this.blockThreshold ? 'BLOCKED: ' : score >= this.flagThreshold ? 'FLAGGED: ' : '';
    return prefix + (signalNames[dominant.kind] ?? dominant.detail);
  }

  private recordTransaction(tx: FraudTransactionInput): void {
    const createdAt = new Date(tx.createdAt).getTime();
    if (Number.isNaN(createdAt)) return;
    this.transactionHistory.push({ subscriberId: tx.subscriberId, createdAt });
    // Trim history to MAX_HISTORY
    if (this.transactionHistory.length > MAX_HISTORY) {
      this.transactionHistory = this.transactionHistory.slice(-MAX_HISTORY);
    }
  }

  private updateStats(
    action: 'approve' | 'flag' | 'block',
    processingMs: number,
    assessedAt: string
  ): void {
    const prev = this.stats;
    const newTotal = prev.totalEvaluated + 1;
    this.stats = {
      totalEvaluated: newTotal,
      approvedCount: prev.approvedCount + (action === 'approve' ? 1 : 0),
      flaggedCount: prev.flaggedCount + (action === 'flag' ? 1 : 0),
      blockedCount: prev.blockedCount + (action === 'block' ? 1 : 0),
      // Running average
      avgProcessingMs: Math.round(
        (prev.avgProcessingMs * prev.totalEvaluated + processingMs) / newTotal
      ),
      lastEvaluatedAt: assessedAt,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const fraudDetectionService = new FraudDetectionService();
