import React, { useMemo } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useFraudStore } from '../store/fraudStore';
import { FraudAction } from '../types/fraud';

const actionPalette: Record<FraudAction, string> = {
  approve: colors.success,
  flag: colors.warning,
  block: colors.error,
};

const FraudDashboard: React.FC = () => {
  const { width } = useWindowDimensions();
  const isWide = width >= 980;
  const {
    merchants,
    subscriptions,
    assessments,
    reviewQueue,
    analytics,
    refreshFraudSignals,
    assessRisk,
    approveSubscription,
    blockSubscription,
    resolveCase,
    submitFalsePositiveFeedback,
    getFraudReport,
  } = useFraudStore();

  const highlightedReports = useMemo(
    () => merchants.map((merchant) => getFraudReport(merchant.id)),
    [merchants, getFraudReport]
  );

  const topRiskSubscriptions = useMemo(
    () => [...subscriptions].sort((a, b) => b.riskScore - a.riskScore).slice(0, 5),
    [subscriptions]
  );

  const renderMetric = (label: string, value: string, hint: string, color: string) => (
    <Card style={styles.metricCard}>
      <View style={[styles.metricAccent, { backgroundColor: color }]} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricHint}>{hint}</Text>
    </Card>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.hero, isWide && styles.heroWide]}>
          <View style={styles.heroCopy}>
            <Text style={styles.title}>Fraud Control Center</Text>
            <Text style={styles.subtitle}>
              Risk scoring, velocity checks, geolocation anomaly detection, chargeback prediction,
              and a manual review queue with evidence-backed decisions.
            </Text>
          </View>
          <View style={styles.heroActions}>
            <Button title="Recalculate risk" onPress={refreshFraudSignals} size="small" />
          </View>
        </View>

        <View style={[styles.metricsGrid, isWide && styles.metricsGridWide]}>
          {renderMetric(
            'Total checks',
            analytics.totalChecks.toString(),
            'Subscriptions reviewed',
            colors.accent
          )}
          {renderMetric(
            'Blocked',
            analytics.blocked.toString(),
            'Automated hard stops',
            colors.error
          )}
          {renderMetric(
            'Flagged',
            analytics.flagged.toString(),
            'Queued for review',
            colors.warning
          )}
          {renderMetric('Avg risk', `${analytics.avgRisk}`, 'Aggregate risk score', colors.primary)}
        </View>

        <View style={[styles.metricsGrid, isWide && styles.metricsGridWide]}>
          {renderMetric(
            'Velocity alerts',
            analytics.velocityAlerts.toString(),
            'Rapid creation detected',
            colors.secondary
          )}
          {renderMetric(
            'Anomaly alerts',
            analytics.anomalyAlerts.toString(),
            'Usage deviates from baseline',
            colors.accent
          )}
          {renderMetric(
            'Geo alerts',
            analytics.geoAnomalyAlerts.toString(),
            'Location drift and travel anomalies',
            colors.warning
          )}
          {renderMetric(
            'Chargeback predictions',
            analytics.chargebackPredictions.toString(),
            'Predicted dispute exposure',
            colors.error
          )}
          {renderMetric(
            'False positive rate',
            `${analytics.falsePositiveRate}%`,
            'Feedback loop for model tuning',
            colors.success
          )}
          {renderMetric(
            'Model confidence',
            `${analytics.modelConfidence}%`,
            'Adjusted for false-positive feedback',
            colors.primary
          )}
        </View>

        <View style={[styles.grid, isWide && styles.gridWide]}>
          <Card style={[styles.sectionCard, isWide && styles.halfCard]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Manual review queue</Text>
              <Text style={styles.sectionMeta}>
                {reviewQueue.length} open cases · {analytics.manualReviewsClosed} closed
              </Text>
            </View>
            {reviewQueue.map((item) => (
              <View key={item.caseId} style={styles.caseRow}>
                <View style={styles.caseCopy}>
                  <Text style={styles.caseTitle}>{item.subscriptionName}</Text>
                  <Text style={styles.caseDescription}>
                    {item.merchantName} · {item.reason}
                  </Text>
                  <View style={styles.badgeRow}>
                    <View style={[styles.badge, { borderColor: actionPalette[item.action] }]}>
                      <Text style={[styles.badgeText, { color: actionPalette[item.action] }]}>
                        {item.action}
                      </Text>
                    </View>
                    <View style={styles.badgeMuted}>
                      <Text style={styles.badgeMutedText}>Risk {item.riskScore}</Text>
                    </View>
                    {item.outcome ? (
                      <View style={styles.badgeMuted}>
                        <Text style={styles.badgeMutedText}>{item.outcome.replace('_', ' ')}</Text>
                      </View>
                    ) : null}
                  </View>
                  {item.evidence?.length ? (
                    <View style={styles.evidenceBlock}>
                      <Text style={styles.evidenceLabel}>Evidence</Text>
                      <View style={styles.badgeRow}>
                        {item.evidence.map((evidence) => (
                          <View key={evidence.evidenceId} style={styles.evidenceChip}>
                            <Text style={styles.evidenceChipText}>
                              {evidence.label}: {evidence.value}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.caseDescription}>No evidence attached yet.</Text>
                  )}
                </View>
                <View style={styles.caseActions}>
                  <TouchableOpacity
                    style={styles.caseButton}
                    onPress={() => approveSubscription(item.subscriptionId)}>
                    <Text style={styles.caseButtonText}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.caseButtonWarning}
                    onPress={() => resolveCase(item.subscriptionId, 'flag')}>
                    <Text style={styles.caseButtonText}>Flag</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.caseButtonDanger}
                    onPress={() => blockSubscription(item.subscriptionId)}>
                    <Text style={styles.caseButtonText}>Block</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.caseButtonSecondary}
                    onPress={() =>
                      submitFalsePositiveFeedback(
                        item.subscriptionId,
                        'Reviewer marked as false positive'
                      )
                    }>
                    <Text style={styles.caseButtonText}>False positive</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {reviewQueue.length === 0 ? (
              <Text style={styles.emptyText}>No cases awaiting manual review.</Text>
            ) : null}
          </Card>

          <Card style={[styles.sectionCard, isWide && styles.halfCard]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Top risk subscriptions</Text>
              <Text style={styles.sectionMeta}>Live risk signals</Text>
            </View>
            {topRiskSubscriptions.map((item) => (
              <View key={item.id} style={styles.subscriptionRow}>
                <View style={styles.caseCopy}>
                  <Text style={styles.caseTitle}>{item.subscriptionName}</Text>
                  <Text style={styles.caseDescription}>
                    {item.merchantName} · {item.subscriberId} · {item.currency} {item.amount}
                  </Text>
                  <View style={styles.badgeRow}>
                    <View style={[styles.badge, { borderColor: actionPalette[item.action] }]}>
                      <Text style={[styles.badgeText, { color: actionPalette[item.action] }]}>
                        {item.action}
                      </Text>
                    </View>
                    <Text style={styles.scoreText}>{item.riskScore}</Text>
                  </View>
                </View>
                <Button
                  title="Assess"
                  size="small"
                  variant="secondary"
                  onPress={() => {
                    void assessRisk(item.subscriberId);
                  }}
                />
              </View>
            ))}
          </Card>

          <Card style={[styles.sectionCard, isWide && styles.halfCard]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Merchant analytics</Text>
              <Text style={styles.sectionMeta}>Fraud reports by merchant</Text>
            </View>
            {highlightedReports.map((report) => (
              <View key={report.merchantId} style={styles.reportRow}>
                <View style={styles.reportHeader}>
                  <Text style={styles.caseTitle}>{report.merchantName}</Text>
                  <Text style={styles.scoreText}>{report.averageRisk}</Text>
                </View>
                <Text style={styles.caseDescription}>
                  {report.totalSubscriptions} subs · {report.flaggedSubscriptions} flagged ·{' '}
                  {report.blockedSubscriptions} blocked
                </Text>
                <View style={styles.reportGrid}>
                  <Text style={styles.reportMetric}>Manual review {report.manualReviewCount}</Text>
                  <Text style={styles.reportMetric}>Velocity {report.velocityAlerts}</Text>
                  <Text style={styles.reportMetric}>Anomaly {report.anomalyAlerts}</Text>
                  <Text style={styles.reportMetric}>Chargeback {report.chargebackPredictions}</Text>
                  <Text style={styles.reportMetric}>Geo {report.geolocationAlerts}</Text>
                  <Text style={styles.reportMetric}>Evidence {report.pendingEvidenceCount}</Text>
                </View>
              </View>
            ))}
          </Card>

          <Card style={[styles.sectionCard, isWide && styles.halfCard]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Risk distribution</Text>
              <Text style={styles.sectionMeta}>Action outcomes</Text>
            </View>
            <View style={styles.distributionRow}>
              <Text style={styles.distributionLabel}>Approved</Text>
              <View style={styles.distributionBarTrack}>
                <View
                  style={[
                    styles.distributionBar,
                    {
                      width: `${(analytics.approved / Math.max(analytics.totalChecks, 1)) * 100}%`,
                      backgroundColor: colors.success,
                    },
                  ]}
                />
              </View>
              <Text style={styles.distributionValue}>{analytics.approved}</Text>
            </View>
            <View style={styles.distributionRow}>
              <Text style={styles.distributionLabel}>Flagged</Text>
              <View style={styles.distributionBarTrack}>
                <View
                  style={[
                    styles.distributionBar,
                    {
                      width: `${(analytics.flagged / Math.max(analytics.totalChecks, 1)) * 100}%`,
                      backgroundColor: colors.warning,
                    },
                  ]}
                />
              </View>
              <Text style={styles.distributionValue}>{analytics.flagged}</Text>
            </View>
            <View style={styles.distributionRow}>
              <Text style={styles.distributionLabel}>Blocked</Text>
              <View style={styles.distributionBarTrack}>
                <View
                  style={[
                    styles.distributionBar,
                    {
                      width: `${(analytics.blocked / Math.max(analytics.totalChecks, 1)) * 100}%`,
                      backgroundColor: colors.error,
                    },
                  ]}
                />
              </View>
              <Text style={styles.distributionValue}>{analytics.blocked}</Text>
            </View>
          </Card>
        </View>

        <Card style={styles.sectionCard}>
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
                  {item.signals.map((signal) => (
                    <View key={`${signal.kind}-${signal.observedAt}`} style={styles.signalChip}>
                      <Text style={styles.signalChipText}>
                        {signal.kind} {signal.score}
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
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  hero: {
    gap: spacing.md,
  },
  heroWide: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroCopy: {
    flex: 1,
    maxWidth: 760,
  },
  heroActions: {
    alignItems: 'flex-end',
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  metricsGrid: {
    gap: spacing.md,
  },
  metricsGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  metricCard: {
    flex: 1,
    minWidth: 160,
  },
  metricAccent: {
    width: 38,
    height: 4,
    borderRadius: borderRadius.full,
    marginBottom: spacing.md,
  },
  metricValue: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  metricLabel: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  metricHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  grid: {
    gap: spacing.md,
  },
  gridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  sectionCard: {
    flexBasis: '100%',
  },
  halfCard: {
    flexBasis: '48.5%',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  sectionMeta: {
    ...typography.caption,
    color: colors.accent,
  },
  caseRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  caseCopy: {
    flex: 1,
  },
  caseTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  caseDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  badgeText: {
    ...typography.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  badgeMuted: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  badgeMutedText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  caseActions: {
    gap: spacing.xs,
  },
  caseButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  caseButtonWarning: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.warning,
  },
  caseButtonDanger: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.error,
  },
  caseButtonSecondary: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.secondary,
  },
  caseButtonText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
  },
  emptyText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  subscriptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reportRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reportGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  reportMetric: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  evidenceBlock: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  evidenceLabel: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  evidenceChip: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  evidenceChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  scoreText: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '700',
  },
  distributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  distributionLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    width: 72,
  },
  distributionBarTrack: {
    flex: 1,
    height: 10,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  distributionBar: {
    height: '100%',
    borderRadius: borderRadius.full,
  },
  distributionValue: {
    ...typography.caption,
    color: colors.text,
    width: 32,
    textAlign: 'right',
  },
  feedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  feedCopy: {
    flex: 1,
  },
  feedTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  feedDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  signalChip: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
  },
  signalChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
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
});

export default FraudDashboard;
