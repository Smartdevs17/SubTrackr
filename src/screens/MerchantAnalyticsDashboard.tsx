import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Dimensions,
  Share,
} from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSubscriptionStore } from '../store';
import { Card } from '../components/common/Card';
import { MerchantAnalyticsService } from '../services/merchantAnalyticsService';
import { MerchantInsight } from '../types/merchantAnalytics';

const { width: screenWidth } = Dimensions.get('window');
const CHART_WIDTH = screenWidth - spacing.xl * 2;
const CHART_HEIGHT = 180;

type TabType = 'overview' | 'revenue' | 'subscribers' | 'insights' | 'reporting';

const MerchantAnalyticsDashboard: React.FC = () => {
  const { subscriptions } = useSubscriptionStore();
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const dashboardData = useMemo(() => {
    return MerchantAnalyticsService.computeAnalytics(
      'merchant-001',
      'SmartDevs Merchant',
      subscriptions
    );
  }, [subscriptions]);

  const handleExportReport = async (format: 'csv' | 'json') => {
    const reportContent = MerchantAnalyticsService.generateMerchantReport(dashboardData, format);
    try {
      await Share.share({
        message: reportContent,
        title: `Merchant_Analytics_Report.${format}`,
      });
    } catch (err) {
      console.log('Export failed', err);
    }
  };

  const getInsightSeverityStyle = (severity: MerchantInsight['severity']) => {
    switch (severity) {
      case 'warning':
        return { borderColor: '#F59E0B', backgroundColor: 'rgba(245, 158, 11, 0.1)' };
      case 'critical':
        return { borderColor: '#EF4444', backgroundColor: 'rgba(239, 68, 68, 0.1)' };
      case 'success':
        return { borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.1)' };
      default:
        return { borderColor: colors.primary, backgroundColor: 'rgba(99, 102, 241, 0.1)' };
    }
  };

  const maxRevenue = Math.max(
    ...dashboardData.revenue.revenueHistory.map((d) => d.revenue),
    100
  );
  const barWidth =
    (CHART_WIDTH - 40) / Math.max(dashboardData.revenue.revenueHistory.length, 1) - 8;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Merchant Dashboard</Text>
          <Text style={styles.subtitle}>{dashboardData.merchantName} Analytics & Insights</Text>
        </View>

        {/* Navigation Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
          {(['overview', 'revenue', 'subscribers', 'insights', 'reporting'] as TabType[]).map(
            (tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tabItem, activeTab === tab && styles.tabItemActive]}
                onPress={() => setActiveTab(tab)}>
                <Text
                  style={[
                    styles.tabText,
                    activeTab === tab && styles.tabTextActive,
                  ]}>
                  {tab.toUpperCase()}
                </Text>
              </TouchableOpacity>
            )
          )}
        </ScrollView>

        {/* Overview & Key Metrics */}
        {(activeTab === 'overview' || activeTab === 'revenue') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Revenue Analytics</Text>
            <View style={styles.statsGrid}>
              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>MRR</Text>
                <Text style={styles.statValue}>
                  ${dashboardData.revenue.monthlyRecurringRevenue.toFixed(2)}
                </Text>
                <Text style={styles.statSub}>
                  +{dashboardData.revenue.revenueGrowthRate}% MoM
                </Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>ARR</Text>
                <Text style={styles.statValue}>
                  ${dashboardData.revenue.annualRecurringRevenue.toFixed(2)}
                </Text>
                <Text style={styles.statSub}>Annualized</Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>ARPU</Text>
                <Text style={styles.statValue}>
                  ${dashboardData.revenue.averageRevenuePerUser.toFixed(2)}
                </Text>
                <Text style={styles.statSub}>Per Active User</Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Total Revenue</Text>
                <Text style={styles.statValue}>
                  ${dashboardData.revenue.totalRevenue.toFixed(2)}
                </Text>
                <Text style={styles.statSub}>Lifetime Gross</Text>
              </Card>
            </View>

            {/* Revenue Growth Chart */}
            <Card style={styles.chartCard}>
              <Text style={styles.chartTitle}>Revenue Trend</Text>
              <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
                {dashboardData.revenue.revenueHistory.map((d, i) => {
                  const barHeight = (d.revenue / maxRevenue) * (CHART_HEIGHT - 40);
                  const x = 30 + i * (barWidth + 8);
                  const y = CHART_HEIGHT - 30 - barHeight;
                  return (
                    <React.Fragment key={d.period}>
                      <Rect
                        x={x}
                        y={y}
                        width={barWidth}
                        height={Math.max(barHeight, 4)}
                        fill={colors.primary}
                        rx={4}
                      />
                      <SvgText
                        x={x + barWidth / 2}
                        y={CHART_HEIGHT - 10}
                        fill={colors.textSecondary}
                        fontSize={10}
                        textAnchor="middle">
                        {d.period}
                      </SvgText>
                    </React.Fragment>
                  );
                })}
              </Svg>
            </Card>
          </View>
        )}

        {/* Subscriber Analytics */}
        {(activeTab === 'overview' || activeTab === 'subscribers') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Subscriber Analytics</Text>
            <View style={styles.statsGrid}>
              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Total Subscribers</Text>
                <Text style={styles.statValue}>
                  {dashboardData.subscribers.totalSubscribers}
                </Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Active Subscribers</Text>
                <Text style={styles.statValue}>
                  {dashboardData.subscribers.activeSubscribers}
                </Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Churn Rate</Text>
                <Text style={styles.statValue}>
                  {dashboardData.subscribers.churnRate}%
                </Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Growth Rate</Text>
                <Text style={styles.statValue}>
                  +{dashboardData.subscribers.subscriberGrowthRate}%
                </Text>
              </Card>
            </View>

            <Card style={styles.cardSection}>
              <Text style={styles.chartTitle}>Subscriptions by Plan</Text>
              {dashboardData.subscribers.subscribersByPlan.map((plan) => (
                <View key={plan.planId} style={styles.planRow}>
                  <View style={styles.planInfo}>
                    <Text style={styles.planName}>{plan.planName}</Text>
                    <Text style={styles.planMeta}>{plan.count} subscribers</Text>
                  </View>
                  <Text style={styles.planRevenue}>${plan.revenue.toFixed(2)}</Text>
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* Insights & Recommendations */}
        {(activeTab === 'overview' || activeTab === 'insights') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Merchant Insights</Text>
            {dashboardData.insights.map((insight) => (
              <Card
                key={insight.id}
                style={[styles.insightCard, getInsightSeverityStyle(insight.severity)]}>
                <Text style={styles.insightTitle}>{insight.title}</Text>
                <Text style={styles.insightDesc}>{insight.description}</Text>
                {insight.actionableRecommendation && (
                  <View style={styles.recBox}>
                    <Text style={styles.recLabel}>Recommendation:</Text>
                    <Text style={styles.recText}>{insight.actionableRecommendation}</Text>
                  </View>
                )}
              </Card>
            ))}
          </View>
        )}

        {/* Merchant Reporting & Export */}
        {(activeTab === 'overview' || activeTab === 'reporting') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Merchant Reporting</Text>
            <Card style={styles.cardSection}>
              <Text style={styles.chartTitle}>Export Financial Reports</Text>
              <Text style={styles.insightDesc}>
                Download standardized CSV or JSON performance summary reports for accounting and compliance.
              </Text>
              <View style={styles.exportBtnRow}>
                <TouchableOpacity
                  style={styles.exportBtn}
                  onPress={() => handleExportReport('csv')}>
                  <Text style={styles.exportBtnText}>Export CSV Report</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportBtn, styles.exportBtnSecondary]}
                  onPress={() => handleExportReport('json')}>
                  <Text style={styles.exportBtnTextSecondary}>Export JSON Report</Text>
                </TouchableOpacity>
              </View>
            </Card>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.md,
  },
  header: {
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  tabBar: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
  },
  tabItem: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    marginRight: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabItemActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.surface,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  statCard: {
    width: '48%',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  statLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  statValue: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textPrimary,
  },
  statSub: {
    fontSize: typography.fontSize.xs,
    color: colors.primary,
    marginTop: spacing.xs,
  },
  chartCard: {
    padding: spacing.md,
  },
  chartTitle: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  cardSection: {
    padding: spacing.md,
  },
  planRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  planInfo: {
    flex: 1,
  },
  planName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.textPrimary,
  },
  planMeta: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
  },
  planRevenue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textPrimary,
  },
  insightCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
  },
  insightTitle: {
    fontSize: typography.fontSize.md,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  insightDesc: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  recBox: {
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textPrimary,
  },
  recText: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
  },
  exportBtnRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    justifyContent: 'space-between',
  },
  exportBtn: {
    flex: 0.48,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  exportBtnText: {
    color: colors.surface,
    fontWeight: typography.fontWeight.bold as any,
    fontSize: typography.fontSize.xs,
  },
  exportBtnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exportBtnTextSecondary: {
    color: colors.textPrimary,
    fontWeight: typography.fontWeight.bold as any,
    fontSize: typography.fontSize.xs,
  },
});

export default MerchantAnalyticsDashboard;
