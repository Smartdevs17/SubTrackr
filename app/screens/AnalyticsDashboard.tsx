import React, { useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Share,
  Alert,
} from 'react-native';
import { useSubscriptionStore } from '../../src/store/subscriptionStore';
import { useAnalyticsStore } from '../stores/analyticsStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import { Card } from '../../src/components/common/Card';
import { Button } from '../../src/components/common/Button';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { spacing, typography } from '../../src/utils/constants';
import { formatCurrency } from '../../src/utils/formatting';

const AnalyticsDashboard: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { subscriptions } = useSubscriptionStore();
  const { preferredCurrency } = useSettingsStore();
  const { report, compute, exportCSV } = useAnalyticsStore();

  useEffect(() => {
    compute(subscriptions);
  }, [subscriptions, compute]);

  const handleExportCSV = async () => {
    try {
      const csv = exportCSV(subscriptions);
      await Share.share({ message: csv, title: 'Subscriptions Export' });
    } catch {
      Alert.alert('Export Failed', 'Could not export analytics data');
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
          {report.revenueTrend.length === 0 ? (
            <Text style={styles.emptyText}>No trend data yet</Text>
          ) : (
            report.revenueTrend.map((point, index) => (
              <View
                key={point.label}
                style={[
                  styles.statRow,
                  index === report.revenueTrend.length - 1 && styles.lastRow,
                ]}>
                <Text style={styles.statLabel}>{point.label}</Text>
                <Text style={styles.statValue}>{formatCurrency(point.mrr, currency)}</Text>
              </View>
            ))
          )}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Cohorts</Text>
          {report.cohorts.length === 0 ? (
            <Text style={styles.emptyText}>No cohort data yet</Text>
          ) : (
            report.cohorts.slice(-4).map((cohort, index, arr) => (
              <View
                key={cohort.cohort}
                style={[styles.statRow, index === arr.length - 1 && styles.lastRow]}>
                <Text style={styles.statLabel}>{cohort.cohort}</Text>
                <Text style={styles.statValue}>
                  {(cohort.retentionRate * 100).toFixed(0)}% retained ·{' '}
                  {formatCurrency(cohort.revenue, currency)}
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
    title: { ...typography.h1, color: colors.text },
    subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
    row: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.md,
    },
    metricCard: { flex: 1, alignItems: 'center' },
    metricLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
    metricValue: { ...typography.h2, color: colors.text },
    card: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
    sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    lastRow: { borderBottomWidth: 0 },
    statLabel: { ...typography.body, color: colors.textSecondary },
    statValue: { ...typography.body, color: colors.text, fontWeight: '600' },
    emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    exportContainer: { padding: spacing.lg, paddingTop: 0, marginBottom: spacing.xl },
    loadingText: { ...typography.body, color: colors.textSecondary, padding: spacing.lg },
  });
}

export default AnalyticsDashboard;
