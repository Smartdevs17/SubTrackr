/**
 * Subscription Health Score Screen
 *
 * Displays composite health scores (0-100) for subscriptions
 * with factor breakdowns and recommendations.
 *
 * Closes #1150
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
  HealthScoreService,
  HealthScoreInput,
  HealthScoreResult,
  HealthScoreSummary,
  HealthFactor,
} from '../../backend/services/analytics/healthScoreService';

// Mock subscription data — in production, fetched from store/API
const mockInputs: HealthScoreInput[] = [
  { subscriptionId: 'sub-001', userId: 'user-001', planName: 'Pro', totalPayments: 12, failedPayments: 0, monthlyActiveDays: 25, totalDaysInPeriod: 30, subscriptionAgeDays: 365, openSupportTickets: 0, totalSupportTickets: 1, planLimit: 10000, currentUsage: 7000, daysSinceLastLogin: 1 },
  { subscriptionId: 'sub-002', userId: 'user-002', planName: 'Basic', totalPayments: 6, failedPayments: 2, monthlyActiveDays: 10, totalDaysInPeriod: 30, subscriptionAgeDays: 180, openSupportTickets: 2, totalSupportTickets: 5, planLimit: 1000, currentUsage: 100, daysSinceLastLogin: 20 },
  { subscriptionId: 'sub-003', userId: 'user-003', planName: 'Pro', totalPayments: 24, failedPayments: 1, monthlyActiveDays: 20, totalDaysInPeriod: 30, subscriptionAgeDays: 720, openSupportTickets: 0, totalSupportTickets: 2, planLimit: 10000, currentUsage: 8500, daysSinceLastLogin: 3 },
  { subscriptionId: 'sub-004', userId: 'user-004', planName: 'Basic', totalPayments: 3, failedPayments: 3, monthlyActiveDays: 2, totalDaysInPeriod: 30, subscriptionAgeDays: 30, openSupportTickets: 5, totalSupportTickets: 10, planLimit: 1000, currentUsage: 50, daysSinceLastLogin: 45 },
  { subscriptionId: 'sub-005', userId: 'user-005', planName: 'Enterprise', totalPayments: 18, failedPayments: 0, monthlyActiveDays: 28, totalDaysInPeriod: 30, subscriptionAgeDays: 540, openSupportTickets: 1, totalSupportTickets: 3, planLimit: 100000, currentUsage: 65000, daysSinceLastLogin: 1 },
];

const SubscriptionHealthScreen = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scores, setScores] = useState<HealthScoreResult[]>([]);
  const [summary, setSummary] = useState<HealthScoreSummary | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const service = new HealthScoreService();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const results = service.computeBatch(mockInputs);
      const summaryResult = service.generateSummary(results);
      setScores(results);
      setSummary(summaryResult);
    } catch (error) {
      console.error('Failed to compute health scores:', error);
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

  if (loading || !summary) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Computing health scores...</Text>
      </View>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 75) return '#27AE60';
    if (score >= 60) return '#F39C12';
    if (score >= 40) return '#E67E22';
    return '#E74C3C';
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A': return '#27AE60';
      case 'B': return '#2ECC71';
      case 'C': return '#F39C12';
      case 'D': return '#E67E22';
      case 'F': return '#E74C3C';
      default: return colors.textSecondary;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return '#27AE60';
      case 'at-risk': return '#F39C12';
      case 'critical': return '#E67E22';
      case 'churning': return '#E74C3C';
      default: return colors.textSecondary;
    }
  };

  const getFactorStatusColor = (status: string) => {
    switch (status) {
      case 'excellent': return '#27AE60';
      case 'good': return '#2ECC71';
      case 'fair': return '#F39C12';
      case 'poor': return '#E67E22';
      case 'critical': return '#E74C3C';
      default: return colors.textSecondary;
    }
  };

  const renderScoreCard = ({ item }: { item: HealthScoreResult }) => {
    const isExpanded = expandedId === item.subscriptionId;
    const scoreColor = getScoreColor(item.overallScore);

    return (
      <Card style={styles.scoreCard}>
        {/* Header row */}
        <TouchableOpacity
          style={styles.cardHeader}
          onPress={() => setExpandedId(isExpanded ? null : item.subscriptionId)}
          activeOpacity={0.7}
        >
          {/* Score circle */}
          <View style={[styles.scoreCircle, { borderColor: scoreColor }]}>
            <Text style={[styles.scoreNumber, { color: scoreColor }]}>{item.overallScore}</Text>
          </View>

          {/* Subscription info */}
          <View style={styles.subInfo}>
            <Text style={styles.subId}>{item.subscriptionId}</Text>
            <Text style={styles.subPlan}>{item.planName} · {item.userId}</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.gradeBadge, { backgroundColor: `${getGradeColor(item.grade)}20` }]}>
                <Text style={[styles.gradeText, { color: getGradeColor(item.grade) }]}>Grade {item.grade}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: `${getStatusColor(item.status)}20` }]}>
                <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
                  {item.status.replace('-', ' ')}
                </Text>
              </View>
            </View>
          </View>

          {/* Expand indicator */}
          <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {/* Expanded details */}
        {isExpanded && (
          <View style={styles.expandedSection}>
            {/* Factor breakdown */}
            <Text style={styles.expandedTitle}>Health Factors</Text>
            {item.factors.map((factor: HealthFactor, index: number) => (
              <View key={index} style={styles.factorRow}>
                <View style={styles.factorHeader}>
                  <Text style={styles.factorName}>{factor.name}</Text>
                  <Text style={[styles.factorScore, { color: getFactorStatusColor(factor.status) }]}>
                    {factor.score}/100
                  </Text>
                </View>
                <View style={styles.factorBarContainer}>
                  <View
                    style={[
                      styles.factorBar,
                      {
                        width: `${factor.score}%`,
                        backgroundColor: getFactorStatusColor(factor.status),
                      },
                    ]}
                  />
                </View>
                <Text style={styles.factorDetail}>{factor.detail}</Text>
                <Text style={styles.factorWeight}>Weight: {(factor.weight * 100).toFixed(0)}%</Text>
              </View>
            ))}

            {/* Recommendation */}
            <View style={styles.recommendationBox}>
              <Text style={styles.recommendationLabel}>💡 Recommendation</Text>
              <Text style={styles.recommendationText}>{item.recommendation}</Text>
            </View>
          </View>
        )}
      </Card>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Subscription Health</Text>
        <Text style={styles.subtitle}>Composite health score analysis</Text>
      </View>

      {/* Summary */}
      <View style={styles.summaryRow}>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Avg Score</Text>
          <Text style={[styles.summaryValue, { color: getScoreColor(summary.averageScore) }]}>
            {summary.averageScore}
          </Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Healthy</Text>
          <Text style={[styles.summaryValue, { color: '#27AE60' }]}>{summary.healthyCount}</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>At Risk</Text>
          <Text style={[styles.summaryValue, { color: '#F39C12' }]}>{summary.atRiskCount}</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Critical</Text>
          <Text style={[styles.summaryValue, { color: '#E74C3C' }]}>{summary.criticalCount}</Text>
        </Card>
      </View>

      {/* Grade distribution */}
      <Card style={styles.distributionCard}>
        <Text style={styles.cardTitle}>Grade Distribution</Text>
        <View style={styles.gradeRow}>
          {['A', 'B', 'C', 'D', 'F'].map((grade) => {
            const count = summary.gradeDistribution[grade] || 0;
            return (
              <View key={grade} style={styles.gradeItem}>
                <View style={[styles.gradeCircle, { backgroundColor: getGradeColor(grade) }]}>
                  <Text style={styles.gradeCircleText}>{grade}</Text>
                </View>
                <Text style={styles.gradeCount}>{count}</Text>
              </View>
            );
          })}
        </View>
      </Card>

      {/* Individual scores */}
      <Text style={styles.sectionTitle}>Subscriptions ({summary.totalSubscriptions})</Text>
      <FlatList
        data={scores}
        renderItem={renderScoreCard}
        keyExtractor={(item) => item.subscriptionId}
        scrollEnabled={false}
        contentContainerStyle={styles.listContainer}
      />
    </ScrollView>
  );
};

