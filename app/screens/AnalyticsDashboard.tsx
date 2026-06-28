import React, { useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Share,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useSubscriptionStore } from '../../src/store/subscriptionStore';
import { useAnalyticsStore } from '../stores/analyticsStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import { Card } from '../../src/components/common/Card';
import { Button } from '../../src/components/common/Button';
import { CohortChart } from '../../src/components/analytics/CohortChart';
import { RetentionHeatmap } from '../../src/components/analytics/RetentionHeatmap';
import { SankeyDiagram } from '../../src/components/analytics/SankeyDiagram';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { spacing, typography } from '../../src/utils/constants';
import { formatCurrency } from '../../src/utils/formatting';
import type { CohortGranularity } from '../../src/types/cohortAnalytics';

const AnalyticsDashboard: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { subscriptions } = useSubscriptionStore();
  const { preferredCurrency } = useSettingsStore();
  const {
    report,
    granularity,
    cohortBuckets,
    retentionCurve,
    churnBreakdown,
    planMigrationFlows,
    ltvBySource,
    revenueTrendWithAnomalies,
    setGranularity,
    compute,
    exportCSV,
    exportCohortCsv,
    exportCohortPdf,
  } = useAnalyticsStore();

  useEffect(() => {
    compute(subscriptions);
  }, [subscriptions, compute]);

  const handleSetGranularity = (next: CohortGranularity) => {
    setGranularity(next);
    compute(subscriptions);
  };

  const handleExportCSV = async () => {
    try {
      const csv = exportCSV(subscriptions);
      await Share.share({ message: csv, title: 'Subscriptions Export' });
    } catch {
      Alert.alert('Export Failed', 'Could not export analytics data');
    }
  };

  const handleExportCohortCsv = async () => {
    try {
      await Share.share({ message: exportCohortCsv(), title: 'Cohort Report (CSV)' });
    } catch {
      Alert.alert('Export Failed', 'Could not export cohort report');
    }
  };

  const handleExportCohortPdf = async () => {
    try {
      await Share.share({ message: exportCohortPdf(), title: 'Cohort Report (PDF)' });
    } catch {
      Alert.alert('Export Failed', 'Could not export cohort report');
    }
  };

  const currency = preferredCurrency ?? 'USD';

  if (!report) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.loadingText}>Computing analytics...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Analytics Dashboard</Text>
          <Text style={styles.subtitle}>
            {report.subscriberCount} active subscriber
            {report.subscriberCount !== 1 ? 's' : ''}
          </Text>
        </View>

        <View style={styles.row}>
          <Card style={styles.metricCard}>
            <Text style={styles.metricLabel}>MRR</Text>
            <Text style={styles.metricValue}>{formatCurrency(report.mrr, currency)}</Text>
          </Card>
          <Card style={styles.metricCard}>
            <Text style={styles.metricLabel}>ARR</Text>
            <Text style={styles.metricValue}>{formatCurrency(report.arr, currency)}</Text>
          </Card>
        </View>

        <View style={styles.row}>
          <Card style={styles.metricCard}>
            <Text style={styles.metricLabel}>ARPU</Text>
            <Text style={styles.metricValue}>{formatCurrency(report.arpu, currency)}</Text>
          </Card>
          <Card style={styles.metricCard}>
            <Text style={styles.metricLabel}>LTV</Text>
            <Text style={styles.metricValue}>{formatCurrency(report.ltv, currency)}</Text>
          </Card>
        </View>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Churn</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Gross Churn Rate</Text>
            <Text style={styles.statValue}>
              {(report.churn.grossChurnRate * 100).toFixed(1)}%
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Net Churn Rate</Text>
            <Text style={styles.statValue}>
              {(report.churn.netChurnRate * 100).toFixed(1)}%
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Active Subscribers</Text>
            <Text style={styles.statValue}>{report.churn.activeSubscriptions}</Text>
          </View>
          <View style={[styles.statRow, styles.lastRow]}>
            <Text style={styles.statLabel}>Churned Subscribers</Text>
            <Text style={styles.statValue}>{report.churn.churnedSubscriptions}</Text>
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Revenue Trend (last 6 months)</Text>
          {revenueTrendWithAnomalies.length === 0 ? (
            <Text style={styles.emptyText}>No trend data yet</Text>
          ) : (
            revenueTrendWithAnomalies.map((point, index, arr) => (
              <View key={point.label} style={[styles.statRow, index === arr.length - 1 && styles.lastRow]}>
                <Text style={styles.statLabel}>
                  {point.label}
                  {point.isAnomaly ? ' ⚠️' : ''}
                </Text>
                <Text style={[styles.statValue, point.isAnomaly && styles.anomalyValue]}>
                  {formatCurrency(point.value, currency)}
                </Text>
              </View>
            ))
          )}
          {revenueTrendWithAnomalies.some((point) => point.isAnomaly) && (
            <Text style={styles.anomalyNote}>⚠️ flagged points are statistical outliers vs. the rest of the trend</Text>
          )}
        </Card>

        <Card style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Cohort Retention</Text>
            <View style={styles.granularityToggle}>
              {(['week', 'month'] as CohortGranularity[]).map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[styles.granularityButton, granularity === option && styles.granularityButtonActive]}
                  onPress={() => handleSetGranularity(option)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: granularity === option }}>
                  <Text
                    style={[
                      styles.granularityButtonText,
                      granularity === option && styles.granularityButtonTextActive,
                    ]}>
                    {option === 'week' ? 'Week' : 'Month'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <CohortChart buckets={cohortBuckets} />
          {cohortBuckets.slice(-4).map((bucket, index, arr) => (
            <View key={bucket.cohortKey} style={[styles.statRow, index === arr.length - 1 && styles.lastRow]}>
              <Text style={styles.statLabel}>{bucket.cohortKey}</Text>
              <Text style={styles.statValue}>
                {bucket.size} signups · {(bucket.retentionRate * 100).toFixed(0)}% retained ·{' '}
                {formatCurrency(bucket.currentMrr, currency)}
              </Text>
            </View>
          ))}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Retention Curve (Day 1 / 7 / 30 / 60 / 90)</Text>
          <RetentionHeatmap points={retentionCurve} />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Revenue vs. Logo Churn (last 30 days)</Text>
          {!churnBreakdown || churnBreakdown.isEmpty ? (
            <Text style={styles.emptyText}>No subscribers active at the start of this period yet.</Text>
          ) : (
            <>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Logo churn (subscribers)</Text>
                <Text style={styles.statValue}>
                  {(churnBreakdown.logoChurnRate * 100).toFixed(1)}% ({churnBreakdown.churnedSubscribers}/
                  {churnBreakdown.startingSubscribers})
                </Text>
              </View>
              <View style={[styles.statRow, styles.lastRow]}>
                <Text style={styles.statLabel}>Revenue churn (MRR)</Text>
                <Text style={styles.statValue}>
                  {(churnBreakdown.revenueChurnRate * 100).toFixed(1)}% (
                  {formatCurrency(churnBreakdown.churnedMrr, currency)})
                </Text>
              </View>
            </>
          )}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Plan Migration</Text>
          <SankeyDiagram flows={planMigrationFlows} />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>LTV by Acquisition Source</Text>
          {ltvBySource.length === 0 ? (
            <Text style={styles.emptyText}>No acquisition source data yet</Text>
          ) : (
            ltvBySource.map((row, index, arr) => (
              <View key={row.acquisitionChannel} style={[styles.statRow, index === arr.length - 1 && styles.lastRow]}>
                <Text style={styles.statLabel}>{row.acquisitionChannel}</Text>
                <Text style={styles.statValue}>
                  {formatCurrency(row.ltv, currency)} LTV · {row.subscriberCount} subs
                </Text>
              </View>
            ))
          )}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Revenue Forecast</Text>
          {report.forecast.map((point, index) => (
            <View
              key={point.label}
              style={[styles.statRow, index === report.forecast.length - 1 && styles.lastRow]}>
              <Text style={styles.statLabel}>{point.label}</Text>
              <Text style={styles.statValue}>
                {formatCurrency(point.expectedRevenue, currency)}
              </Text>
            </View>
          ))}
        </Card>

        <View style={styles.exportContainer}>
          <Button title="Export CSV" onPress={handleExportCSV} variant="secondary" />
          <Button title="Export Cohort CSV" onPress={handleExportCohortCsv} variant="secondary" />
          <Button title="Export Cohort PDF" onPress={handleExportCohortPdf} variant="secondary" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    scrollView: { flex: 1 },
    header: { padding: spacing.lg, paddingBottom: spacing.sm },
    title: { ...typography.h1, color: colors.text.primary },
    subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
    row: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.md,
    },
    metricCard: { flex: 1, alignItems: 'center' },
    metricLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
    metricValue: { ...typography.h2, color: colors.text.primary },
    card: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
    sectionTitle: { ...typography.h3, color: colors.text.primary, marginBottom: spacing.md },
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    lastRow: { borderBottomWidth: 0 },
    statLabel: { ...typography.body, color: colors.textSecondary },
    statValue: { ...typography.body, color: colors.text.primary, fontWeight: '600' },
    emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    exportContainer: { padding: spacing.lg, paddingTop: 0, marginBottom: spacing.xl, gap: spacing.sm },
    loadingText: { ...typography.body, color: colors.textSecondary, padding: spacing.lg },
    rowBetween: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    granularityToggle: { flexDirection: 'row', gap: spacing.xs },
    granularityButton: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    granularityButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    granularityButtonText: { ...typography.caption, color: colors.textSecondary },
    granularityButtonTextActive: { color: colors.text.inverse, fontWeight: '600' },
    anomalyValue: { color: colors.status.warning },
    anomalyNote: { ...typography.caption, color: colors.status.warning, marginTop: spacing.xs },
  });
}

export default AnalyticsDashboard;
