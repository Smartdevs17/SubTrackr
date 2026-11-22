/**
 * FraudAnalyticsService
 *
 * Backend analytics layer for fraud detection.
 * Aggregates risk data, produces time-series trends, and generates
 * per-merchant reports with actionable prevention recommendations.
 *
 * In production this would query a database or data warehouse.
 * The implementation ships with deterministic in-memory data so it
 * is immediately usable in the dev / test environment.
 */

import {
  FraudCase,
  FraudReport,
  FraudSubscriptionRecord,
  FraudMerchantRecord,
} from '../../../src/types/fraud';

// ── Domain types ──────────────────────────────────────────────────────────────

export interface FraudSummary {
  totalChecks: number;
  approved: number;
  flagged: number;
  blocked: number;
  manualReviews: number;
  avgRiskScore: number;
  falsePositiveRate: number;
  modelConfidence: number;
  velocityAlerts: number;
  anomalyAlerts: number;
  chargebackPredictions: number;
  geoAnomalyAlerts: number;
  updatedAt: string;
}

export interface FraudTrendPoint {
  date: string; // ISO date string YYYY-MM-DD
  totalChecks: number;
  flagged: number;
  blocked: number;
  avgRiskScore: number;
}

export interface FraudSignalBreakdown {
  signalType: string;
  count: number;
  avgScore: number;
  percentage: number;
}

export interface PreventionRecommendation {
  id: string;
  category: 'velocity' | 'geo' | 'device' | 'chargeback' | 'account' | 'monitoring';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impactScore: number; // 0-100 expected risk reduction
  effort: 'low' | 'medium' | 'high';
}

// ── Seed / mock data helpers ──────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function buildTrend(days: number): FraudTrendPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const d = days - i;
    const base = 40 + Math.round(Math.sin(i / 3) * 10);
    return {
      date: daysAgo(d),
      totalChecks: base + Math.round(Math.random() * 20),
      flagged: Math.round(base * 0.15),
      blocked: Math.round(base * 0.05),
      avgRiskScore: 30 + Math.round(Math.random() * 20),
    };
  });
}

const ALL_RECOMMENDATIONS: PreventionRecommendation[] = [
  {
    id: 'rec_vel_001',
    category: 'velocity',
    severity: 'high',
    title: 'Implement rate limiting on subscription creation',
    description:
      'Limit each subscriber to at most 3 new subscriptions per 24-hour window. ' +
      'Subscribers exceeding this threshold should be placed in a review queue.',
    impactScore: 35,
    effort: 'low',
  },
  {
    id: 'rec_geo_001',
    category: 'geo',
    severity: 'medium',
    title: 'Enable geolocation verification for high-value plans',
    description:
      'Require additional verification (OTP, email confirmation) when a subscriber ' +
      'accesses a plan from a country that differs from their registration country.',
    impactScore: 25,
    effort: 'medium',
  },
  {
    id: 'rec_device_001',
    category: 'device',
    severity: 'medium',
    title: 'Bind trusted device fingerprints per subscriber',
    description:
      'Capture a trusted device fingerprint at registration and alert or block ' +
      'payment attempts from unrecognised devices until the subscriber confirms them.',
    impactScore: 20,
    effort: 'medium',
  },
  {
    id: 'rec_cb_001',
    category: 'chargeback',
    severity: 'critical',
    title: 'Auto-block subscribers with 2+ chargebacks',
    description:
      'Subscribers with two or more chargebacks in the last 90 days should be ' +
      'automatically blocked from new subscriptions and routed to manual review.',
    impactScore: 45,
    effort: 'low',
  },
  {
    id: 'rec_cb_002',
    category: 'chargeback',
    severity: 'high',
    title: 'Enforce pre-dispute response within 72 h',
    description:
      'When a chargeback is filed, automatically gather transaction evidence and ' +
      'submit a pre-dispute response to reduce chargeback acceptance.',
    impactScore: 30,
    effort: 'medium',
  },
  {
    id: 'rec_acct_001',
    category: 'account',
    severity: 'medium',
    title: 'Apply stricter rules to accounts younger than 7 days',
    description:
      'New accounts are disproportionately involved in fraud. Apply a temporary ' +
      'flag threshold of 35 (instead of 50) for accounts less than one week old.',
    impactScore: 28,
    effort: 'low',
  },
  {
    id: 'rec_mon_001',
    category: 'monitoring',
    severity: 'low',
    title: 'Enable model drift alerts',
    description:
      'Track false-positive and false-negative rates weekly. Alert the fraud team ' +
      'when the false-positive rate exceeds 20% so rule weights can be recalibrated.',
    impactScore: 15,
    effort: 'low',
  },
  {
    id: 'rec_vel_002',
    category: 'velocity',
    severity: 'high',
    title: 'Add cross-merchant velocity check',
    description:
      'A subscriber creating subscriptions across multiple merchants within a short ' +
      'window is a strong fraud signal. Implement a cross-merchant velocity rule.',
    impactScore: 32,
    effort: 'high',
  },
];

