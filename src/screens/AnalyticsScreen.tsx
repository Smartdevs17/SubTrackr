import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import Svg, { Rect, Text as SvgText, Line, G } from 'react-native-svg';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSubscriptionStore } from '../store';
import { SubscriptionCategory, BillingCycle } from '../types/subscription';
import { Card } from '../components/common/Card';

const { width: screenWidth } = Dimensions.get('window');
const CHART_WIDTH = screenWidth - spacing.xl * 2;
const CHART_HEIGHT = 200;
type DateRange = 'week' | 'month' | 'year';

const AnalyticsScreen: React.FC = () => {
  const { subscriptions, stats, calculateStats } = useSubscriptionStore();
  const [dateRange, setDateRange] = useState<DateRange>('month');

  useEffect(() => {
    calculateStats();
  }, [subscriptions, calculateStats]);

  const categoryData = useMemo(() => {
    const categories = Object.values(SubscriptionCategory);
    return categories
      .map((cat) => ({
        category: cat,
        count: stats.categoryBreakdown[cat] || 0,
        percentage:
          stats.totalActive > 0
            ? ((stats.categoryBreakdown[cat] || 0) / stats.totalActive) * 100
            : 0,
      }))
      .filter((d) => d.count > 0);
  }, [stats]);

  const monthlyData = useMemo(() => {
    if (!subscriptions?.length)
      return [
        { month: 'Jan', amount: 0 },
        { month: 'Feb', amount: 0 },
        { month: 'Mar', amount: 0 },
        { month: 'Apr', amount: 0 },
        { month: 'May', amount: 0 },
        { month: 'Jun', amount: 0 },
      ];
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const currentMonth = new Date().getMonth();
    const dataMonths =
      dateRange === 'week'
        ? ['Week 1', 'Week 2', 'Week 3', 'Week 4']
        : dateRange === 'month'
          ? months.slice(0, currentMonth + 1)
          : months;
    return dataMonths.map((month, index) => {
      let total = 0;
      subscriptions?.forEach((sub) => {
        if (sub.isActive) {
          const createdAt = new Date(sub.createdAt);
          const monthIndex =
            dateRange === 'week' ? Math.floor(createdAt.getDate() / 7) : createdAt.getMonth();
          if (dateRange === 'year' || monthIndex === index) {
            if (sub.billingCycle === BillingCycle.MONTHLY) total += sub.price;
            else if (sub.billingCycle === BillingCycle.YEARLY) total += sub.price / 12;
            else if (sub.billingCycle === BillingCycle.WEEKLY) total += sub.price * 4;
          }
        }
      });
      return { month, amount: total };
    });
  }, [subscriptions, dateRange]);

  const maxAmount = Math.max(...monthlyData.map((d) => d.amount), 100);
  const barWidth = (CHART_WIDTH - 40) / Math.max(monthlyData.length, 1) - 8;

  const getCategoryIcon = (category: SubscriptionCategory): string => {
    const icons: Record<SubscriptionCategory, string> = {
      [SubscriptionCategory.STREAMING]: '🎬',
      [SubscriptionCategory.SOFTWARE]: '💻',
      [SubscriptionCategory.GAMING]: '🎮',
      [SubscriptionCategory.PRODUCTIVITY]: '📊',
      [SubscriptionCategory.FITNESS]: '💪',
      [SubscriptionCategory.EDUCATION]: '📚',
      [SubscriptionCategory.FINANCE]: '💰',
      [SubscriptionCategory.OTHER]: '📦',
    };
    return icons[category] || '📦';
  };

  const getCategoryColor = (category: SubscriptionCategory): string => {
    const categoryColors: Record<SubscriptionCategory, string> = {
      [SubscriptionCategory.STREAMING]: '#E91E63',
      [SubscriptionCategory.SOFTWARE]: '#2196F3',
      [SubscriptionCategory.GAMING]: '#9C27B0',
      [SubscriptionCategory.PRODUCTIVITY]: '#4CAF50',
      [SubscriptionCategory.FITNESS]: '#FF9800',
      [SubscriptionCategory.EDUCATION]: '#00BCD4',
      [SubscriptionCategory.FINANCE]: '#FFD700',
      [SubscriptionCategory.OTHER]: '#607D8B',
    };
    return categoryColors[category] || '#607D8B';
  };

  if (!subscriptions?.length) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={styles.emptyTitle}>No Data Yet</Text>
          <Text style={styles.emptyText}>
            Add some subscriptions to see your spending analytics
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Analytics</Text>
          <Text style={styles.subtitle}>Your spending insights</Text>
        </View>
        <View style={styles.dateRangeContainer} accessibilityRole="tablist">
          {(['week', 'month', 'year'] as DateRange[]).map((range) => (
            <TouchableOpacity
              key={range}
              style={[styles.dateRangeButton, dateRange === range && styles.dateRangeButtonActive]}
              onPress={() => setDateRange(range)}
              accessibilityRole="tab"
              accessibilityLabel={`${range.charAt(0).toUpperCase() + range.slice(1)} view`}
              accessibilityState={{ selected: dateRange === range }}>
              <Text
                style={[
                  styles.dateRangeButtonText,
                  dateRange === range && styles.dateRangeButtonTextActive,
                ]}>
                {range.charAt(0).toUpperCase() + range.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.summaryContainer}>
          <Card style={styles.summaryCard}>
            <Text
              style={styles.summaryLabel}
              accessibilityElementsHidden={true}
              importantForAccessibility="no">
              Monthly Spend
            </Text>
            <Text
              style={styles.summaryValue}
              accessibilityElementsHidden={true}
              importantForAccessibility="no">
              ${stats.totalMonthlySpend.toFixed(2)}
            </Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text
              style={styles.summaryLabel}
              accessibilityElementsHidden={true}
              importantForAccessibility="no">
              Yearly Estimate
            </Text>
            <Text
              style={styles.summaryValue}
              accessibilityElementsHidden={true}
              importantForAccessibility="no">
              ${stats.totalYearlySpend.toFixed(2)}
            </Text>
          </Card>
        </View>
        <Card style={styles.chartCard}>
          <Text style={styles.chartTitle}>
            {dateRange === 'week' ? 'Weekly' : dateRange === 'month' ? 'Monthly' : 'Yearly'}{' '}
            Spending
          </Text>
          <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
            <Line
              x1={30}
              y1={10}
              x2={30}
              y2={CHART_HEIGHT - 30}
              stroke={colors.border}
              strokeWidth={1}
            />
            <Line
              x1={30}
              y1={CHART_HEIGHT - 30}
              x2={CHART_WIDTH - 10}
              y2={CHART_HEIGHT - 30}
              stroke={colors.border}
              strokeWidth={1}
            />
            {monthlyData.map((data, index) => {
              const barHeight = (data.amount / maxAmount) * (CHART_HEIGHT - 60);
              const x = 35 + index * (barWidth + 8);
              const y = CHART_HEIGHT - 30 - barHeight;
              return (
                <G key={data.month}>
                  <Rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    fill={colors.primary}
                    rx={4}
                  />
                  <SvgText
                    x={x + barWidth / 2}
                    y={CHART_HEIGHT - 15}
                    fontSize={10}
                    fill={colors.textSecondary}
                    textAnchor="middle">
                    {data.month}
                  </SvgText>
                  {data.amount > 0 && (
                    <SvgText
                      x={x + barWidth / 2}
                      y={y - 5}
                      fontSize={10}
                      fill={colors.text}
                      textAnchor="middle">
                      ${data.amount.toFixed(0)}
                    </SvgText>
                  )}
                </G>
              );
            })}
          </Svg>
        </Card>
        <Card style={styles.chartCard}>
          <Text style={styles.chartTitle}>Category Breakdown</Text>
          {categoryData.length > 0 ? (
            categoryData.map((data) => (
              <View key={data.category} style={styles.categoryItem}>
                <View style={styles.categoryLeft}>
                  <Text style={styles.categoryIcon}>{getCategoryIcon(data.category)}</Text>
                  <Text style={styles.categoryName}>
                    {data.category.charAt(0).toUpperCase() + data.category.slice(1)}
                  </Text>
                </View>
                <View style={styles.categoryRight}>
                  <Text style={styles.categoryCount}>{data.count}</Text>
                  <Text style={styles.categoryPercentage}>{data.percentage.toFixed(1)}%</Text>
                </View>
                <View style={styles.categoryBarContainer}>
                  <View
                    style={[
                      styles.categoryBar,
                      {
                        width: `${data.percentage}%`,
                        backgroundColor: getCategoryColor(data.category),
                      },
                    ]}
                  />
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.noDataText}>No subscription data available</Text>
          )}
        </Card>
        <Card style={styles.projectionCard}>
          <Text style={styles.chartTitle}>Upcoming Renewals</Text>
          <View style={styles.projectionItem}>
            <Text style={styles.projectionLabel}>Next 30 Days</Text>
            <Text style={styles.projectionValue}>${stats.totalMonthlySpend.toFixed(2)}</Text>
          </View>
          <View style={styles.projectionItem}>
            <Text style={styles.projectionLabel}>Next 90 Days</Text>
            <Text style={styles.projectionValue}>${(stats.totalMonthlySpend * 3).toFixed(2)}</Text>
          </View>
          <View style={[styles.projectionItem, styles.projectionItemLast]}>
            <Text style={styles.projectionLabel}>Next 12 Months</Text>
            <Text style={styles.projectionValue}>${stats.totalYearlySpend.toFixed(2)}</Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  header: { padding: spacing.lg, paddingBottom: spacing.md },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary },
  dateRangeContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  dateRangeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  dateRangeButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateRangeButtonText: { ...typography.body, color: colors.text },
  dateRangeButtonTextActive: { color: colors.text, fontWeight: '600' },
  summaryContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  summaryCard: { flex: 1, alignItems: 'center' },
  summaryLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  summaryValue: { ...typography.h2, color: colors.text },
  chartCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  chartTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
  categoryList: { gap: spacing.md },
  categoryItem: { marginBottom: spacing.sm },
  categoryLeft: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  categoryIcon: { fontSize: 20, marginRight: spacing.sm },
  categoryName: { ...typography.body, color: colors.text, flex: 1 },
  categoryRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  categoryCount: { ...typography.body, color: colors.text, fontWeight: '600' },
  categoryPercentage: {
    ...typography.caption,
    color: colors.textSecondary,
    width: 50,
    textAlign: 'right',
  },
  categoryBarContainer: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  categoryBar: { height: '100%', borderRadius: borderRadius.full },
  noDataText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  projectionCard: { marginHorizontal: spacing.lg, marginBottom: spacing.lg },
  projectionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  projectionItemLast: { borderBottomWidth: 0 },
  projectionLabel: { ...typography.body, color: colors.textSecondary },
  projectionValue: { ...typography.body, color: colors.text, fontWeight: '600' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emptyIcon: { fontSize: 64, marginBottom: spacing.md },
  emptyTitle: { ...typography.h2, color: colors.text, marginBottom: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});

export default AnalyticsScreen;
