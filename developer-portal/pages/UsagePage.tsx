import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';

interface UsageStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  requestsLast24Hours: number;
  requestsLast7Days: number;
}

interface EndpointUsage {
  endpoint: string;
  count: number;
  percentage: number;
}

interface HourlyData {
  hour: number;
  requests: number;
  errors: number;
}

interface UsagePageProps {
  environmentId?: string;
}

export const UsagePage: React.FC<UsagePageProps> = ({ environmentId }) => {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [topEndpoints, setTopEndpoints] = useState<EndpointUsage[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<'24h' | '7d' | '30d'>(
    '24h'
  );
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadUsageData();
  }, [selectedPeriod]);

  const loadUsageData = async () => {
    setStats({
      totalRequests: 12500,
      successfulRequests: 12125,
      failedRequests: 375,
      averageResponseTime: 145,
      requestsLast24Hours: 1250,
      requestsLast7Days: 8750,
    });

    setTopEndpoints([
      { endpoint: 'GET /subscriptions', count: 4500, percentage: 36 },
      { endpoint: 'POST /subscriptions', count: 2800, percentage: 22.4 },
      { endpoint: 'GET /analytics', count: 2100, percentage: 16.8 },
      { endpoint: 'POST /webhooks', count: 1500, percentage: 12 },
      { endpoint: 'GET /payments', count: 1600, percentage: 12.8 },
    ]);

    const data: HourlyData[] = [];
    for (let i = 0; i < 24; i++) {
      data.push({
        hour: i,
        requests: Math.floor(Math.random() * 100) + 20,
        errors: Math.floor(Math.random() * 10),
      });
    }
    setHourlyData(data);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadUsageData();
    setRefreshing(false);
  };

  const getSuccessRate = (): number => {
    if (!stats || stats.totalRequests === 0) return 0;
    return (stats.successfulRequests / stats.totalRequests) * 100;
  };

  const getBarHeight = (value: number, max: number): number => {
    return Math.max(4, (value / max) * 100);
  };

  const maxRequests = Math.max(...hourlyData.map((d) => d.requests));

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>Usage Analytics</Text>
        <Text style={styles.subtitle}>
          Monitor your API usage and performance
        </Text>
      </View>

      <View style={styles.periodSelector}>
        {(['24h', '7d', '30d'] as const).map((period) => (
          <TouchableOpacity
            key={period}
            style={[
              styles.periodButton,
              selectedPeriod === period && styles.periodButtonActive,
            ]}
            onPress={() => setSelectedPeriod(period)}
          >
            <Text
              style={[
                styles.periodButtonText,
                selectedPeriod === period && styles.periodButtonTextActive,
              ]}
            >
              {period}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {stats && (
        <>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>
                {stats.totalRequests.toLocaleString()}
              </Text>
              <Text style={styles.statLabel}>Total Requests</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: '#22C55E' }]}>
                {getSuccessRate().toFixed(1)}%
              </Text>
              <Text style={styles.statLabel}>Success Rate</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.averageResponseTime}ms</Text>
              <Text style={styles.statLabel}>Avg Response</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: '#EF4444' }]}>
                {stats.failedRequests.toLocaleString()}
              </Text>
              <Text style={styles.statLabel}>Failed</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Requests by Hour</Text>
            <View style={styles.chartContainer}>
              {hourlyData.map((data) => (
                <View key={data.hour} style={styles.barWrapper}>
                  <View style={styles.barContainer}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: getBarHeight(data.requests, maxRequests),
                          backgroundColor:
                            data.errors > 5 ? '#EF4444' : '#3B82F6',
                        },
                      ]}
                    />
                  </View>
                  {data.hour % 4 === 0 && (
                    <Text style={styles.barLabel}>{data.hour}h</Text>
                  )}
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Endpoints</Text>
            {topEndpoints.map((endpoint, index) => (
              <View key={endpoint.endpoint} style={styles.endpointItem}>
                <View style={styles.endpointHeader}>
                  <Text style={styles.endpointRank}>#{index + 1}</Text>
                  <Text style={styles.endpointName}>{endpoint.endpoint}</Text>
                  <Text style={styles.endpointCount}>
                    {endpoint.count.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${endpoint.percentage}%` },
                    ]}
                  />
                </View>
                <Text style={styles.endpointPercentage}>
                  {endpoint.percentage}% of total
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Performance Metrics</Text>
            <View style={styles.metricCard}>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>P50 Response Time</Text>
                <Text style={styles.metricValue}>89ms</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>P95 Response Time</Text>
                <Text style={styles.metricValue}>312ms</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>P99 Response Time</Text>
                <Text style={styles.metricValue}>567ms</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Uptime</Text>
                <Text style={[styles.metricValue, { color: '#22C55E' }]}>
                  99.95%
                </Text>
              </View>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    lineHeight: 24,
  },
  periodSelector: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  periodButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
  },
  periodButtonActive: {
    backgroundColor: '#3B82F6',
  },
  periodButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  periodButtonTextActive: {
    color: '#FFFFFF',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 12,
  },
  statCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    minWidth: '45%',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  section: {
    backgroundColor: '#FFFFFF',
    marginTop: 16,
    padding: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 120,
    paddingBottom: 20,
  },
  barWrapper: {
    flex: 1,
    alignItems: 'center',
  },
  barContainer: {
    height: 100,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: 12,
    borderRadius: 6,
    minHeight: 4,
  },
  barLabel: {
    fontSize: 10,
    color: '#9CA3AF',
    marginTop: 4,
  },
  endpointItem: {
    marginBottom: 16,
  },
  endpointHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  endpointRank: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    width: 30,
  },
  endpointName: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#374151',
  },
  endpointCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 3,
  },
  endpointPercentage: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  metricCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  metricLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
});

export default UsagePage;
