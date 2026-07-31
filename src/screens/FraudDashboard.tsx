import React, { useMemo, useState, useCallback } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useFraudStore } from '../store/fraudStore';
import { FraudAction, FraudCase, FraudReport } from '../types/fraud';
import { FraudCaseCard } from '../components/fraud/FraudCaseCard';
import { FraudReportPanel } from '../components/fraud/FraudReportPanel';
import { AlertSeverity } from '../services/fraudAlertService';
import {
  useFraudAnalytics,
  PreventionRecommendation,
  SignalBreakdown,
} from '../hooks/useFraudAnalytics';

// ── Types ─────────────────────────────────────────────────────────────────────

type TabId = 'overview' | 'alerts' | 'investigation' | 'reports' | 'prevention';

// ── Constants ─────────────────────────────────────────────────────────────────

const actionPalette: Record<FraudAction, string> = {
  approve: colors.success,
  flag: colors.warning,
  block: colors.error,
};

const severityColor: Record<AlertSeverity, string> = {
  critical: colors.error,
  high: '#F97316',
  medium: colors.warning,
  low: colors.success,
  info: colors.primary,
};

const recommendationSeverityColor: Record<string, string> = {
  critical: colors.error,
  high: '#F97316',
  medium: colors.warning,
  low: colors.success,
};

