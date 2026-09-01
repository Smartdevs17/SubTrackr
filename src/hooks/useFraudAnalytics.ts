/**
 * useFraudAnalytics
 *
 * React hook that aggregates live fraud analytics data from:
 *   - fraudDetectionService  (detection stats)
 *   - fraudAlertService      (active alerts and unread count)
 *   - fraudStore             (merchant records, assessments, analytics, review queue)
 *
 * Provides a single, stable object that components can destructure instead of
 * calling multiple services and stores directly.
 *
 * Polling interval: configurable, defaults to 30 s.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { fraudDetectionService, DetectionStats } from '../services/fraudDetectionService';
import { fraudAlertService, FraudAlert } from '../services/fraudAlertService';
import { useFraudStore } from '../store/fraudStore';
import type {
  FraudAnalytics,
  FraudMerchantRecord,
  FraudRiskScore,
  FraudCase,
} from '../types/fraud';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrendPoint {
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  totalChecks: number;
  flagged: number;
  blocked: number;
  avgRiskScore: number;
}

export interface SignalBreakdown {
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
  impactScore: number;
  effort: 'low' | 'medium' | 'high';
}

export interface FraudAnalyticsState {
  // ── Core analytics ────────────────────────────────────────────────────────
  analytics: FraudAnalytics;
  detectionStats: DetectionStats;

  // ── Time-series data ──────────────────────────────────────────────────────
  trend: TrendPoint[];

  // ── Signal breakdown ──────────────────────────────────────────────────────
  signals: SignalBreakdown[];

  // ── Merchant data ─────────────────────────────────────────────────────────
  merchants: FraudMerchantRecord[];
  topRiskMerchants: FraudMerchantRecord[];

  // ── Assessments + cases ───────────────────────────────────────────────────
  assessments: FraudRiskScore[];
  reviewQueue: FraudCase[];

  // ── Alerts ────────────────────────────────────────────────────────────────
  alerts: FraudAlert[];
  unreadAlertCount: number;
  criticalAlertCount: number;

  // ── Prevention recommendations ────────────────────────────────────────────
  recommendations: PreventionRecommendation[];

  // ── Loading / error state ─────────────────────────────────────────────────
  isLoading: boolean;
  lastRefreshedAt: string | null;
  error: string | null;

  // ── Actions ───────────────────────────────────────────────────────────────
  refresh: () => void;
  markAlertRead: (alertId: string) => void;
  markAllAlertsRead: () => void;
  dismissAlert: (alertId: string) => void;
}

// ── Static recommendations data ───────────────────────────────────────────────

const RECOMMENDATIONS: PreventionRecommendation[] = [
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
    title: 'Apply stricter rules to new accounts (<7 days)',
    description:
      'New accounts are disproportionately involved in fraud. Apply a temporary ' +
      'flag threshold of 35 (instead of 50) for accounts less than one week old.',
    impactScore: 28,
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
];

// ── Trend builder (client-side for offline use) ────────────────────────────────

function buildLocalTrend(days: number): TrendPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const base = 40 + Math.round(Math.sin(i / 3) * 10);
    return {
      date: d.toISOString().slice(0, 10),
      totalChecks: base + Math.round(Math.random() * 20),
      flagged: Math.round(base * 0.15),
      blocked: Math.round(base * 0.05),
      avgRiskScore: 30 + Math.round(Math.random() * 20),
    };
  });
}

// ── Signal breakdown (derived from analytics store) ────────────────────────────

function buildSignalBreakdown(analytics: FraudAnalytics): SignalBreakdown[] {
  const raw = [
    { signalType: 'velocity', count: analytics.velocityAlerts ?? 0, avgScore: 28 },
    { signalType: 'usage-anomaly', count: analytics.anomalyAlerts ?? 0, avgScore: 22 },
    { signalType: 'chargeback', count: analytics.chargebackPredictions ?? 0, avgScore: 38 },
    { signalType: 'geolocation-anomaly', count: analytics.geoAnomalyAlerts ?? 0, avgScore: 24 },
    {
      signalType: 'device-mismatch',
      count: Math.round((analytics.flagged ?? 0) * 0.3),
      avgScore: 20,
    },
    {
      signalType: 'pattern-shift',
      count: Math.round((analytics.flagged ?? 0) * 0.2),
      avgScore: 26,
    },
  ];
  const total = raw.reduce((s, r) => s + r.count, 0);
  return raw.map((s) => ({
    ...s,
    percentage: total > 0 ? Math.round((s.count / total) * 100) : 0,
  }));
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useFraudAnalytics(pollIntervalMs = 30_000): FraudAnalyticsState {
  const { analytics, merchants, assessments, reviewQueue, refreshFraudSignals } = useFraudStore();

  const [detectionStats, setDetectionStats] = useState<DetectionStats>(
    fraudDetectionService.getDetectionStats()
  );
  const [alerts, setAlerts] = useState<FraudAlert[]>(fraudAlertService.getAlerts());
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trend] = useState<TrendPoint[]>(() => buildLocalTrend(30));

  // Subscribe to alert changes
  useEffect(() => {
    const unsub = fraudAlertService.subscribeToAlerts((updated) => {
      setAlerts([...updated]);
    });
    return unsub;
  }, []);

  // Refresh handler
  const refresh = useCallback(() => {
    setIsLoading(true);
    setError(null);
    try {
      refreshFraudSignals();
      setDetectionStats(fraudDetectionService.getDetectionStats());
      setAlerts(fraudAlertService.getAlerts());
      setLastRefreshedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown refresh error');
    } finally {
      setIsLoading(false);
    }
  }, [refreshFraudSignals]);

  // Periodic polling
  useEffect(() => {
    refresh();
    if (pollIntervalMs <= 0) return;
    const id = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(id);
  }, [refresh, pollIntervalMs]);

  // Derived data
  const topRiskMerchants = useMemo(
    () => [...merchants].sort((a, b) => b.averageRisk - a.averageRisk).slice(0, 5),
    [merchants]
  );

  const signals = useMemo(() => buildSignalBreakdown(analytics), [analytics]);

  const unreadAlertCount = fraudAlertService.getUnreadCount();
  const criticalAlertCount = alerts.filter((a) => a.severity === 'critical' && !a.dismissed).length;

  // Alert actions
  const markAlertRead = useCallback((alertId: string) => {
    fraudAlertService.markAsRead(alertId);
  }, []);

  const markAllAlertsRead = useCallback(() => {
    fraudAlertService.markAllAsRead();
  }, []);

  const dismissAlert = useCallback((alertId: string) => {
    fraudAlertService.dismissAlert(alertId);
  }, []);

  return {
    analytics,
    detectionStats,
    trend,
    signals,
    merchants,
    topRiskMerchants,
    assessments,
    reviewQueue,
    alerts,
    unreadAlertCount,
    criticalAlertCount,
    recommendations: RECOMMENDATIONS,
    isLoading,
    lastRefreshedAt,
    error,
    refresh,
    markAlertRead,
    markAllAlertsRead,
    dismissAlert,
  };
}
