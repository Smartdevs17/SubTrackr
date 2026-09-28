import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

export type HealthStatus = 'critical' | 'warning' | 'healthy';
export type HealthTrend = 'up' | 'down' | 'stable';

export interface HealthScoreGaugeProps {
  score: number; // 0 to 100
  size?: number;
  strokeWidth?: number;
  trend?: HealthTrend;
  showLabel?: boolean;
  label?: string;
  testID?: string;
}

export function getHealthStatusInfo(score: number): {
  status: HealthStatus;
  color: string;
  label: string;
} {
  const clampedScore = Math.max(0, Math.min(100, score));
  if (clampedScore < 50) {
    return { status: 'critical', color: '#EF4444', label: 'Critical' };
  }
  if (clampedScore < 75) {
    return { status: 'warning', color: '#F59E0B', label: 'Warning' };
  }
  return { status: 'healthy', color: '#10B981', label: 'Healthy' };
}

export function getTrendSymbol(trend?: HealthTrend): string {
  switch (trend) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'stable':
      return '→';
    default:
      return '';
  }
}

export const HealthScoreGauge: React.FC<HealthScoreGaugeProps> = ({
  score,
  size = 120,
  strokeWidth = 10,
  trend,
  showLabel = true,
  label,
  testID = 'health-score-gauge',
}) => {
  const clampedScore = Math.max(0, Math.min(100, score));
  const statusInfo = getHealthStatusInfo(clampedScore);
  const trendSymbol = getTrendSymbol(trend);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clampedScore / 100) * circumference;

  return (
    <View style={[styles.container, { width: size, height: size }]} testID={testID}>
      <Svg width={size} height={size} testID={`${testID}-svg`}>
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          {/* Background Track Circle */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#E5E7EB"
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          {/* Gauge Progress Circle */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={statusInfo.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
          />
        </G>
      </Svg>

      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <View style={styles.centerContent}>
          <Text style={[styles.scoreText, { color: statusInfo.color }]} testID={`${testID}-score`}>
            {Math.round(clampedScore)}
          </Text>
          {trendSymbol ? (
            <Text style={[styles.trendText, { color: statusInfo.color }]} testID={`${testID}-trend`}>
              {trendSymbol}
            </Text>
          ) : null}
          {showLabel ? (
            <Text style={styles.labelText} testID={`${testID}-label`}>
              {label || statusInfo.label}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  trendText: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: -2,
  },
  labelText: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
});