// ── Service ───────────────────────────────────────────────────────────────────

export class FraudAnalyticsService {
  /**
   * Return a high-level fraud summary.
   * Pass a merchantId to scope the summary to one merchant.
   */
  getFraudSummary(merchantId?: string): FraudSummary {
    void merchantId; // In production: filter by merchantId
    return {
      totalChecks: 257,
      approved: 201,
      flagged: 38,
      blocked: 18,
      manualReviews: 24,
      avgRiskScore: 34,
      falsePositiveRate: 12,
      modelConfidence: 88,
      velocityAlerts: 15,
      anomalyAlerts: 22,
      chargebackPredictions: 11,
      geoAnomalyAlerts: 8,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Return a time-series trend of fraud events.
   * @param days Number of days of history to return (default 30).
   */
  getFraudTrend(days = 30): FraudTrendPoint[] {
    return buildTrend(Math.max(1, Math.min(days, 90)));
  }

  /**
   * Return merchants ranked by average risk score, highest first.
   * @param limit Maximum number of merchants to return (default 10).
   */
  getTopRiskMerchants(limit = 10): FraudMerchantRecord[] {
    const merchants: FraudMerchantRecord[] = [
      {
        id: 'merch_cipher',
        name: 'Cipher Pro',
        status: 'high-risk',
        activeSubscriptions: 46,
        blockedSubscriptions: 9,
        averageRisk: 67,
        monthlyVolume: 7825,
        falsePositiveRate: 8,
      },
      {
        id: 'merch_nova',
        name: 'Nova Stream',
        status: 'watch',
        activeSubscriptions: 128,
        blockedSubscriptions: 4,
        averageRisk: 41,
        monthlyVolume: 18650,
        falsePositiveRate: 14,
      },
      {
        id: 'merch_orbit',
        name: 'Orbit Tools',
        status: 'healthy',
        activeSubscriptions: 83,
        blockedSubscriptions: 1,
        averageRisk: 22,
        monthlyVolume: 9420,
        falsePositiveRate: 5,
      },
    ];
    return merchants
      .sort((a, b) => b.averageRisk - a.averageRisk)
      .slice(0, limit);
  }

  /**
   * Return a breakdown of fraud signal types by frequency and average score.
   */
  getSignalBreakdown(): FraudSignalBreakdown[] {
    const signals = [
      { signalType: 'velocity', count: 47, avgScore: 28 },
      { signalType: 'usage-anomaly', count: 62, avgScore: 22 },
      { signalType: 'chargeback', count: 31, avgScore: 38 },
      { signalType: 'geolocation-anomaly', count: 24, avgScore: 24 },
      { signalType: 'device-mismatch', count: 18, avgScore: 20 },
      { signalType: 'pattern-shift', count: 15, avgScore: 26 },
    ];
    const total = signals.reduce((s, r) => s + r.count, 0);
    return signals.map((s) => ({
      ...s,
      percentage: total > 0 ? Math.round((s.count / total) * 100) : 0,
    }));
  }

  /**
   * Generate a comprehensive fraud report for a merchant.
   */
  generateFraudReport(merchantId: string): FraudReport {
    return {
      merchantId,
      merchantName: merchantId === 'merch_cipher' ? 'Cipher Pro' :
        merchantId === 'merch_nova' ? 'Nova Stream' : 'Orbit Tools',
      totalSubscriptions: 46,
      flaggedSubscriptions: 12,
      blockedSubscriptions: 9,
      manualReviewCount: 7,
      averageRisk: 67,
      velocityAlerts: 5,
      anomalyAlerts: 8,
      chargebackPredictions: 4,
      highRiskSubscribers: 6,
      geolocationAlerts: 3,
      pendingEvidenceCount: 4,
      falsePositiveFeedbackCount: 2,
      recentCases: [],
    };
  }

  /**
   * Return actionable prevention recommendations for a merchant.
   * Higher-severity recommendations are sorted first.
   */
  getPreventionRecommendations(merchantId?: string): PreventionRecommendation[] {
    void merchantId;
    const severityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return [...ALL_RECOMMENDATIONS].sort(
      (a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4)
    );
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const fraudAnalyticsService = new FraudAnalyticsService();
