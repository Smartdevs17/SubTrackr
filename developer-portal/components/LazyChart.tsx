/**
 * Lazy Suspense boundaries for the developer portal charts (issue #2271).
 *
 * Charts are split out of the initial portal bundle and only requested when
 * the surrounding screen renders them. A failed chunk shows a small message
 * instead of taking down the whole screen.
 */
import React, { Suspense, lazy } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { UsageChartProps } from '../app/charts/UsageChart';
import type { RequestTrendChartProps } from '../app/charts/RequestTrendChart';

const UsageChart = lazy(() =>
  import('../app/charts/UsageChart').then((module) => ({ default: module.UsageChart }))
);

const RequestTrendChart = lazy(() =>
  import('../app/charts/RequestTrendChart').then((module) => ({
    default: module.RequestTrendChart,
  }))
);

interface ChartBoundaryProps {
  label: string;
  children: React.ReactNode;
}

class ChartBoundary extends React.Component<ChartBoundaryProps, { failed: boolean }> {
  public state: { failed: boolean } = { failed: false };

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  public componentDidCatch(error: unknown): void {
    console.warn(`[developer-portal] failed to load ${this.props.label}`, error);
  }

  public render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <View accessibilityRole="alert" style={styles.fallback}>
          <Text style={styles.errorText}>{this.props.label} unavailable</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const ChartFallback: React.FC<{ label: string }> = ({ label }) => (
  <View style={styles.fallback} accessibilityRole="progressbar" accessibilityLabel={label}>
    <ActivityIndicator size="small" color="#007AFF" />
    <Text style={styles.fallbackText}>{label}</Text>
  </View>
);

export const LazyUsageChart: React.FC<UsageChartProps> = (props) => (
  <ChartBoundary label="Usage chart">
    <Suspense fallback={<ChartFallback label="Loading usage chart" />}>
      <UsageChart {...props} />
    </Suspense>
  </ChartBoundary>
);

export const LazyRequestTrendChart: React.FC<RequestTrendChartProps> = (props) => (
  <ChartBoundary label="Request trend chart">
    <Suspense fallback={<ChartFallback label="Loading request trend chart" />}>
      <RequestTrendChart {...props} />
    </Suspense>
  </ChartBoundary>
);

const styles = StyleSheet.create({
  fallback: {
    minHeight: 160,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  fallbackText: {
    marginTop: 8,
    fontSize: 12,
    color: '#6B7280',
  },
  errorText: {
    fontSize: 12,
    color: '#DC2626',
  },
});
