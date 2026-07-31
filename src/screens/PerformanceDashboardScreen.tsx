import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CoreWebVitals,
  PerformanceBudget,
  PerformanceMetric,
  PerformanceRegression,
  performanceMonitor,
} from '../services/performanceMonitor';
import { colors, spacing, typography } from '../utils/constants';

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatMetricValue = (metric: PerformanceMetric): string => {
  if (metric.type === 'memory') {
    return `${((metric.value ?? 0) / 1024 / 1024 || 0).toFixed(1)} MB`;
  }
  if (metric.type === 'bundle') {
    return `${((metric.value ?? 0) / 1024).toFixed(1)} KB`;
  }
  return `${(metric.durationMs ?? metric.value ?? 0).toFixed(1)} ${metric.unit ?? 'ms'}`;
};

const vitalStatus = (
  value: number | undefined,
  budget: number
): { label: string; color: string } => {
  if (value == null) return { label: '—', color: colors.textSecondary };
  if (value <= budget * 0.75) return { label: 'Good', color: '#22c55e' };
  if (value <= budget) return { label: 'Needs improvement', color: '#f59e0b' };
  return { label: 'Poor', color: '#ef4444' };
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface StatPanelProps {
  label: string;
  value: string;
  caption: string;
  statusColor?: string;
}

const StatPanel: React.FC<StatPanelProps> = ({ label, value, caption, statusColor }) => (
  <View style={styles.panel}>
    <Text style={styles.label}>{label}</Text>
    <Text style={[styles.value, statusColor ? { color: statusColor } : null]}>{value}</Text>
    <Text style={styles.caption}>{caption}</Text>
  </View>
);

interface VitalRowProps {
  name: string;
  value: number | undefined;
  budget: number;
  unit?: string;
}

const VitalRow: React.FC<VitalRowProps> = ({ name, value, budget, unit = 'ms' }) => {
  const status = vitalStatus(value, budget);
  return (
    <View style={styles.vitalRow}>
      <View style={styles.rowText}>
        <Text style={styles.metricName}>{name}</Text>
        <Text style={[styles.vitalStatus, { color: status.color }]}>{status.label}</Text>
      </View>
      <View style={styles.vitalRight}>
        <Text style={styles.metricValue}>
          {value != null ? `${value.toFixed(0)} ${unit}` : '—'}
        </Text>
        <Text style={styles.caption}>
          budget {budget} {unit}
        </Text>
      </View>
    </View>
  );
};

interface RegressionRowProps {
  regression: PerformanceRegression;
}

const RegressionRow: React.FC<RegressionRowProps> = ({ regression }) => (
  <View style={[styles.row, styles.regressionRow]}>
    <View style={styles.rowText}>
      <Text style={styles.metricName}>{regression.metric.name}</Text>
      <Text style={[styles.metricType, { color: '#ef4444' }]}>
        +{regression.exceedancePercent.toFixed(0)}% over budget
      </Text>
    </View>
    <Text style={[styles.metricValue, { color: '#ef4444' }]}>
      {regression.actual.toFixed(0)} / {regression.budget}
    </Text>
  </View>
);

// ── Main Screen ───────────────────────────────────────────────────────────────

const PerformanceDashboardScreen: React.FC = () => {
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [vitals, setVitals] = useState<CoreWebVitals>({});
  const [budget, setBudget] = useState<PerformanceBudget>(performanceMonitor.getBudget());

  useEffect(() => {
    const unsub = performanceMonitor.subscribe((m) => {
      setMetrics([...m]);
      setVitals(performanceMonitor.getCoreWebVitals());
    });

    // Refresh budget if it was changed at runtime
    setBudget(performanceMonitor.getBudget());
    return unsub;
  }, []);

  const summary = performanceMonitor.getSummary();
  const recentMetrics = metrics.slice(-30).reverse();
  const regressions = summary.regressions.slice(-10).reverse();

  // Route transition metrics
  const routeMetrics = metrics
    .filter((m) => m.type === 'route' && !m.name.startsWith('route_settle:'))
    .slice(-5)
    .reverse();

  return (
    <SafeAreaView style={styles.container} testID="performance-dashboard-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Performance</Text>

        {/* ── Summary Grid ── */}
        <Text style={styles.sectionTitle}>Summary</Text>
        <View style={styles.grid}>
          <StatPanel
            label="Render p95"
            value={`${(summary.p95.render ?? 0).toFixed(1)} ms`}
            caption={`Budget ${budget.renderMs} ms`}
            statusColor={(summary.p95.render ?? 0) > budget.renderMs ? '#ef4444' : '#22c55e'}
          />
          <StatPanel
            label="API p95"
            value={`${(summary.p95.network ?? 0).toFixed(1)} ms`}
            caption={`Budget ${budget.apiLatencyMs} ms`}
            statusColor={(summary.p95.network ?? 0) > budget.apiLatencyMs ? '#ef4444' : '#22c55e'}
          />
          <StatPanel
            label="Memory avg"
            value={`${((summary.averages.memory ?? 0) / 1024 / 1024 || 0).toFixed(1)} MB`}
            caption={`Budget ${(budget.memoryBytes / 1024 / 1024).toFixed(0)} MB`}
            statusColor={
              (summary.averages.memory ?? 0) > budget.memoryBytes ? '#ef4444' : '#22c55e'
            }
          />
          <StatPanel
            label="Regressions"
            value={`${regressions.length}`}
            caption={`${summary.totalMetrics} samples`}
            statusColor={regressions.length > 0 ? '#ef4444' : '#22c55e'}
          />
        </View>

        {/* ── Core Web Vitals ── */}
        <Text style={styles.sectionTitle}>Core Web Vitals</Text>
        <View style={styles.card}>
          <VitalRow
            name="LCP (Largest Contentful Paint)"
            value={vitals.lcp}
            budget={budget.lcpMs}
            unit="ms"
          />
          <View style={styles.divider} />
          <VitalRow
            name="FID (First Input Delay)"
            value={vitals.fid}
            budget={budget.fidMs}
            unit="ms"
          />
          <View style={styles.divider} />
          <VitalRow
            name="CLS (Frame Drops)"
            value={vitals.cls}
            budget={budget.clsFrameDrops}
            unit="drops"
          />
        </View>

        {/* ── Route Transitions ── */}
        {routeMetrics.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Route Transitions</Text>
            {routeMetrics.map((metric, index) => (
              <View key={`route-${metric.timestamp}-${index}`} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.metricName}>
                    {(metric.metadata?.from as string) ?? '?'} →{' '}
                    {(metric.metadata?.to as string) ?? '?'}
                  </Text>
                  <Text style={styles.metricType}>route transition</Text>
                </View>
                <Text
                  style={[
                    styles.metricValue,
                    {
                      color:
                        (metric.durationMs ?? 0) > budget.routeTransitionMs
                          ? '#ef4444'
                          : colors.primary,
                    },
                  ]}>
                  {(metric.durationMs ?? 0).toFixed(0)} ms
                </Text>
              </View>
            ))}
          </>
        )}

        {/* ── Regression Alerts ── */}
        {regressions.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: '#ef4444' }]}>⚠ Regression Alerts</Text>
            {regressions.map((r, i) => (
              <RegressionRow key={`reg-${r.metric.timestamp}-${i}`} regression={r} />
            ))}
          </>
        )}

        {/* ── Recent Metrics Feed ── */}
        <Text style={styles.sectionTitle}>Recent Metrics</Text>
        {recentMetrics.map((metric, index) => (
          <View
            key={`${metric.type}-${metric.name}-${metric.timestamp}-${index}`}
            style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.metricName}>{metric.name}</Text>
              <Text style={styles.metricType}>{metric.type}</Text>
            </View>
            <Text
              style={[
                styles.metricValue,
                performanceMonitor.isRegression(metric) ? { color: '#ef4444' } : null,
              ]}>
              {formatMetricValue(metric)}
            </Text>
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
  card: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
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
  regressionRow: {
    borderColor: '#ef444444',
  },
  vitalRow: {
    padding: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  vitalRight: {
    alignItems: 'flex-end',
  },
  vitalStatus: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
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
