import React, { useEffect, useMemo, useState } from 'react';
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
import { WidgetCustomizationModal } from '../../src/components/analytics/WidgetCustomizationModal';
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
    forecastModel,
    enabledWidgets,
    widgetOrder,
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
    exportSummaryCsv,
    exportSummaryText,
  } = useAnalyticsStore();

  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    compute(subscriptions);
  }, [subscriptions, compute, forecastModel]);

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

  const handleExportSummaryCsv = async () => {
    try {
      const csv = exportSummaryCsv();
      await Share.share({ message: csv, title: 'MRR & ARR Summary Report (CSV)' });
    } catch {
      Alert.alert('Export Failed', 'Could not export summary report');
    }
  };

  const handleExportSummaryText = async () => {
    try {
      const txt = exportSummaryText();
      await Share.share({ message: txt, title: 'MRR & ARR Summary Report (PDF/Text)' });
    } catch {
      Alert.alert('Export Failed', 'Could not export summary report');
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

  const renderWidget = (widgetId: string) => {
    if (!enabledWidgets.includes(widgetId)) return null;

    switch (widgetId) {
      case 'overview':
        return (
          <View key="overview">
            <View style={styles.row}>
              <Card style={styles.metricCard}>
                <View style={styles.badgeRow}>
                  <Text style={styles.metricLabel}>MRR</Text>
                  <View
                    style={[
                      styles.growthBadge,
                      report.mrrGrowthRate >= 0 ? styles.badgeSuccess : styles.badgeDanger,
                    ]}
                  >
                    <Text
                      style={[
                        styles.growthText,
                        report.mrrGrowthRate >= 0 ? styles.textSuccess : styles.textDanger,
                      ]}
                    >
                      {report.mrrGrowthRate >= 0 ? '+' : ''}
                      {report.mrrGrowthRate.toFixed(1)}% MoM
                    </Text>
                  </View>
                </View>
                <Text style={styles.metricValue}>{formatCurrency(report.mrr, currency)}</Text>
              </Card>
              <Card style={styles.metricCard}>
                <View style={styles.badgeRow}>
                  <Text style={styles.metricLabel}>ARR</Text>
                  <View
                    style={[
                      styles.growthBadge,
                      report.arrGrowthRate >= 0 ? styles.badgeSuccess : styles.badgeDanger,
                    ]}
                  >
                    <Text
                      style={[
                        styles.growthText,
                        report.arrGrowthRate >= 0 ? styles.textSuccess : styles.textDanger,
                      ]}
                    >
                      {report.arrGrowthRate >= 0 ? '+' : ''}
                      {report.arrGrowthRate.toFixed(1)}% YoY
                    </Text>
                  </View>
                </View>
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
          </View>
        );

      case 'revenueTrend':
        return (
          <Card key="revenueTrend" style={styles.card}>
            <Text style={styles.sectionTitle}>Revenue Trend (last 6 months)</Text>
            {revenueTrendWithAnomalies.length === 0 ? (
              <Text style={styles.emptyText}>No trend data yet</Text>
            ) : (
              revenueTrendWithAnomalies.map((point, index, arr) => (
                <View
                  key={point.label}
                  style={[styles.statRow, index === arr.length - 1 && styles.lastRow]}
                >
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
              <Text style={styles.anomalyNote}>
                ⚠️ flagged points are statistical outliers vs. the rest of the trend
              </Text>
            )}
          </Card>
        );

      case 'forecast':
        return (
          <Card key="forecast" style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>Revenue Forecast</Text>
              <View style={styles.modelBadge}>
                <Text style={styles.modelBadgeText}>{forecastModel.toUpperCase()} MODEL</Text>
              </View>
            </View>
            {report.forecast.map((point, index) => (
              <View
                key={point.label}
                style={[styles.statRow, index === report.forecast.length - 1 && styles.lastRow]}
              >
                <Text style={styles.statLabel}>{point.label}</Text>
                <View style={styles.forecastRight}>
                  <Text style={styles.statValue}>
                    {formatCurrency(point.expectedRevenue, currency)}
                  </Text>
                  <Text style={styles.forecastRange}>
                    ({formatCurrency(point.lowerBound, currency)} -{' '}
                    {formatCurrency(point.upperBound, currency)})
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        );

      case 'cohortHeatmap':
        return (
          <View key="cohortHeatmap">
            <Card style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.sectionTitle}>Cohort Retention</Text>
                <View style={styles.granularityToggle}>
                  {(['week', 'month'] as CohortGranularity[]).map((option) => (
                    <TouchableOpacity
                      key={option}
                      style={[
                        styles.granularityButton,
                        granularity === option && styles.granularityButtonActive,
                      ]}
                      onPress={() => handleSetGranularity(option)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: granularity === option }}
                    >
                      <Text
                        style={[
                          styles.granularityButtonText,
                          granularity === option && styles.granularityButtonTextActive,
                        ]}
                      >
                        {option === 'week' ? 'Week' : 'Month'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <CohortChart buckets={cohortBuckets} />
              {cohortBuckets.slice(-4).map((bucket, index, arr) => (
                <View
                  key={bucket.cohortKey}
                  style={[styles.statRow, index === arr.length - 1 && styles.lastRow]}
                >
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
          </View>
        );

      case 'churnBreakdown':
        return (
          <Card key="churnBreakdown" style={styles.card}>
            <Text style={styles.sectionTitle}>Revenue vs. Logo Churn (last 30 days)</Text>
            {!churnBreakdown || churnBreakdown.isEmpty ? (
              <Text style={styles.emptyText}>
                No subscribers active at the start of this period yet.
              </Text>
            ) : (
              <>
                <View style={styles.statRow}>
                  <Text style={styles.statLabel}>Logo churn (subscribers)</Text>
                  <Text style={styles.statValue}>
                    {(churnBreakdown.logoChurnRate * 100).toFixed(1)}% ({churnBreakdown.churnedSubscribers}
                    /{churnBreakdown.startingSubscribers})
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
        );

      case 'planMigrations':
        return (
          <Card key="planMigrations" style={styles.card}>
            <Text style={styles.sectionTitle}>Plan Migration & LTV by Channel</Text>
            <SankeyDiagram flows={planMigrationFlows} />
            <View style={styles.separator} />
            <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>
              LTV by Acquisition Source
            </Text>
            {ltvBySource.length === 0 ? (
              <Text style={styles.emptyText}>No acquisition source data yet</Text>
            ) : (
              ltvBySource.map((row, index, arr) => (
                <View
                  key={row.acquisitionChannel}
                  style={[styles.statRow, index === arr.length - 1 && styles.lastRow]}
                >
                  <Text style={styles.statLabel}>{row.acquisitionChannel}</Text>
                  <Text style={styles.statValue}>
                    {formatCurrency(row.ltv, currency)} LTV · {row.subscriberCount} subs
                  </Text>
                </View>
              ))
            )}
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Analytics Dashboard</Text>
            <Text style={styles.subtitle}>
              {report.subscriberCount} active subscriber
              {report.subscriberCount !== 1 ? 's' : ''}
            </Text>
          </View>
          <TouchableOpacity style={styles.customizeBtn} onPress={() => setModalVisible(true)}>
            <Text style={styles.customizeBtnText}>⚙️ Customize</Text>
          </TouchableOpacity>
        </View>

        {widgetOrder.map((widgetId) => renderWidget(widgetId))}

        <View style={styles.exportContainer}>
          <Text style={styles.exportTitle}>📥 Export Reports</Text>
          <View style={styles.exportGrid}>
            <View style={styles.exportCol}>
              <Button title="MRR/ARR Summary (CSV)" onPress={handleExportSummaryCsv} variant="primary" />
            </View>
            <View style={styles.exportCol}>
              <Button title="MRR/ARR Summary (PDF)" onPress={handleExportSummaryText} variant="secondary" />
            </View>
          </View>
          <View style={styles.exportGrid}>
            <View style={styles.exportCol}>
              <Button title="Cohort Report (CSV)" onPress={handleExportCohortCsv} variant="secondary" />
            </View>
            <View style={styles.exportCol}>
              <Button title="Cohort Report (PDF)" onPress={handleExportCohortPdf} variant="secondary" />
            </View>
          </View>
          <Button title="Raw Subscriptions Export" onPress={handleExportCSV} variant="secondary" />
        </View>
      </ScrollView>

      <WidgetCustomizationModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />
    </SafeAreaView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    scrollView: { flex: 1 },
    header: {
      padding: spacing.lg,
      paddingBottom: spacing.sm,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: { ...typography.h1, color: colors.text.primary },
    subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
    customizeBtn: {
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    customizeBtnText: {
      ...typography.caption,
      color: colors.text.primary,
      fontWeight: '700',
    },
    row: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.md,
    },
    metricCard: { flex: 1, padding: spacing.md },
    badgeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.xs,
    },
    metricLabel: { ...typography.caption, color: colors.textSecondary },
    growthBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 10,
    },
    badgeSuccess: { backgroundColor: 'rgba(16, 185, 129, 0.15)' },
    badgeDanger: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
    growthText: { fontSize: 10, fontWeight: '700' },
    textSuccess: { color: '#10B981' },
    textDanger: { color: '#EF4444' },
    metricValue: { ...typography.h2, color: colors.text.primary },
    card: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.md },
    sectionTitle: { ...typography.h3, color: colors.text.primary, marginBottom: spacing.md },
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    lastRow: { borderBottomWidth: 0 },
    statLabel: { ...typography.body, color: colors.textSecondary },
    statValue: { ...typography.body, color: colors.text.primary, fontWeight: '600' },
    forecastRight: { alignItems: 'flex-end' },
    forecastRange: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
    emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    exportContainer: {
      padding: spacing.lg,
      marginBottom: spacing.xxl,
      backgroundColor: colors.surface,
      marginHorizontal: spacing.lg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border.default,
      gap: spacing.sm,
    },
    exportTitle: { ...typography.h3, color: colors.text.primary, marginBottom: spacing.xs },
    exportGrid: { flexDirection: 'row', gap: spacing.sm },
    exportCol: { flex: 1 },
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
    modelBadge: {
      backgroundColor: 'rgba(59, 130, 246, 0.15)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
    },
    modelBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: '#3B82F6',
    },
    anomalyValue: { color: colors.status.warning },
    anomalyNote: { ...typography.caption, color: colors.status.warning, marginTop: spacing.xs },
    separator: {
      height: 1,
      backgroundColor: colors.border.default,
      marginVertical: spacing.md,
    },
  });
}

export default AnalyticsDashboard;
