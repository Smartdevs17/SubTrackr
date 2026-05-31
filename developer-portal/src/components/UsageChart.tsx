import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';

interface UsageChartProps {
  data: Record<string, number>;
  period: string;
  onPeriodChange: (period: string) => void;
}

export const UsageChart: React.FC<UsageChartProps> = ({ data }) => {
  const chartData = Object.entries(data).slice(-7);
  const maxValue = Math.max(...chartData.map(([, value]) => value), 1);
  const chartWidth = Dimensions.get('window').width - 64;
  const barWidth = chartWidth / chartData.length - 8;

  return (
    <View style={styles.container}>
      <View style={styles.chart}>
        {chartData.map(([date, value]) => {
          const height = (value / maxValue) * 120;
          const dateObj = new Date(date);
          const dayLabel = dateObj.toLocaleDateString('en-US', { weekday: 'short' });

          return (
            <View key={date} style={styles.barContainer}>
              <View style={styles.barWrapper}>
                <View style={[styles.bar, { height, width: barWidth }]} />
              </View>
              <Text style={styles.label}>{dayLabel}</Text>
              <Text style={styles.value}>{value}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
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
  label: {
    fontSize: 10,
    color: '#666',
    marginTop: 4,
  },
  value: {
    fontSize: 10,
    color: '#000',
    fontWeight: '600',
    marginTop: 2,
  },
});