// Need TouchableOpacity import
import { TouchableOpacity } from 'react-native';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: spacing.md, color: colors.textSecondary, fontSize: 16 },
  header: { padding: spacing.xl, paddingTop: 60, backgroundColor: colors.surface },
  title: { fontSize: 28, fontWeight: 'bold', color: colors.text },
  subtitle: { fontSize: 16, color: colors.textSecondary, marginTop: 4 },
  summaryRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.sm },
  summaryCard: { flex: 1, padding: spacing.sm, alignItems: 'center' },
  summaryLabel: { fontSize: 10, color: colors.textSecondary, marginBottom: 2 },
  summaryValue: { fontSize: 22, fontWeight: 'bold' },
  distributionCard: { marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: colors.text, marginBottom: spacing.md },
  gradeRow: { flexDirection: 'row', justifyContent: 'space-around' },
  gradeItem: { alignItems: 'center' },
  gradeCircle: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  gradeCircleText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  gradeCount: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: colors.text, paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  listContainer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  scoreCard: { marginBottom: spacing.md, padding: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  scoreCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 3, justifyContent: 'center', alignItems: 'center' },
  scoreNumber: { fontSize: 22, fontWeight: 'bold' },
  subInfo: { flex: 1, marginLeft: spacing.md },
  subId: { fontSize: 16, fontWeight: '600', color: colors.text },
  subPlan: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  badgeRow: { flexDirection: 'row', gap: 6 },
  gradeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  gradeText: { fontSize: 11, fontWeight: '700' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  expandIcon: { fontSize: 12, color: colors.textSecondary },
  expandedSection: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  expandedTitle: { fontSize: 14, fontWeight: 'bold', color: colors.text, marginBottom: spacing.sm },
  factorRow: { marginBottom: spacing.md },
  factorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  factorName: { fontSize: 13, fontWeight: '600', color: colors.text },
  factorScore: { fontSize: 13, fontWeight: 'bold' },
  factorBarContainer: { width: '100%', height: 8, backgroundColor: colors.border, borderRadius: 4, marginTop: 4, overflow: 'hidden' },
  factorBar: { height: '100%', borderRadius: 4 },
  factorDetail: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  factorWeight: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  recommendationBox: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: 8, marginTop: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.primary },
  recommendationLabel: { fontSize: 13, fontWeight: 'bold', color: colors.text, marginBottom: 4 },
  recommendationText: { fontSize: 12, color: colors.textSecondary, lineHeight: 18 },
});

export default SubscriptionHealthScreen;
