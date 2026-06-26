import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing, borderRadius } from '../../utils/constants';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { RetentionCurvePoint } from '../../types/cohortAnalytics';

interface RetentionHeatmapProps {
  points: RetentionCurvePoint[];
}

const intensityColor = (rate: number, success: string, warning: string, error: string): string => {
  if (rate >= 0.7) return success;
  if (rate >= 0.4) return warning;
  return error;
};

/** Day 1 / 7 / 30 / 60 / 90 retention curve rendered as a heatmap strip. */
export const RetentionHeatmap: React.FC<RetentionHeatmapProps> = ({ points }) => {
  const colors = useThemeColors();

  if (points.length === 0 || points.every((point) => point.cohortSize === 0)) {
    return (
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
        Not enough cohort history yet to plot a retention curve.
      </Text>
    );
  }

  return (
    <View style={styles.row}>
      {points.map((point) => {
        const opacity = point.cohortSize === 0 ? 0.15 : 0.25 + point.retentionRate * 0.75;
        const baseColor = intensityColor(
          point.retentionRate,
          colors.status.success,
          colors.status.warning,
          colors.status.error
        );
        return (
          <View key={point.day} style={styles.cellContainer}>
            <View style={[styles.cell, { backgroundColor: baseColor, opacity }]}>
              <Text style={styles.cellValue}>
                {point.cohortSize === 0 ? '—' : `${Math.round(point.retentionRate * 100)}%`}
              </Text>
            </View>
            <Text style={[styles.cellLabel, { color: colors.textSecondary }]}>Day {point.day}</Text>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xs },
  cellContainer: { alignItems: 'center', flex: 1 },
  cell: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellValue: { color: '#fff', fontWeight: '700', fontSize: 12 },
  cellLabel: { fontSize: 10, marginTop: spacing.xs },
  emptyText: { textAlign: 'center', paddingVertical: spacing.md, fontSize: 13 },
});

export default RetentionHeatmap;
