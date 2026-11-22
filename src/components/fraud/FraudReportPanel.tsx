/**
 * FraudReportPanel
 *
 * Displays a per-merchant fraud report summary and a list of prioritised
 * prevention recommendations.  An optional Export button calls onExport.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ScrollView } from 'react-native';
import { FraudReport } from '../../types/fraud';
import { PreventionRecommendation } from '../../services/fraudDetectionService';
import { colors, spacing, typography, borderRadius } from '../../utils/constants';

// ── Props ─────────────────────────────────────────────────────────────────────

interface FraudReportPanelProps {
  report: FraudReport;
  recommendations?: PreventionRecommendation[];
  onExport?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Use the local PreventionRecommendation type from the service
// (same structure as backend, avoids coupling to backend path in mobile)
type Rec = {
  id: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impactScore: number;
  effort: string;
};

function severityColor(severity: Rec['severity']): string {
  switch (severity) {
    case 'critical':
      return colors.error;
    case 'high':
      return '#F97316'; // orange
    case 'medium':
      return colors.warning;
    case 'low':
      return colors.success;
    default:
      return colors.textSecondary;
  }
}

function severityLabel(severity: Rec['severity']): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

interface MetricBoxProps {
  label: string;
  value: string | number;
  color?: string;
}

const MetricBox: React.FC<MetricBoxProps> = ({ label, value, color }) => (
  <View style={metricStyles.box}>
    <Text style={[metricStyles.value, color ? { color } : undefined]}>{value}</Text>
    <Text style={metricStyles.label}>{label}</Text>
  </View>
);

const metricStyles = StyleSheet.create({
  box: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface ?? '#F9FAFB',
  },
  value: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '700',
  },
  label: {
    ...(typography.caption ?? typography.body),
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },
});

// ── Default prevention recommendations (used when none are passed in) ─────────

const DEFAULT_RECS: Rec[] = [
  {
    id: 'rec_cb_001',
    category: 'chargeback',
    severity: 'critical',
    title: 'Auto-block subscribers with 2+ chargebacks',
    description:
      'Subscribers with two or more chargebacks in the last 90 days should be automatically blocked from new subscriptions and routed to manual review.',
    impactScore: 45,
    effort: 'low',
  },
  {
    id: 'rec_vel_001',
    category: 'velocity',
    severity: 'high',
    title: 'Implement subscription creation rate limits',
    description:
      'Limit each subscriber to at most 3 new subscriptions per 24-hour window to curb velocity fraud.',
    impactScore: 35,
    effort: 'low',
  },
  {
    id: 'rec_geo_001',
    category: 'geo',
    severity: 'medium',
    title: 'Require geo verification for cross-border access',
    description:
      'Enforce OTP or email confirmation when a subscriber accesses from a country other than their registration country.',
    impactScore: 25,
    effort: 'medium',
  },
  {
    id: 'rec_device_001',
    category: 'device',
    severity: 'medium',
    title: 'Bind trusted device fingerprints',
    description:
      'Capture a trusted device fingerprint at registration and alert on unrecognised devices.',
    impactScore: 20,
    effort: 'medium',
  },
  {
    id: 'rec_mon_001',
    category: 'monitoring',
    severity: 'low',
    title: 'Enable model drift monitoring',
    description:
      'Alert the fraud team when the false-positive rate exceeds 20% so rule weights can be recalibrated.',
    impactScore: 15,
    effort: 'low',
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export const FraudReportPanel: React.FC<FraudReportPanelProps> = ({
  report,
  recommendations,
  onExport,
}) => {
  const recs: Rec[] = (recommendations as unknown as Rec[]) ?? DEFAULT_RECS;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      {/* Merchant header */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.merchantName}>{report.merchantName}</Text>
          <Text style={styles.merchantId}>Merchant ID: {report.merchantId}</Text>
        </View>
        {onExport && (
          <TouchableOpacity
            style={styles.exportButton}
            onPress={onExport}
            accessibilityRole="button"
            accessibilityLabel="Export fraud report">
            <Text style={styles.exportButtonText}>Export</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Key metrics */}
      <View style={styles.metricsGrid}>
        <MetricBox label="Total subscriptions" value={report.totalSubscriptions} />
        <MetricBox label="Flagged" value={report.flaggedSubscriptions} color={colors.warning} />
        <MetricBox label="Blocked" value={report.blockedSubscriptions} color={colors.error} />
        <MetricBox
          label="Avg risk"
          value={`${report.averageRisk}%`}
          color={
            report.averageRisk >= 60
              ? colors.error
              : report.averageRisk >= 40
                ? colors.warning
                : colors.success
          }
        />
      </View>

      {/* Secondary metrics */}
      <View style={styles.metricsGrid}>
        <MetricBox label="Manual reviews" value={report.manualReviewCount} />
        <MetricBox label="Velocity alerts" value={report.velocityAlerts} />
        <MetricBox label="Anomaly alerts" value={report.anomalyAlerts} />
        <MetricBox label="CB predictions" value={report.chargebackPredictions} />
      </View>

      {/* False positive feedback */}
      {report.falsePositiveFeedbackCount > 0 && (
        <View style={styles.fpBanner}>
          <Text style={styles.fpBannerText}>
            ⚠ {report.falsePositiveFeedbackCount} false-positive feedback report
            {report.falsePositiveFeedbackCount !== 1 ? 's' : ''} — consider adjusting rule weights.
          </Text>
        </View>
      )}

      {/* Prevention recommendations */}
      <Text style={styles.sectionTitle}>Prevention Recommendations</Text>
      <Text style={styles.sectionSubtitle}>
        Implement these recommendations to reduce fraud risk.
      </Text>

      {recs.map((rec) => (
        <View key={rec.id} style={styles.recCard}>
          <View style={styles.recHeader}>
            <View style={[styles.severityBadge, { backgroundColor: severityColor(rec.severity) }]}>
              <Text style={styles.severityText}>{severityLabel(rec.severity)}</Text>
            </View>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{rec.category}</Text>
            </View>
            <Text style={styles.effortText}>Effort: {rec.effort}</Text>
          </View>

          <Text style={styles.recTitle}>{rec.title}</Text>
          <Text style={styles.recDescription}>{rec.description}</Text>

          <View style={styles.impactRow}>
            <Text style={styles.impactLabel}>Expected impact:</Text>
            <View style={styles.impactBarTrack}>
              <View
                style={[
                  styles.impactBarFill,
                  {
                    width: `${rec.impactScore}%` as `${number}%`,
                    backgroundColor: severityColor(rec.severity),
                  },
                ]}
              />
            </View>
            <Text style={styles.impactValue}>−{rec.impactScore}% risk</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  merchantName: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '700',
  },
  merchantId: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 12,
  },
  exportButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary,
    marginLeft: spacing.sm,
  },
  exportButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  fpBanner: {
    backgroundColor: colors.warning + '20',
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
  },
  fpBannerText: {
    color: colors.text,
    fontSize: 13,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  sectionSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  recCard: {
    backgroundColor: colors.surface ?? '#F9FAFB',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border ?? '#E5E7EB',
    padding: spacing.md,
    gap: spacing.sm,
  },
  recHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  severityBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  severityText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  categoryBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.textSecondary,
  },
  categoryText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  effortText: {
    color: colors.textSecondary,
    fontSize: 11,
    marginLeft: 'auto',
  },
  recTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
  },
  recDescription: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  impactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  impactLabel: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  impactBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.border ?? '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  impactBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  impactValue: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
    minWidth: 65,
    textAlign: 'right',
  },
});
