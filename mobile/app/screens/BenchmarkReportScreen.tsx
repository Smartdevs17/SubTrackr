import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

interface BenchmarkMetric {
  merchantValue: number;
  p25: number;
  p50: number;
  p75: number;
  unit: string;
  cohortSize: number;
}

interface BenchmarkReport {
  merchantId: string;
  vertical: string;
  region: string;
  companySize: string;
  generatedAt: string;
  metrics: {
    mrrGrowth: BenchmarkMetric;
    churnRate: BenchmarkMetric;
    conversionRate: BenchmarkMetric;
    arpa: BenchmarkMetric;
  };
  trend: 'improving' | 'declining' | 'stable';
}

const TREND_COLORS: Record<string, string> = {
  improving: '#22c55e',
  declining: '#ef4444',
  stable: '#6b7280',
};

const VERTICALS = ['saas', 'ecommerce', 'media', 'education', 'healthcare', 'fintech'];

function MetricBar({ label, metric }: { label: string; metric: BenchmarkMetric }) {
  const maxVal = Math.max(metric.p75, metric.merchantValue, 1);
  const merchantPct = (metric.merchantValue / maxVal) * 100;
  const p25Pct = (metric.p25 / maxVal) * 100;
  const p50Pct = (metric.p50 / maxVal) * 100;
  const p75Pct = (metric.p75 / maxVal) * 100;

  return (
    <View style={styles.metricContainer}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.barContainer}>
        <View style={[styles.bar, styles.barP25, { width: `${p25Pct}%` }]} />
        <View style={[styles.bar, styles.barP50, { width: `${p50Pct}%` }]} />
        <View style={[styles.bar, styles.barP75, { width: `${p75Pct}%` }]} />
        <View
          style={[
            styles.merchantMarker,
            { left: `${merchantPct}%` },
          ]}
        />
      </View>
      <Text style={styles.metricValue}>
        You: {metric.merchantValue.toFixed(2)} {metric.unit}
      </Text>
      <Text style={styles.percentileLabel}>
        p25: {metric.p25.toFixed(2)} | p50: {metric.p50.toFixed(2)} | p75:{' '}
        {metric.p75.toFixed(2)}
      </Text>
    </View>
  );
}

export function BenchmarkReportScreen() {
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [insufficientPeers, setInsufficientPeers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedVertical, setSelectedVertical] = useState(VERTICALS[0]);
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setInsufficientPeers(false);
    } catch (err) {
      setError('Failed to load benchmark report');
    } finally {
      setLoading(false);
    }
  }, [selectedVertical]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchReport();
    setRefreshing(false);
  }, [fetchReport]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  if (insufficientPeers) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Benchmark Report</Text>
        <Text style={styles.insufficientText}>
          Insufficient peers in your cohort to generate a comparison.
          You need at least 10 merchants in your vertical, region, and size
          bracket. Check back as more merchants join.
        </Text>
      </SafeAreaView>
    );
  }

  if (!report) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Benchmark Report</Text>
        <Text style={styles.optInText}>
          Opt in to contribute anonymized data and receive industry benchmark
          reports.
        </Text>
        <View style={styles.optInButton}>
          <Text style={styles.optInButtonText}>Opt In</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Text style={styles.title}>Benchmark Report</Text>
        <Text style={styles.subtitle}>
          {report.vertical.toUpperCase()} · {report.region} ·{' '}
          {report.companySize}
        </Text>
        <Text style={styles.trendText}>
          Trend:{' '}
          <Text style={{ color: TREND_COLORS[report.trend] }}>
            {report.trend.charAt(0).toUpperCase() + report.trend.slice(1)}
          </Text>
        </Text>
        <Text style={styles.generatedAt}>
          Generated: {new Date(report.generatedAt).toLocaleDateString()}
        </Text>

        <MetricBar label="MRR Growth" metric={report.metrics.mrrGrowth} />
        <MetricBar label="Churn Rate" metric={report.metrics.churnRate} />
        <MetricBar label="Conversion Rate" metric={report.metrics.conversionRate} />
        <MetricBar label="ARPA" metric={report.metrics.arpa} />

        <Text style={styles.cohortNote}>
          Based on {report.metrics.mrrGrowth.cohortSize} anonymized peers
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 12,
  },
  trendText: {
    fontSize: 16,
    color: '#e2e8f0',
    marginBottom: 4,
  },
  generatedAt: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 20,
  },
  metricContainer: {
    marginBottom: 20,
  },
  metricLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e2e8f0',
    marginBottom: 6,
  },
  barContainer: {
    height: 24,
    backgroundColor: '#1e293b',
    borderRadius: 6,
    flexDirection: 'row',
    overflow: 'hidden',
    position: 'relative',
  },
  bar: {
    height: '100%',
    position: 'absolute',
    left: 0,
    borderRadius: 6,
  },
  barP25: {
    backgroundColor: '#3b82f6',
    opacity: 0.4,
  },
  barP50: {
    backgroundColor: '#3b82f6',
    opacity: 0.6,
  },
  barP75: {
    backgroundColor: '#3b82f6',
    opacity: 0.8,
  },
  merchantMarker: {
    position: 'absolute',
    top: 0,
    width: 4,
    height: '100%',
    backgroundColor: '#f59e0b',
    borderRadius: 2,
  },
  metricValue: {
    fontSize: 13,
    color: '#f59e0b',
    marginTop: 4,
    fontWeight: '600',
  },
  percentileLabel: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  cohortNote: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 12,
  },
  insufficientText: {
    fontSize: 15,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 22,
  },
  optInText: {
    fontSize: 15,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 22,
  },
  optInButton: {
    backgroundColor: '#3b82f6',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignSelf: 'center',
    marginTop: 16,
  },
  optInButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 15,
    textAlign: 'center',
  },
});