const effortColor: Record<string, string> = {
  low: colors.success,
  medium: colors.warning,
  high: colors.error,
};

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'investigation', label: 'Investigate' },
  { id: 'reports', label: 'Reports' },
  { id: 'prevention', label: 'Prevention' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

const MetricCard: React.FC<{
  label: string;
  value: string;
  hint: string;
  color: string;
}> = ({ label, value, hint, color }) => (
  <Card style={styles.metricCard}>
    <View style={[styles.metricAccent, { backgroundColor: color }]} />
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
    <Text style={styles.metricHint}>{hint}</Text>
  </Card>
);

const TrendBar: React.FC<{ value: number; max: number; color: string }> = ({
  value,
  max,
  color,
}) => (
  <View style={styles.trendBarTrack}>
    <View
      style={[
        styles.trendBarFill,
        { width: `${max > 0 ? Math.round((value / max) * 100) : 0}%`, backgroundColor: color },
      ]}
    />
  </View>
);

const SignalRow: React.FC<{ signal: SignalBreakdown }> = ({ signal }) => (
  <View style={styles.distributionRow}>
    <Text style={styles.distributionLabel} numberOfLines={1}>
      {signal.signalType}
    </Text>
    <TrendBar value={signal.count} max={100} color={colors.primary} />
    <Text style={styles.distributionValue}>{signal.count}</Text>
    <Text style={styles.distributionPct}>{signal.percentage}%</Text>
  </View>
);

const RecommendationCard: React.FC<{ rec: PreventionRecommendation }> = ({ rec }) => (
  <View style={styles.recCard}>
    <View style={styles.recHeader}>
      <View style={styles.recBadgeRow}>
        <View
          style={[
            styles.recBadge,
            {
              backgroundColor: recommendationSeverityColor[rec.severity] + '22',
              borderColor: recommendationSeverityColor[rec.severity],
            },
          ]}>
          <Text style={[styles.recBadgeText, { color: recommendationSeverityColor[rec.severity] }]}>
            {rec.severity}
          </Text>
        </View>
        <View
          style={[
            styles.recBadge,
            {
              backgroundColor: effortColor[rec.effort] + '22',
              borderColor: effortColor[rec.effort],
            },
          ]}>
          <Text style={[styles.recBadgeText, { color: effortColor[rec.effort] }]}>
            {rec.effort} effort
          </Text>
        </View>
        <View
          style={[
            styles.recBadge,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}>
          <Text style={[styles.recBadgeText, { color: colors.textSecondary }]}>{rec.category}</Text>
        </View>
      </View>
      <View style={styles.recImpact}>
        <Text style={styles.recImpactValue}>-{rec.impactScore}%</Text>
        <Text style={styles.recImpactLabel}>risk</Text>
      </View>
    </View>
    <Text style={styles.recTitle}>{rec.title}</Text>
    <Text style={styles.recDescription}>{rec.description}</Text>
  </View>
);

// ── Main component ────────────────────────────────────────────────────────────

const FraudDashboard: React.FC = () => {
  const { width } = useWindowDimensions();
  const isWide = width >= 980;

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const [alertFilter, setAlertFilter] = useState<AlertSeverity | 'all'>('all');

  const {
    analytics,
    detectionStats,
    trend,
    signals,
    topRiskMerchants,
    assessments,
    reviewQueue,
    alerts,
    unreadAlertCount,
    criticalAlertCount,
    recommendations,
    isLoading,
    lastRefreshedAt,
    refresh,
    markAlertRead,
    markAllAlertsRead,
    dismissAlert: dismissAlertFn,
  } = useFraudAnalytics();

  const { merchants, approveSubscription, blockSubscription, resolveCase, getFraudReport } =
    useFraudStore();

  const highlightedReports = useMemo(
    () => merchants.map((m) => getFraudReport(m.id)),
    [merchants, getFraudReport]
  );

  const visibleAlerts = useMemo(() => {
    if (alertFilter === 'all') return alerts;
    return alerts.filter((a) => a.severity === alertFilter);
  }, [alerts, alertFilter]);

  const handleToggleCase = useCallback((caseId: string) => {
    setExpandedCase((prev) => (prev === caseId ? null : caseId));
  }, []);

  const handleApproveCase = useCallback(
    (caseId: string) => {
      approveSubscription(caseId);
    },
    [approveSubscription]
  );

  const handleBlockCase = useCallback(
    (caseId: string) => {
      blockSubscription(caseId);
    },
    [blockSubscription]
  );

  const handleDismissCase = useCallback(
    (caseId: string) => {
      resolveCase(caseId, 'approve');
    },
    [resolveCase]
  );

  // ── Trend chart (sparkline bars) ───────────────────────────────────────────

  const trendMax = useMemo(() => Math.max(...trend.map((t) => t.totalChecks), 1), [trend]);

  // ── Tab: Overview ──────────────────────────────────────────────────────────

  const renderOverview = () => (
    <>
      {/* Primary metrics */}
      <View style={[styles.metricsGrid, isWide && styles.metricsGridWide]}>
        <MetricCard
          label="Total checks"
          value={analytics.totalChecks.toString()}
          hint="Subscriptions reviewed"
          color={colors.accent}
        />
        <MetricCard
          label="Blocked"
          value={analytics.blocked.toString()}
          hint="Automated hard stops"
          color={colors.error}
        />
        <MetricCard
          label="Flagged"
          value={analytics.flagged.toString()}
          hint="Queued for review"
          color={colors.warning}
        />
        <MetricCard
          label="Avg risk"
          value={`${analytics.avgRisk}`}
          hint="Aggregate risk score"
          color={colors.primary}
        />
      </View>

      {/* Secondary metrics */}
      <View style={[styles.metricsGrid, isWide && styles.metricsGridWide]}>
        <MetricCard
          label="Velocity alerts"
          value={analytics.velocityAlerts.toString()}
          hint="Rapid creation detected"
          color={colors.secondary}
        />
        <MetricCard
          label="Anomaly alerts"
          value={analytics.anomalyAlerts.toString()}
          hint="Usage deviates from baseline"
          color={colors.accent}
        />
        <MetricCard
          label="Geo alerts"
          value={analytics.geoAnomalyAlerts.toString()}
          hint="Location drift"
          color={colors.warning}
        />
        <MetricCard
          label="Model confidence"
          value={`${analytics.modelConfidence}%`}
          hint="Adjusted for false positives"
          color={colors.primary}
        />
      </View>

      <View style={[styles.grid, isWide && styles.gridWide]}>
        {/* 30-day trend */}
        <Card style={[styles.sectionCard, isWide && styles.halfCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>30-day trend</Text>
            {isLoading && <ActivityIndicator size="small" color={colors.primary} />}
            {lastRefreshedAt && !isLoading && (
              <Text style={styles.sectionMeta}>
                Updated{' '}
                {new Date(lastRefreshedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            )}
          </View>
          <View style={styles.sparklineRow}>
            {trend.slice(-14).map((pt) => (
              <View key={pt.date} style={styles.sparklineCol}>
                <View style={styles.sparklineBarWrap}>
                  <View
                    style={[
                      styles.sparklineBar,
                      {
                        height: `${Math.round((pt.totalChecks / trendMax) * 100)}%`,
                        backgroundColor: colors.primary + 'AA',
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.sparklineBarBlocked,
                      {
                        height: `${Math.round((pt.blocked / trendMax) * 100)}%`,
                        backgroundColor: colors.error,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.sparklineLabel}>{pt.date.slice(5)}</Text>
              </View>
            ))}
          </View>
          <View style={styles.sparklineLegend}>
            <View style={[styles.legendDot, { backgroundColor: colors.primary + 'AA' }]} />
            <Text style={styles.legendText}>Total</Text>
            <View style={[styles.legendDot, { backgroundColor: colors.error }]} />
            <Text style={styles.legendText}>Blocked</Text>
          </View>
        </Card>

        {/* Signal breakdown */}
        <Card style={[styles.sectionCard, isWide && styles.halfCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Signal breakdown</Text>
            <Text style={styles.sectionMeta}>By type</Text>
          </View>
          {signals.map((s) => (
            <SignalRow key={s.signalType} signal={s} />
          ))}
        </Card>

        {/* Risk distribution */}
        <Card style={[styles.sectionCard, isWide && styles.halfCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Risk distribution</Text>
            <Text style={styles.sectionMeta}>Action outcomes</Text>
          </View>
          {(['approved', 'flagged', 'blocked'] as const).map((key) => {
            const val = analytics[key as keyof typeof analytics] as number;
            const col =
              key === 'approved'
                ? colors.success
                : key === 'flagged'
                  ? colors.warning
                  : colors.error;
            return (
              <View key={key} style={styles.distributionRow}>
                <Text style={styles.distributionLabel}>
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </Text>
                <TrendBar value={val} max={Math.max(analytics.totalChecks, 1)} color={col} />
                <Text style={styles.distributionValue}>{val}</Text>
              </View>
            );
          })}
        </Card>

        {/* Top risk merchants */}
        <Card style={[styles.sectionCard, isWide && styles.halfCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Top risk merchants</Text>
            <Text style={styles.sectionMeta}>By avg risk score</Text>
          </View>
          {topRiskMerchants.map((m) => (
            <View key={m.id} style={styles.reportRow}>
              <View style={styles.reportHeader}>
                <Text style={styles.caseTitle}>{m.name}</Text>
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor:
                        m.status === 'high-risk'
                          ? colors.error + '22'
                          : m.status === 'watch'
                            ? colors.warning + '22'
                            : colors.success + '22',
                    },
                  ]}>
                  <Text
                    style={[
                      styles.statusBadgeText,
                      {
                        color:
                          m.status === 'high-risk'
                            ? colors.error
                            : m.status === 'watch'
                              ? colors.warning
                              : colors.success,
                      },
                    ]}>
                    {m.status}
                  </Text>
                </View>
              </View>
              <View style={styles.reportGrid}>
                <Text style={styles.reportMetric}>Avg risk {m.averageRisk}</Text>
                <Text style={styles.reportMetric}>Active {m.activeSubscriptions}</Text>
                <Text style={styles.reportMetric}>Blocked {m.blockedSubscriptions}</Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Signal feed */}
        <Card style={[styles.sectionCard, isWide && styles.halfCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Signal feed</Text>
            <Text style={styles.sectionMeta}>Latest assessments</Text>
          </View>
          {assessments.slice(0, 6).map((item) => (
            <View key={`${item.subscriptionId}-${item.assessedAt}`} style={styles.feedRow}>
              <View style={styles.feedCopy}>
                <Text style={styles.feedTitle}>{item.merchantName}</Text>
                <Text style={styles.feedDescription}>{item.reason}</Text>
                <View style={styles.badgeRow}>
                  {item.signals.map((s) => (
                    <View key={`${s.kind}-${s.observedAt}`} style={styles.signalChip}>
                      <Text style={styles.signalChipText}>
                        {s.kind} {s.score}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
              <View style={[styles.actionPill, { backgroundColor: actionPalette[item.action] }]}>
                <Text style={styles.actionPillText}>{item.action}</Text>
              </View>
            </View>
          ))}
          {assessments.length === 0 && <Text style={styles.emptyText}>No recent assessments.</Text>}
        </Card>

        {/* Detection stats */}
        <Card style={[styles.sectionCard, isWide && styles.halfCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Detection engine</Text>
            <Text style={styles.sectionMeta}>Real-time stats</Text>
          </View>
          <View style={styles.statsGrid}>
            {[
              { label: 'Evaluated', val: detectionStats.totalEvaluated },
              { label: 'Approved', val: detectionStats.approvedCount },
              { label: 'Flagged', val: detectionStats.flaggedCount },
              { label: 'Blocked', val: detectionStats.blockedCount },
            ].map(({ label, val }) => (
              <View key={label} style={styles.statItem}>
                <Text style={styles.statValue}>{val}</Text>
                <Text style={styles.statLabel}>{label}</Text>
              </View>
            ))}
          </View>
          {detectionStats.lastEvaluatedAt && (
            <Text style={styles.sectionMeta}>
              Last evaluated: {new Date(detectionStats.lastEvaluatedAt).toLocaleTimeString()}
            </Text>
          )}
          <Text style={styles.sectionMeta}>
            Avg processing: {detectionStats.avgProcessingMs} ms
          </Text>
        </Card>
      </View>
    </>
  );

  // ── Tab: Alerts ────────────────────────────────────────────────────────────

  const renderAlerts = () => (
    <Card style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Fraud Alerts</Text>
        <Text style={styles.sectionMeta}>
          {unreadAlertCount} unread · {criticalAlertCount} critical
        </Text>
      </View>
      <View style={styles.filterRow}>
        {(['all', 'critical', 'high', 'medium', 'low'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, alertFilter === f && styles.filterChipActive]}
            onPress={() => setAlertFilter(f)}
            accessibilityRole="button"
            accessibilityLabel={`Filter by ${f}`}>
            <Text style={[styles.filterChipText, alertFilter === f && styles.filterChipTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
        {unreadAlertCount > 0 && (
          <TouchableOpacity style={styles.markAllButton} onPress={markAllAlertsRead}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>
      {visibleAlerts.length === 0 && (
        <Text style={styles.emptyText}>
          No alerts{alertFilter !== 'all' ? ` with severity "${alertFilter}"` : ''}.
        </Text>
      )}
      {visibleAlerts.map((alert) => (
        <View key={alert.id} style={[styles.alertRow, !alert.read && styles.alertRowUnread]}>
          <View
            style={[styles.alertSeverityBar, { backgroundColor: severityColor[alert.severity] }]}
          />
          <View style={styles.alertContent}>
            <View style={styles.alertHeader}>
              <View
                style={[styles.severityBadge, { backgroundColor: severityColor[alert.severity] }]}>
                <Text style={styles.severityBadgeText}>{alert.severity}</Text>
              </View>
              <Text style={styles.alertTime}>
                {new Date(alert.triggeredAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
            <Text style={styles.alertTitle}>{alert.title}</Text>
            <Text style={styles.alertMessage}>{alert.message}</Text>
            {alert.merchantName && (
              <Text style={styles.alertMeta}>Merchant: {alert.merchantName}</Text>
            )}
          </View>
          <View style={styles.alertActions}>
            {!alert.read && (
              <TouchableOpacity
                onPress={() => markAlertRead(alert.id)}
                style={styles.alertActionBtn}>
                <Text style={styles.alertActionText}>Read</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => dismissAlertFn(alert.id)}
              style={styles.alertActionBtn}>
              <Text style={[styles.alertActionText, { color: colors.textSecondary }]}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </Card>
  );

  // ── Tab: Investigation ─────────────────────────────────────────────────────

  const renderInvestigation = () => (
    <Card style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Review Queue</Text>
        <Text style={styles.sectionMeta}>
          {reviewQueue.length} cases · {analytics.manualReviewsClosed} closed
        </Text>
      </View>
      {reviewQueue.length === 0 && <Text style={styles.emptyText}>No cases awaiting review.</Text>}
      {reviewQueue.map((item: FraudCase) => (
        <FraudCaseCard
          key={item.caseId}
          fraudCase={item}
          onApprove={handleApproveCase}
          onBlock={handleBlockCase}
          onDismiss={handleDismissCase}
          expanded={expandedCase === item.caseId}
          onToggleExpand={handleToggleCase}
        />
      ))}
    </Card>
  );

  // ── Tab: Reports ───────────────────────────────────────────────────────────

  const renderReports = () => (
    <>
      {highlightedReports.map((report: FraudReport) => (
        <FraudReportPanel
          key={report.merchantId}
          report={report}
          onExport={() => {
            void report.merchantId;
          }}
        />
      ))}
    </>
  );

  // ── Tab: Prevention Recommendations ───────────────────────────────────────

  const renderPrevention = () => {
    const criticalRecs = recommendations.filter((r) => r.severity === 'critical');
    const highRecs = recommendations.filter((r) => r.severity === 'high');
    const otherRecs = recommendations.filter(
      (r) => r.severity !== 'critical' && r.severity !== 'high'
    );
    const totalImpact = recommendations.reduce((s, r) => s + r.impactScore, 0);

    return (
      <>
        {/* Summary card */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Prevention Recommendations</Text>
            <Text style={styles.sectionMeta}>{recommendations.length} actions identified</Text>
          </View>
          <View style={[styles.metricsGrid, isWide && styles.metricsGridWide]}>
            <View style={styles.prevStat}>
              <Text style={[styles.prevStatValue, { color: colors.error }]}>
                {criticalRecs.length}
              </Text>
              <Text style={styles.prevStatLabel}>Critical</Text>
            </View>
            <View style={styles.prevStat}>
              <Text style={[styles.prevStatValue, { color: '#F97316' }]}>{highRecs.length}</Text>
              <Text style={styles.prevStatLabel}>High</Text>
            </View>
            <View style={styles.prevStat}>
              <Text style={[styles.prevStatValue, { color: colors.primary }]}>
                {otherRecs.length}
              </Text>
              <Text style={styles.prevStatLabel}>Other</Text>
            </View>
            <View style={styles.prevStat}>
              <Text style={[styles.prevStatValue, { color: colors.success }]}>
                -{Math.min(totalImpact, 99)}%
              </Text>
              <Text style={styles.prevStatLabel}>Est. risk reduction</Text>
            </View>
          </View>
        </Card>

        {/* Critical */}
        {criticalRecs.length > 0 && (
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={[styles.recSectionDot, { backgroundColor: colors.error }]} />
              <Text style={styles.sectionTitle}>Critical actions</Text>
            </View>
            {criticalRecs.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </Card>
        )}

        {/* High */}
        {highRecs.length > 0 && (
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={[styles.recSectionDot, { backgroundColor: '#F97316' }]} />
              <Text style={styles.sectionTitle}>High priority</Text>
            </View>
            {highRecs.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </Card>
        )}

        {/* Medium / Low */}
        {otherRecs.length > 0 && (
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={[styles.recSectionDot, { backgroundColor: colors.primary }]} />
              <Text style={styles.sectionTitle}>Additional improvements</Text>
            </View>
            {otherRecs.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </Card>
        )}
      </>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.hero, isWide && styles.heroWide]}>
        <View style={styles.heroCopy}>
          <Text style={styles.title}>Fraud Control Center</Text>
          <Text style={styles.subtitle}>
            Real-time risk scoring, velocity checks, geolocation anomaly detection, chargeback
            prediction, alerts, investigation workflow, and prevention recommendations.
          </Text>
        </View>
        <View style={styles.heroActions}>
          <Button
            title={isLoading ? 'Refreshing…' : 'Recalculate risk'}
            onPress={refresh}
            size="small"
          />
        </View>
      </View>

      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const badge =
            tab.id === 'alerts' && unreadAlertCount > 0
              ? ` (${unreadAlertCount})`
              : tab.id === 'prevention' &&
                  recommendations.filter((r) => r.severity === 'critical').length > 0
                ? ` (${recommendations.filter((r) => r.severity === 'critical').length})`
                : '';
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: activeTab === tab.id }}>
              <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>
                {tab.label}
                {badge}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'alerts' && renderAlerts()}
        {activeTab === 'investigation' && renderInvestigation()}
        {activeTab === 'reports' && renderReports()}
        {activeTab === 'prevention' && renderPrevention()}
      </ScrollView>
    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  hero: { padding: spacing.lg, gap: spacing.md },
  heroWide: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroCopy: { flex: 1, maxWidth: 760 },
  heroActions: { alignItems: 'flex-end' },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary },

  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.background,
    flexWrap: 'wrap',
  },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { ...typography.body, color: colors.textSecondary, fontWeight: '500' },
  tabTextActive: { color: colors.primary, fontWeight: '700' },

  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  metricsGrid: { gap: spacing.md },
  metricsGridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  metricCard: { flex: 1, minWidth: 160 },
  metricAccent: { width: 38, height: 4, borderRadius: borderRadius.full, marginBottom: spacing.md },
  metricValue: { ...typography.h2, color: colors.text, marginBottom: spacing.xs },
  metricLabel: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
  metricHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },

  grid: { gap: spacing.md },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  sectionCard: { flexBasis: '100%' },
  halfCard: { flexBasis: '48.5%' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: { ...typography.h3, color: colors.text },
  sectionMeta: { ...typography.caption, color: colors.accent },

  // Sparkline trend
  sparklineRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 64,
    marginBottom: spacing.sm,
  },
  sparklineCol: { flex: 1, alignItems: 'center', gap: 2 },
  sparklineBarWrap: { flex: 1, width: '100%', justifyContent: 'flex-end', position: 'relative' },
  sparklineBar: { width: '100%', borderRadius: 2 },
  sparklineBarBlocked: { width: '100%', borderRadius: 2, position: 'absolute', bottom: 0 },
  sparklineLabel: { fontSize: 8, color: colors.textSecondary, textAlign: 'center' },
  sparklineLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...typography.caption, color: colors.textSecondary },

  // Distribution / signal rows
  distributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  distributionLabel: { ...typography.caption, color: colors.textSecondary, width: 96 },
  trendBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  trendBarFill: { height: '100%', borderRadius: borderRadius.full },
  distributionValue: { ...typography.caption, color: colors.text, width: 28, textAlign: 'right' },
  distributionPct: {
    ...typography.caption,
    color: colors.textSecondary,
    width: 32,
    textAlign: 'right',
  },

  // Stats grid
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.sm },
  statItem: { minWidth: 80, alignItems: 'center' },
  statValue: { ...typography.h3, color: colors.text, fontWeight: '700' },
  statLabel: { ...typography.caption, color: colors.textSecondary },

  // Merchant rows
  reportRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  reportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reportMetric: { ...typography.caption, color: colors.textSecondary },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: borderRadius.sm },
  statusBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  // Signal feed
  feedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  feedCopy: { flex: 1 },
  feedTitle: { ...typography.body, color: colors.text, fontWeight: '700' },
  feedDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  signalChip: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
  },
  signalChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  actionPill: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  actionPillText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    textTransform: 'uppercase',
  },

  // Common
  caseTitle: { ...typography.body, color: colors.text, fontWeight: '700' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  emptyText: { ...typography.caption, color: colors.textSecondary },

  // Alert tab
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primary + '20' },
  filterChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  filterChipTextActive: { color: colors.primary },
  markAllButton: { marginLeft: 'auto', paddingVertical: 6, paddingHorizontal: spacing.sm },
  markAllText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  alertRowUnread: { backgroundColor: colors.primary + '08' },
  alertSeverityBar: { width: 4, borderRadius: 2, alignSelf: 'stretch', minHeight: 40 },
  alertContent: { flex: 1, gap: 4 },
  alertHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: borderRadius.sm },
  severityBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  alertTime: { ...typography.caption, color: colors.textSecondary, marginLeft: 'auto' },
  alertTitle: { ...typography.body, color: colors.text, fontWeight: '600', fontSize: 14 },
  alertMessage: { ...typography.caption, color: colors.textSecondary },
  alertMeta: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic' },
  alertActions: { gap: 4, alignItems: 'flex-end' },
  alertActionBtn: { paddingVertical: 4, paddingHorizontal: spacing.sm },
  alertActionText: { ...typography.caption, color: colors.primary, fontWeight: '600' },

  // Prevention tab
  prevStat: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  prevStatValue: { ...typography.h2, fontWeight: '700' },
  prevStatLabel: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  recSectionDot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.xs },
  recCard: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  recHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  recBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, flex: 1 },
  recBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
  },
  recBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  recImpact: { alignItems: 'center', minWidth: 48 },
  recImpactValue: { ...typography.h3, color: colors.success, fontWeight: '700' },
  recImpactLabel: { ...typography.caption, color: colors.textSecondary },
  recTitle: { ...typography.body, color: colors.text, fontWeight: '700', marginBottom: spacing.xs },
  recDescription: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
});

export default FraudDashboard;
