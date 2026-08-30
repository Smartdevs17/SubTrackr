import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useFraudStore } from '../store/fraudStore';
import { useTheme } from '../theme/useTheme';

const { width } = Dimensions.get('window');

export default function FraudAnalyticsScreen() {
  const { theme } = useTheme();
  const { analytics, monitoring, isLoading, loadAnalytics, loadMonitoring } = useFraudStore();

  useEffect(() => {
    loadAnalytics();
    loadMonitoring();
  }, []);

  if (isLoading || !analytics) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const MetricCard = ({ title, value, subtitle, color, trend }: any) => (
    <View style={[styles.metricCard, { backgroundColor: theme.colors.card }]}>
      <Text style={[styles.metricTitle, { color: theme.colors.textSecondary }]}>{title}</Text>
      <Text style={[styles.metricValue, { color: color || theme.colors.text }]}>{value}</Text>
      {subtitle && <Text style={[styles.metricSubtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text>}
      {trend && <Text style={[styles.trendText, { color: trend.color }]}>{trend.text}</Text>}
    </View>
  );

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {monitoring && (
        <View style={[styles.monitoringBanner, { backgroundColor: monitoring.systemHealth === 'healthy' ? '#10B981' : '#F59E0B' }]}>
          <Text style={styles.monitoringText}>
            🛡️ {monitoring.systemHealth === 'healthy' ? 'Real-time Monitoring Active' : 'System Degraded'} • {monitoring.transactionsMonitored} monitored
          </Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Overview</Text>
        <View style={styles.metricsGrid}>
          <MetricCard
            title="Total Detections"
            value={analytics.totalDetections}
            subtitle="All time"
          />
          <MetricCard
            title="Blocked"
            value={analytics.blockedTransactions}
            subtitle="Prevented fraud"
            color="#DC2626"
          />
          <MetricCard
            title="Confirmed Fraud"
            value={analytics.confirmedFraud}
            subtitle={`${analytics.detectionRate.toFixed(1)}% detection rate`}
            color="#EF4444"
          />
          <MetricCard
            title="False Positives"
            value={analytics.falsePositives}
            subtitle={`${analytics.falsePositiveRate.toFixed(1)}% rate`}
            color="#F59E0B"
          />
          <MetricCard
            title="Avg Risk Score"
            value={analytics.averageRiskScore.toFixed(1)}
            subtitle="Out of 100"
            color="#8B5CF6"
          />
          <MetricCard
            title="Prevented Loss"
            value={`$${analytics.preventedLoss.toFixed(2)}`}
            subtitle="Estimated savings"
            color="#10B981"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Risk Level Distribution</Text>
        <View style={styles.distributionContainer}>
          {Object.entries(analytics.detectionsByLevel).map(([level, count]) => {
            const color = level === 'critical' ? '#DC2626' : level === 'high' ? '#EF4444' : level === 'medium' ? '#F59E0B' : '#10B981';
            const percentage = analytics.totalDetections > 0 ? (count / analytics.totalDetections * 100).toFixed(1) : 0;
            return (
              <View key={level} style={[styles.distributionBar, { backgroundColor: theme.colors.card }]}>
                <View style={styles.distributionInfo}>
                  <Text style={[styles.distributionLevel, { color: theme.colors.text }]}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </Text>
                  <Text style={[styles.distributionCount, { color }]}>
                    {count} ({percentage}%)
                  </Text>
                </View>
                <View style={styles.barContainer}>
                  <View style={[styles.bar, { width: `${percentage}%`, backgroundColor: color }]} />
                </View>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Top Fraud Indicators</Text>
        {Object.entries(analytics.indicatorBreakdown)
          .filter(([, count]) => count > 0)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([type, count]) => (
            <View key={type} style={[styles.indicatorRow, { backgroundColor: theme.colors.card }]}>
              <Text style={[styles.indicatorType, { color: theme.colors.text }]}>
                {type.replace(/_/g, ' ').toUpperCase()}
              </Text>
              <Text style={[styles.indicatorCount, { color: theme.colors.primary }]}>
                {count}
              </Text>
            </View>
          ))}
      </View>

      {analytics.topRiskUsers.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>High-Risk Users</Text>
          {analytics.topRiskUsers.slice(0, 5).map((user, index) => (
            <View key={user.userId} style={[styles.userCard, { backgroundColor: theme.colors.card }]}>
              <View style={styles.userRank}>
                <Text style={[styles.rankText, { color: theme.colors.primary }]}>#{index + 1}</Text>
              </View>
              <View style={styles.userInfo}>
                <Text style={[styles.userId, { color: theme.colors.text }]}>
                  User: {user.userId.substring(0, 12)}...
                </Text>
                <Text style={[styles.userStats, { color: theme.colors.textSecondary }]}>
                  Risk: {user.riskScore} • Detections: {user.detectionCount}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Detection Methods</Text>
        {Object.entries(analytics.detectionsByMethod)
          .filter(([, count]) => count > 0)
          .map(([method, count]) => (
            <View key={method} style={[styles.methodRow, { backgroundColor: theme.colors.card }]}>
              <Text style={[styles.methodName, { color: theme.colors.text }]}>
                {method.replace(/_/g, ' ').toUpperCase()}
              </Text>
              <Text style={[styles.methodCount, { color: theme.colors.textSecondary }]}>
                {count} detections
              </Text>
            </View>
          ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  monitoringBanner: { padding: 16, alignItems: 'center' },
  monitoringText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  section: { padding: 16, marginBottom: 8 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 16 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricCard: { width: (width - 44) / 2, padding: 16, borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  metricTitle: { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  metricValue: { fontSize: 24, fontWeight: 'bold', marginBottom: 4 },
  metricSubtitle: { fontSize: 12 },
  trendText: { fontSize: 11, marginTop: 4, fontWeight: '600' },
  distributionContainer: { gap: 12 },
  distributionBar: { padding: 12, borderRadius: 8 },
  distributionInfo: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  distributionLevel: { fontSize: 14, fontWeight: '600' },
  distributionCount: { fontSize: 14, fontWeight: 'bold' },
  barContainer: { height: 8, backgroundColor: '#E5E7EB', borderRadius: 4, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },
  indicatorRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderRadius: 8, marginBottom: 8 },
  indicatorType: { fontSize: 14, fontWeight: '500', flex: 1 },
  indicatorCount: { fontSize: 16, fontWeight: 'bold' },
  userCard: { flexDirection: 'row', padding: 16, borderRadius: 12, marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  userRank: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  rankText: { fontSize: 16, fontWeight: 'bold' },
  userInfo: { flex: 1 },
  userId: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  userStats: { fontSize: 14 },
  methodRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderRadius: 8, marginBottom: 8 },
  methodName: { fontSize: 14, fontWeight: '500' },
  methodCount: { fontSize: 14 },
});
