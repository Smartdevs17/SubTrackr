/**
 * Developer portal request-trend chart.
 *
 * Kept in its own module so it is only fetched when the analytics screen
 * actually renders it (see components/LazyChart.tsx, issue #2271).
 */
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';

export interface RequestTrendChartProps {
  data: Record<string, number>;
}

export const RequestTrendChart: React.FC<RequestTrendChartProps> = ({ data }) => {
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
});
