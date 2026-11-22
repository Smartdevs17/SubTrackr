/**
 * CLV Prediction Screen
 *
 * Displays Customer Lifetime Value predictions using the
 * BG/NBD-inspired hybrid prediction model.
 *
 * Closes #1147
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  FlatList,
} from 'react-native';
import { colors, spacing } from '../../src/utils/constants';
import { Card } from '../../src/components/common/Card';
import {
  CLVPredictionService,
  CLVInput,
  CLVPredictionResult,
} from '../../backend/services/analytics/clvPredictionService';

interface CustomerData {
  userId: string;
  transactionCount: number;
  totalRevenue: number;
  daysSinceFirstPurchase: number;
  daysSinceLastPurchase: number;
  averageOrderValue: number;
}

const CLVPredictionScreen = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [predictions, setPredictions] = useState<CLVPredictionResult[]>([]);
  const [segments, setSegments] = useState<
    { tier: string; customers: CLVPredictionResult[]; totalCLV: number }[]
  >([]);

  const service = new CLVPredictionService();

  const fetchPredictions = useCallback(async () => {
    setLoading(true);
    try {
      // Mock customer data — in production this would come from the store/API
      const mockCustomers: CustomerData[] = [
        { userId: 'cust-001', transactionCount: 24, totalRevenue: 2400, daysSinceFirstPurchase: 720, daysSinceLastPurchase: 3, averageOrderValue: 100 },
        { userId: 'cust-002', transactionCount: 8, totalRevenue: 960, daysSinceFirstPurchase: 240, daysSinceLastPurchase: 30, averageOrderValue: 120 },
        { userId: 'cust-003', transactionCount: 36, totalRevenue: 5400, daysSinceFirstPurchase: 1080, daysSinceLastPurchase: 1, averageOrderValue: 150 },
        { userId: 'cust-004', transactionCount: 2, totalRevenue: 200, daysSinceFirstPurchase: 180, daysSinceLastPurchase: 170, averageOrderValue: 100 },
        { userId: 'cust-005', transactionCount: 15, totalRevenue: 2250, daysSinceFirstPurchase: 450, daysSinceLastPurchase: 7, averageOrderValue: 150 },
      ];

      const inputs: CLVInput[] = mockCustomers.map((c) => ({
        userId: c.userId,
        transactionCount: c.transactionCount,
        totalRevenue: c.totalRevenue,
        daysSinceFirstPurchase: c.daysSinceFirstPurchase,
        daysSinceLastPurchase: c.daysSinceLastPurchase,
        averageOrderValue: c.averageOrderValue,
      }));

      const results = service.predictCLVBatch(inputs);
      setPredictions(results);
      setSegments(service.segmentByCLV(results));
    } catch (error) {
      console.error('Failed to fetch CLV predictions:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPredictions();
  }, [fetchPredictions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPredictions();
    setRefreshing(false);
  }, [fetchPredictions]);

  const formatCurrency = (value: number) =>
    `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'VIP':
        return '#6C5CE7';
      case 'Growth':
        return '#00B894';
      case 'Standard':
        return '#74B9FF';
      default:
        return colors.textSecondary;
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Computing CLV predictions...</Text>
      </View>
    );
  }

  const totalCLV = predictions.reduce((sum, p) => sum + p.predictedCLV, 0);
  const avgCLV = predictions.length > 0 ? totalCLV / predictions.length : 0;

  const renderPredictionCard = ({ item }: { item: CLVPredictionResult }) => (
    <Card style={styles.predictionCard}>
      <View style={styles.predictionHeader}>
        <Text style={styles.customerId}>{item.userId}</Text>
        <View style={[styles.tierBadge, { backgroundColor: `${getTierColor(findTier(item))}20` }]}>
          <Text style={[styles.tierText, { color: getTierColor(findTier(item)) }]}>
            {findTier(item)}
          </Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Predicted CLV</Text>
          <Text style={styles.metricValue}>{formatCurrency(item.predictedCLV)}</Text>
          <Text style={styles.confidenceText}>
            {formatCurrency(item.confidenceInterval.lower)} – {formatCurrency(item.confidenceInterval.upper)}
          </Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Expected Transactions (12M)</Text>
          <Text style={styles.metricValue}>{item.expectedTransactions12M}</Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Monthly Value</Text>
          <Text style={styles.metricValue}>{formatCurrency(item.expectedMonthlyValue)}</Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Predicted Lifespan</Text>
          <Text style={styles.metricValue}>{item.predictedLifespanMonths} mo</Text>
        </View>
      </View>

      <View style={styles.churnRow}>
        <Text style={styles.churnLabel}>Churn Probability</Text>
        <View style={styles.churnBar}>
          <View
            style={[
              styles.churnFill,
              { width: `${item.churnProbability * 100}%`, backgroundColor: getChurnColor(item.churnProbability) },
            ]}
          />
        </View>
        <Text style={styles.churnValue}>{(item.churnProbability * 100).toFixed(1)}%</Text>
      </View>
    </Card>
  );

  const findTier = (pred: CLVPredictionResult): string => {
    for (const seg of segments) {
      if (seg.customers.some((c) => c.userId === pred.userId)) {
        return seg.tier;
      }
    }
    return 'Standard';
  };

  const getChurnColor = (prob: number) => {
    if (prob > 0.7) return '#E74C3C';
    if (prob > 0.4) return '#F39C12';
    return '#27AE60';
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Customer Lifetime Value</Text>
        <Text style={styles.subtitle}>BG/NBD-Inspired Prediction Model</Text>
      </View>

      {/* Summary cards */}
      <View style={styles.summaryRow}>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Predicted CLV</Text>
          <Text style={styles.summaryValue}>{formatCurrency(totalCLV)}</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Average CLV</Text>
          <Text style={styles.summaryValue}>{formatCurrency(avgCLV)}</Text>
        </Card>
      </View>

      {/* Segment overview */}
      {segments.map((seg) => (
        <Card key={seg.tier} style={styles.segmentCard}>
          <View style={styles.segmentHeader}>
            <View style={[styles.tierDot, { backgroundColor: getTierColor(seg.tier) }]} />
            <Text style={styles.segmentTier}>{seg.tier}</Text>
            <Text style={styles.segmentCount}>{seg.customers.length} customers</Text>
            <Text style={styles.segmentCLV}>{formatCurrency(seg.totalCLV)}</Text>
          </View>
        </Card>
      ))}

      {/* Individual predictions */}
      <Text style={styles.sectionTitle}>Individual Predictions</Text>
      <FlatList
        data={predictions}
        renderItem={renderPredictionCard}
        keyExtractor={(item) => item.userId}
        scrollEnabled={false}
        contentContainerStyle={styles.listContainer}
      />
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
    gap: spacing.md,
  },
  summaryCard: {
    flex: 1,
    padding: spacing.md,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
  },
  segmentCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  segmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tierDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  segmentTier: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  segmentCount: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  segmentCLV: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.primary,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  listContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  predictionCard: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  predictionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  customerId: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  tierBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tierText: {
    fontSize: 12,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  metricBox: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  confidenceText: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  churnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  churnLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  churnBar: {
    flex: 1,
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  churnFill: {
    height: '100%',
    borderRadius: 4,
  },
  churnValue: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    minWidth: 40,
    textAlign: 'right',
  },
});

export default CLVPredictionScreen;
