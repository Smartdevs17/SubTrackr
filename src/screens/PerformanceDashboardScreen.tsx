import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PerformanceMetric, performanceMonitor } from '../services/performanceMonitor';
import { colors, spacing, typography } from '../utils/constants';

const formatMetricValue = (metric: PerformanceMetric): string => {
  if (metric.type === 'memory') {
    return `${((metric.value ?? 0) / 1024 / 1024 || 0).toFixed(1)} MB`;
  }

  return `${(metric.durationMs ?? metric.value ?? 0).toFixed(1)} ${metric.unit ?? 'ms'}`;
};

const PerformanceDashboardScreen: React.FC = () => {
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);

  useEffect(() => performanceMonitor.subscribe(setMetrics), []);

  const summary = performanceMonitor.getSummary();
  const budget = performanceMonitor.getBudget();

  return (
    <SafeAreaView style={styles.container} testID="performance-dashboard-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Performance</Text>

        <View style={styles.grid}>
          <View style={styles.panel}>
            <Text style={styles.label}>Render p95</Text>
            <Text style={styles.value}>{(summary.p95.render ?? 0).toFixed(1)} ms</Text>
            <Text style={styles.caption}>Budget {budget.renderMs} ms</Text>
          </View>
          <View style={styles.panel}>
            <Text style={styles.label}>API p95</Text>
            <Text style={styles.value}>{(summary.p95.network ?? 0).toFixed(1)} ms</Text>
            <Text style={styles.caption}>Budget {budget.apiLatencyMs} ms</Text>
          </View>
          <View style={styles.panel}>
            <Text style={styles.label}>Memory avg</Text>
            <Text style={styles.value}>
              {((summary.averages.memory ?? 0) / 1024 / 1024 || 0).toFixed(1)} MB
            </Text>
            <Text style={styles.caption}>
              Budget {(budget.memoryBytes / 1024 / 1024).toFixed(0)} MB
            </Text>
          </View>
          <View style={styles.panel}>
            <Text style={styles.label}>Regressions</Text>
            <Text style={styles.value}>{summary.slowMetrics.length}</Text>
            <Text style={styles.caption}>{summary.totalMetrics} samples</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Recent Metrics</Text>
        {metrics
          .slice(-30)
          .reverse()
          .map((metric, index) => (
            <View
              key={`${metric.type}-${metric.name}-${metric.timestamp}-${index}`}
              style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.metricName}>{metric.name}</Text>
                <Text style={styles.metricType}>{metric.type}</Text>
              </View>
              <Text style={styles.metricValue}>{formatMetricValue(metric)}</Text>
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  panel: {
    width: '47%',
    minHeight: 104,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  value: {
    ...typography.h2,
    color: colors.text,
    marginTop: spacing.xs,
  },
  caption: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginTop: spacing.md,
  },
  row: {
    minHeight: 64,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
  },
  metricName: {
    ...typography.body,
    color: colors.text,
  },
  metricType: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },
  metricValue: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
  },
});

export default PerformanceDashboardScreen;
