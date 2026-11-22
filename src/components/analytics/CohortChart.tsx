import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Rect, Text as SvgText, Line, G } from 'react-native-svg';
import { spacing } from '../../utils/constants';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { CohortBucket } from '../../types/cohortAnalytics';

const { width: screenWidth } = Dimensions.get('window');
const CHART_WIDTH = screenWidth - spacing.xl * 2 - spacing.lg * 2;
const CHART_HEIGHT = 180;

interface CohortChartProps {
  buckets: CohortBucket[];
}

/** Bar chart of cohort size, with retention % labeled above each bar. */
export const CohortChart: React.FC<CohortChartProps> = ({ buckets }) => {
  const colors = useThemeColors();

  if (buckets.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No cohorts yet — add subscriptions to start building cohort history.
        </Text>
      </View>
    );
  }

  const visible = buckets.slice(-8);
  const maxSize = Math.max(...visible.map((bucket) => bucket.size), 1);
  const barWidth = (CHART_WIDTH - 20) / visible.length - 8;

  return (
    <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
      <Line
        x1={30}
        y1={10}
        x2={30}
        y2={CHART_HEIGHT - 30}
        stroke={colors.border.default}
        strokeWidth={1}
      />
      <Line
        x1={30}
        y1={CHART_HEIGHT - 30}
        x2={CHART_WIDTH - 10}
        y2={CHART_HEIGHT - 30}
        stroke={colors.border.default}
        strokeWidth={1}
      />
      {visible.map((bucket, index) => {
        const barHeight = bucket.isEmpty ? 0 : (bucket.size / maxSize) * (CHART_HEIGHT - 60);
        const x = 35 + index * (barWidth + 8);
        const y = CHART_HEIGHT - 30 - barHeight;
        const retentionColor =
          bucket.retentionRate >= 0.7
            ? colors.status.success
            : bucket.retentionRate >= 0.4
              ? colors.status.warning
              : colors.status.error;

        return (
          <G key={bucket.cohortKey}>
            <Rect
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(barHeight, 1)}
              fill={retentionColor}
              rx={4}
            />
            <SvgText
              x={x + barWidth / 2}
              y={CHART_HEIGHT - 15}
              fontSize={9}
              fill={colors.textSecondary}
              textAnchor="middle">
              {bucket.cohortKey.slice(-5)}
            </SvgText>
            {!bucket.isEmpty && (
              <SvgText
                x={x + barWidth / 2}
                y={y - 5}
                fontSize={9}
                fill={colors.text.primary}
                textAnchor="middle">
                {Math.round(bucket.retentionRate * 100)}%
              </SvgText>
            )}
          </G>
        );
      })}
    </Svg>
  );
};

const styles = StyleSheet.create({
  emptyState: { paddingVertical: spacing.lg, alignItems: 'center' },
  emptyText: { textAlign: 'center', fontSize: 13 },
});

export default CohortChart;
