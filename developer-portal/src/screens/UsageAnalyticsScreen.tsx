import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { useDeveloperPortalStore } from '../../../src/store/developerPortalStore';

const PERIOD_OPTIONS = [
  { label: '7 Days', value: 7 },
  { label: '30 Days', value: 30 },
  { label: '90 Days', value: 90 },
];

const UsageAnalyticsScreen: React.FC = () => {
  const { developer, usageStats, recentUsage, fetchUsageStats, fetchRecentUsage } =
    useDeveloperPortalStore();
  const [selectedPeriod, setSelectedPeriod] = useState(30);

  useEffect(() => {
    if (developer) {
      loadAnalytics();
    }
  }, [developer, selectedPeriod]);

  const loadAnalytics = async () => {
    if (!developer) return;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - selectedPeriod);

    await Promise.all([
      fetchUsageStats(developer.id, { start: startDate, end: endDate }),
      fetchRecentUsage(developer.id, 50),
    ]);
  };

  const successRate = usageStats
    ? Math.round((usageStats.successfulCalls / Math.max(usageStats.totalCalls, 1)) * 100)
    : 0;

  const topEndpoints = usageStats
    ? Object.entries(usageStats.requestsByEndpoint)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
    : [];

  const errorRate = usageStats
    ? Math.round((usageStats.failedCalls / Math.max(usageStats.totalCalls, 1)) * 100)
    : 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Usage Analytics</Text>
          <Text style={styles.subtitle}>Monitor your API usage and performance</Text>
        </View>

        {/* Period Selector */}
        <View style={styles.periodSelector}>
          {PERIOD_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.periodChip,
                selectedPeriod === option.value && styles.periodChipActive,
              ]}
              onPress={() => setSelectedPeriod(option.value)}>
              <Text
                style={[
                  styles.periodText,
                  selectedPeriod === option.value && styles.periodTextActive,
                ]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Overview Stats */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{usageStats?.totalCalls.toLocaleString() || 0}</Text>
            <Text style={styles.statLabel}>Total Requests</Text>
          </View>
          <View style={[styles.statCard, styles.statSuccess]}>
            <Text style={[styles.statValue, styles.statValueSuccess]}>{successRate}%</Text>
            <Text style={styles.statLabel}>Success Rate</Text>
          </View>
          <View style={[styles.statCard, styles.statError]}>
            <Text style={[styles.statValue, styles.statValueError]}>{errorRate}%</Text>
            <Text style={styles.statLabel}>Error Rate</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{usageStats?.averageResponseTime || 0}ms</Text>
            <Text style={styles.statLabel}>Avg Response</Text>
          </View>
        </View>

        {/* Request Trend Chart */}
        {usageStats && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Request Trend</Text>
            <View style={styles.chartCard}>
              <RequestTrendChart data={usageStats.requestsByDay} />
            </View>
          </View>
        )}

        {/* Top Endpoints */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Endpoints</Text>
          {topEndpoints.length > 0 ? (
            topEndpoints.map(([endpoint, count], index) => (
              <View key={endpoint} style={styles.endpointCard}>
                <View style={styles.endpointRank}>
                  <Text style={styles.rankText}>{index + 1}</Text>
                </View>
                <View style={styles.endpointInfo}>
                  <Text style={styles.endpointPath}>{endpoint}</Text>
                  <View style={styles.endpointBar}>
                    <View
                      style={[
                        styles.endpointBarFill,
                        {
                          width: `${(count / topEndpoints[0][1]) * 100}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
                <Text style={styles.endpointCount}>{count}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyText}>No endpoint data available</Text>
          )}
        </View>

        {/* Top Errors */}
        {usageStats && usageStats.topErrors && usageStats.topErrors.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Errors</Text>
            {usageStats.topErrors.map((error) => (
              <View key={error.code} style={styles.errorCard}>
                <View style={styles.errorHeader}>
                  <View style={styles.errorCodeBadge}>
                    <Text style={styles.errorCodeText}>{error.code}</Text>
                  </View>
                  <Text style={styles.errorMessage}>{error.message}</Text>
                </View>
                <View style={styles.errorFooter}>
                  <Text style={styles.errorCount}>{error.count} occurrences</Text>
                  <Text style={styles.errorPercentage}>
                    {Math.round((error.count / usageStats.totalCalls) * 100)}%
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Recent Requests */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Requests</Text>
          {recentUsage.slice(0, 10).map((request) => (
            <View key={request.id} style={styles.requestCard}>
              <View style={styles.requestHeader}>
                <View style={styles.methodBadge}>
                  <Text style={styles.methodText}>{request.method}</Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor:
                        request.statusCode >= 200 && request.statusCode < 300
                          ? '#4CAF50'
                          : request.statusCode >= 400 && request.statusCode < 500
                            ? '#FF9800'
                            : '#F44336',
                    },
                  ]}>
                  <Text style={styles.statusText}>{request.statusCode}</Text>
                </View>
              </View>
              <Text style={styles.requestEndpoint}>{request.endpoint}</Text>
              <View style={styles.requestFooter}>
                <Text style={styles.requestTime}>
                  {new Date(request.timestamp).toLocaleTimeString()}
                </Text>
                <Text style={styles.requestResponseTime}>{request.responseTime}ms</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Rate Limit Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rate Limit Status</Text>
          <View style={styles.rateLimitCard}>
            <View style={styles.rateLimitHeader}>
              <Text style={styles.rateLimitTitle}>Current Usage</Text>
              <Text style={styles.rateLimitValue}>{usageStats?.totalCalls || 0} / 10,000</Text>
            </View>
            <View style={styles.rateLimitBar}>
              <View
                style={[
                  styles.rateLimitBarFill,
                  {
                    width: `${Math.min(((usageStats?.totalCalls || 0) / 10000) * 100, 100)}%`,
                  },
                ]}
              />
            </View>
            <Text style={styles.rateLimitHint}>Daily limit resets at midnight UTC</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const RequestTrendChart: React.FC<{ data: Record<string, number> }> = ({ data }) => {
  const chartData = Object.entries(data).slice(-7);
  const maxValue = Math.max(...chartData.map(([, value]) => value), 1);
  const chartWidth = Dimensions.get('window').width - 64;
  const barWidth = chartWidth / chartData.length - 8;

  return (
    <View style={styles.chart}>
      {chartData.map(([date, value]) => {
        const height = (value / maxValue) * 120;
        const dateObj = new Date(date);
        const dayLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        return (
          <View key={date} style={styles.barContainer}>
            <View style={styles.barWrapper}>
              <View style={[styles.bar, { height, width: barWidth }]} />
            </View>
            <Text style={styles.barLabel}>{dayLabel}</Text>
            <Text style={styles.barValue}>{value}</Text>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  periodSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  periodChip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    alignItems: 'center',
  },
  periodChipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  periodText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  periodTextActive: {
    color: '#FFF',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  statSuccess: {
    backgroundColor: '#E8F5E9',
  },
  statError: {
    backgroundColor: '#FFEBEE',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  statValueSuccess: {
    color: '#4CAF50',
  },
  statValueError: {
    color: '#F44336',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    marginBottom: 12,
  },
  chartCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 160,
  },
  barContainer: {
    alignItems: 'center',
    flex: 1,
  },
  barWrapper: {
    height: 120,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    backgroundColor: '#007AFF',
    borderRadius: 4,
    minHeight: 4,
  },
  barLabel: {
    fontSize: 10,
    color: '#666',
    marginTop: 4,
  },
  barValue: {
    fontSize: 10,
    color: '#000',
    fontWeight: '600',
    marginTop: 2,
  },
  endpointCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  endpointRank: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rankText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
  },
  endpointInfo: {
    flex: 1,
  },
  endpointPath: {
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#000',
    marginBottom: 4,
  },
  endpointBar: {
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    overflow: 'hidden',
  },
  endpointBarFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 2,
  },
  endpointCount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    marginLeft: 12,
  },
  errorCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#F44336',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  errorCodeBadge: {
    backgroundColor: '#F44336',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
  },
  errorCodeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFF',
  },
  errorMessage: {
    fontSize: 14,
    color: '#000',
    flex: 1,
  },
  errorFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  errorCount: {
    fontSize: 12,
    color: '#666',
  },
  errorPercentage: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F44336',
  },
  requestCard: {
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  methodBadge: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
  },
  methodText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1976D2',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFF',
  },
  requestEndpoint: {
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#000',
    marginBottom: 8,
  },
  requestFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  requestTime: {
    fontSize: 12,
    color: '#666',
  },
  requestResponseTime: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  rateLimitCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  rateLimitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  rateLimitTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  rateLimitValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#007AFF',
  },
  rateLimitBar: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  rateLimitBarFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  rateLimitHint: {
    fontSize: 12,
    color: '#666',
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    padding: 24,
  },
});

export default UsageAnalyticsScreen;
