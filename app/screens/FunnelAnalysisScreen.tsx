/**
 * Subscription Funnel Analysis Screen
 *
 * Visualizes subscription conversion funnel showing drop-off
 * rates and conversion rates at each stage.
 *
 * Closes #1148
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { colors, spacing } from '../../src/utils/constants';
import { Card } from '../../src/components/common/Card';
import {
  FunnelQueryResult,
  FunnelStageResult,
} from '../../backend/analytics/query/funnelQueryHandler';

const { width: screenWidth } = Dimensions.get('window');

// Mock data — in production this would come from the query handler via API
const mockFunnelData: FunnelQueryResult = {
  period: '2026-09',
  cohort: null,
  overallConversionRate: 6.0,
  totalVisitors: 10000,
  totalConversions: 600,
  refreshedAt: new Date(),
  stages: [
    { stage: 'visitor', label: 'Visitors', count: 10000, conversionRate: 100, dropOffRate: 0, dropOffCount: 0 },
    { stage: 'signup', label: 'Sign-ups', count: 3000, conversionRate: 30.0, dropOffRate: 70.0, dropOffCount: 7000 },
    { stage: 'trial_started', label: 'Trial Started', count: 2000, conversionRate: 66.67, dropOffRate: 33.33, dropOffCount: 1000 },
    { stage: 'trial_completed', label: 'Trial Completed', count: 1200, conversionRate: 60.0, dropOffRate: 40.0, dropOffCount: 800 },
    { stage: 'paid_conversion', label: 'Paid Conversion', count: 800, conversionRate: 66.67, dropOffRate: 33.33, dropOffCount: 400 },
    { stage: 'retained_30d', label: 'Retained (30d)', count: 600, conversionRate: 75.0, dropOffRate: 25.0, dropOffCount: 200 },
  ],
};

const mockCohortComparison: FunnelQueryResult[] = [
  {
    ...mockFunnelData,
    cohort: 'Organic',
    overallConversionRate: 7.2,
    totalVisitors: 5000,
    totalConversions: 360,
  },
  {
    ...mockFunnelData,
    cohort: 'Paid Ads',
    overallConversionRate: 4.5,
    totalVisitors: 3000,
    totalConversions: 135,
  },
  {
    ...mockFunnelData,
    cohort: 'Referral',
    overallConversionRate: 9.8,
    totalVisitors: 2000,
    totalConversions: 196,
  },
];

const FunnelAnalysisScreen = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [funnelData, setFunnelData] = useState<FunnelQueryResult | null>(null);
  const [cohortData, setCohortData] = useState<FunnelQueryResult[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // In production: const result = await funnelHandler.getAggregatedFunnel();
      // For now, use mock data
      await new Promise((resolve) => setTimeout(resolve, 300));
      setFunnelData(mockFunnelData);
      setCohortData(mockCohortComparison);
    } catch (error) {
      console.error('Failed to fetch funnel data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading funnel analysis...</Text>
      </View>
    );
  }

  if (!funnelData) return null;

  const maxCount = Math.max(...funnelData.stages.map((s) => s.count));

  const getStageColor = (index: number, total: number) => {
    const hue = 240 - (index / total) * 200;
    return `hsl(${hue}, 70%, 55%)`;
  };

  const formatNumber = (n: number) => n.toLocaleString('en-US');

  const renderFunnelStage = (stage: FunnelStageResult, index: number) => {
    const widthPercent = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;
    const stageColor = getStageColor(index, funnelData.stages.length);

    return (
      <View key={stage.stage} style={styles.stageContainer}>
        <View style={styles.stageHeader}>
          <Text style={styles.stageLabel}>{stage.label}</Text>
          <Text style={styles.stageCount}>{formatNumber(stage.count)}</Text>
        </View>

        <View style={styles.barContainer}>
          <View
            style={[
              styles.bar,
              {
                width: `${widthPercent}%`,
                backgroundColor: stageColor,
              },
            ]}
          />
        </View>

        <View style={styles.stageMetrics}>
          <Text style={styles.metricText}>
            Conversion: <Text style={styles.metricBold}>{stage.conversionRate.toFixed(1)}%</Text>
          </Text>
          {index > 0 && (
            <Text style={styles.metricText}>
              Drop-off: <Text style={[styles.metricBold, { color: '#E74C3C' }]}>{stage.dropOffCount.toLocaleString()}</Text>{' '}
              ({stage.dropOffRate.toFixed(1)}%)
            </Text>
          )}
        </View>

        {index < funnelData.stages.length - 1 && (
          <View style={styles.arrowContainer}>
            <Text style={styles.arrow}>↓</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Subscription Funnel</Text>
        <Text style={styles.subtitle}>Conversion Analysis · {funnelData.period}</Text>
      </View>

      {/* Summary */}
      <View style={styles.summaryRow}>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Visitors</Text>
          <Text style={styles.summaryValue}>{formatNumber(funnelData.totalVisitors)}</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Conversions</Text>
          <Text style={styles.summaryValue}>{formatNumber(funnelData.totalConversions)}</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Overall Rate</Text>
          <Text style={[styles.summaryValue, { color: colors.primary }]}>
            {funnelData.overallConversionRate.toFixed(1)}%
          </Text>
        </Card>
      </View>

      {/* Funnel visualization */}
      <Card style={styles.funnelCard}>
        <Text style={styles.cardTitle}>Funnel Stages</Text>
        {funnelData.stages.map((stage, index) => renderFunnelStage(stage, index))}
      </Card>

      {/* Cohort comparison */}
      <Text style={styles.sectionTitle}>Cohort Comparison</Text>
      {cohortData.map((cohort) => (
        <Card key={cohort.cohort} style={styles.cohortCard}>
          <View style={styles.cohortHeader}>
            <Text style={styles.cohortName}>{cohort.cohort}</Text>
            <Text style={styles.cohortConversion}>{cohort.overallConversionRate.toFixed(1)}%</Text>
          </View>

          <View style={styles.cohortBars}>
            {cohort.stages.map((stage, index) => {
              const cohortMax = Math.max(...cohort.stages.map((s) => s.count));
              const widthPercent = cohortMax > 0 ? (stage.count / cohortMax) * 100 : 0;
              const stageColor = getStageColor(index, cohort.stages.length);
              return (
                <View key={stage.stage} style={styles.cohortBarRow}>
                  <Text style={styles.cohortBarLabel}>{stage.label}</Text>
                  <View style={styles.cohortBarTrack}>
                    <View
                      style={[
                        styles.cohortBar,
                        { width: `${widthPercent}%`, backgroundColor: stageColor },
                      ]}
                    />
                  </View>
                  <Text style={styles.cohortBarCount}>{formatNumber(stage.count)}</Text>
                </View>
              );
            })}
          </View>
        </Card>
      ))}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Last refreshed: {funnelData.refreshedAt.toLocaleDateString()}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.textSecondary,
    fontSize: 16,
  },
  header: {
    padding: spacing.xl,
    paddingTop: 60,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  summaryCard: {
    flex: 1,
    padding: spacing.md,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  funnelCard: {
    margin: spacing.lg,
    padding: spacing.lg,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  stageContainer: {
    marginBottom: spacing.sm,
  },
  stageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  stageLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  stageCount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.primary,
  },
  barContainer: {
    width: '100%',
    height: 36,
    backgroundColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 6,
  },
  stageMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  metricText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  metricBold: {
    fontWeight: 'bold',
    color: colors.text,
  },
  arrowContainer: {
    alignItems: 'center',
    marginVertical: 2,
  },
  arrow: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  cohortCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  cohortHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  cohortName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  cohortConversion: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
  },
  cohortBars: {
    gap: 6,
  },
  cohortBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cohortBarLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    width: 90,
  },
  cohortBarTrack: {
    flex: 1,
    height: 12,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  cohortBar: {
    height: '100%',
    borderRadius: 3,
  },
  cohortBarCount: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
    width: 50,
    textAlign: 'right',
  },
  footer: {
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  footerText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});

export default FunnelAnalysisScreen;
