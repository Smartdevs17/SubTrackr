import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useCategoryStore } from '../store/categoryStore';
import { useSubscriptionStore } from '../store/subscriptionStore';

interface CategoryPieChartProps {
  size?: number;
}

export const CategoryPieChart: React.FC<CategoryPieChartProps> = ({ size = 200 }) => {
  const { getAllCategories } = useCategoryStore();
  const { stats } = useSubscriptionStore();

  const allCategories = getAllCategories();
  const breakdown = stats.categoryBreakdown || {};

  const data = useMemo(() => {
    const entries = Object.entries(breakdown)
      .map(([catId, count]) => {
        const cat = allCategories.find((c) => c.id === catId);
        return {
          id: catId,
          name: cat?.name || catId,
          color: cat?.color || '#999',
          count,
        };
      })
      .filter((d) => d.count > 0)
      .sort((a, b) => b.count - a.count);

    const total = entries.reduce((sum, d) => sum + d.count, 0);
    return { entries, total };
  }, [breakdown, allCategories]);

  if (data.total === 0) {
    return (
      <View style={[styles.container, { width: size, height: size }]}>
        <Text style={styles.emptyText}>No data</Text>
      </View>
    );
  }

  let cumulativeAngle = 0;
  const radius = size / 2;
  const center = radius;

  return (
    <View style={styles.container}>
      <View style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {data.entries.map((entry) => {
            const sliceAngle = (entry.count / data.total) * 360;
            const startAngle = cumulativeAngle;
            const endAngle = cumulativeAngle + sliceAngle;
            cumulativeAngle += sliceAngle;

            const startRad = (Math.PI / 180) * (startAngle - 90);
            const endRad = (Math.PI / 180) * (endAngle - 90);

            const x1 = center + radius * Math.cos(startRad);
            const y1 = center + radius * Math.sin(startRad);
            const x2 = center + radius * Math.cos(endRad);
            const y2 = center + radius * Math.sin(endRad);

            const largeArc = sliceAngle > 180 ? 1 : 0;

            const pathData = [
              `M ${center} ${center}`,
              `L ${x1} ${y1}`,
              `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
              'Z',
            ].join(' ');

            return <path key={entry.id} d={pathData} fill={entry.color} stroke="#fff" strokeWidth={2} />;
          })}
        </svg>
      </View>

      <View style={styles.legend}>
        {data.entries.map((entry) => (
          <View key={entry.id} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: entry.color }]} />
            <Text style={styles.legendText}>
              {entry.name} ({entry.count})
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: 16,
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 14,
  },
  legend: {
    marginTop: 16,
    width: '100%',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  legendText: {
    fontSize: 14,
    color: '#333',
  },
});