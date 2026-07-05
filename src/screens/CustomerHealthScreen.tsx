import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import Svg, { Rect, Text as SvgText, Line, G, Circle } from 'react-native-svg';
import { spacing, typography, borderRadius } from '../utils/constants';
import { useHealthStore } from '../store';
import { HealthScoreService } from '../services/healthService';
import { HealthScoreStatus, DEFAULT_WEIGHTS } from '../types/health';
import { Card } from '../components/common/Card';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeColors } from '../hooks/useThemeColors';

const { width: screenWidth } = Dimensions.get('window');
const CHART_WIDTH = screenWidth - spacing.xl * 2;
const CHART_HEIGHT = 180;

type DateRange = '30d' | '60d' | '90d';

const CustomerHealthScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { healthScores, history, interventions } = useHealthStore();
  const { healthScoreWeights, setHealthScoreWeights } = useSettingsStore();
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(null);

  const weights = (healthScoreWeights as typeof DEFAULT_WEIGHTS) ?? DEFAULT_WEIGHTS;

  const selectedScore = selectedSubscriptionId
    ? healthScores.find((h) => h.subscriptionId === selectedSubscriptionId)
    : healthScores[0] ?? undefined;

  useEffect(() => {
    if (healthScores.length === 0) {
      HealthScoreService.calculate('sub-1', 'user-1', {
        loginFrequency: 70,
        featureUsage: 65,
        paymentSuccessRate: 90,
        supportTickets: 2,
        npsResponse: 60,
      });
    }
  }, []);

  const recentHistory = useMemo(() => {
    if (!selectedScore) return [];
    const cutoff = new Date();
    const days = dateRange === '30d' ? 30 : dateRange === '60d' ? 60 : 90;
    cutoff.setDate(cutoff.getDate() - days);
    return history
      .filter((h) => h.healthScoreId === selectedScore.id && new Date(h.calculatedAt) >= cutoff)
      .sort((a, b) => new Date(a.calculatedAt).getTime() - new Date(b.calculatedAt).getTime());
  }, [selectedScore, history, dateRange]);

  const scoreInterventions = useMemo(() => {
    if (!selectedScore) return [];
    return interventions.filter((i) => i.healthScoreId === selectedScore.id);
  }, [selectedScore, interventions]);

  const getStatusColor = (status: HealthScoreStatus): string => {
    switch (status) {
      case HealthScoreStatus.GREEN:
        return colors.success;
      case HealthScoreStatus.YELLOW:
        return colors.warning;
      case HealthScoreStatus.RED:
        return colors.error;
      default:
        return colors.textSecondary;
    }
  };

  const chartPoints = useMemo(() => {
    if (recentHistory.length < 2) return [];
    const maxScore = 100;
    const minScore = 0;
    const stepX = CHART_WIDTH / Math.max(recentHistory.length - 1, 1);
    return recentHistory.map((entry, idx) => ({
      x: idx * stepX,
      y: CHART_HEIGHT - ((entry.score - minScore) / (maxScore - minScore)) * CHART_HEIGHT,
      score: entry.score,
    }));
  }, [recentHistory]);

  const pathD = useMemo(() => {
    if (chartPoints.length < 2) return '';
    return chartPoints
      .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
      .join(' ');
  }, [chartPoints]);

  function handleWeightChange(factor: keyof typeof DEFAULT_WEIGHTS, value: number) {
    const next = { ...weights, [factor]: value };
    setHealthScoreWeights(next);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Customer Health</Text>
      <Text style={styles.subtitle}>Proactive retention scoring</Text>

      {selectedScore && (
        <View style={styles.scoreCard}>
          <View style={styles.scoreRow}>
            <Text style={styles.scoreValue}>{selectedScore.score}</Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: getStatusColor(selectedScore.status) + '20' },
              ]}
            >
              <Text style={[styles.statusText, { color: getStatusColor(selectedScore.status) }]}>
                {selectedScore.status.toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={styles.trendText}>
            Trend: {selectedScore.trend.charAt(0).toUpperCase() + selectedScore.trend.slice(1)}
          </Text>
          {selectedScore.manualOverride && (
            <Text style={styles.overrideText}>
              Manual override: {selectedScore.manualOverride} ({selectedScore.manualOverrideReason})
            </Text>
          )}
        </View>
      )}

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Score Breakdown</Text>
        <View style={styles.breakdownRow}>
          <View style={styles.breakdownItem}>
            <Text style={styles.breakdownLabel}>Login</Text>
            <Text style={styles.breakdownValue}>{selectedScore?.breakdown.loginFrequency ?? '-'}</Text>
          </View>
          <View style={styles.breakdownItem}>
            <Text style={styles.breakdownLabel}>Usage</Text>
            <Text style={styles.breakdownValue}>{selectedScore?.breakdown.featureUsage ?? '-'}</Text>
          </View>
          <View style={styles.breakdownItem}>
            <Text style={styles.breakdownLabel}>Payment</Text>
            <Text style={styles.breakdownValue}>{selectedScore?.breakdown.paymentSuccessRate ?? '-'}</Text>
          </View>
          <View style={styles.breakdownItem}>
            <Text style={styles.breakdownLabel}>Support</Text>
            <Text style={styles.breakdownValue}>{selectedScore?.breakdown.supportTickets ?? '-'}</Text>
          </View>
          <View style={styles.breakdownItem}>
            <Text style={styles.breakdownLabel}>NPS</Text>
            <Text style={styles.breakdownValue}>{selectedScore?.breakdown.npsResponse ?? '-'}</Text>
          </View>
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Score Trend</Text>
        <View style={styles.chartRow}>
          {(['30d', '60d', '90d'] as DateRange[]).map((range) => (
            <TouchableOpacity
              key={range}
              onPress={() => setDateRange(range)}
              style={[
                styles.rangeChip,
                dateRange === range && styles.rangeChipActive,
              ]}
            >
              <Text
                style={[
                  styles.rangeChipText,
                  dateRange === range && styles.rangeChipTextActive,
                ]}
              >
                {range}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {chartPoints.length >= 2 ? (
          <Svg width={CHART_WIDTH} height={CHART_HEIGHT} style={styles.chart}>
            <Line
              x1={chartPoints[0].x}
              y1={chartPoints[0].y}
              x2={chartPoints[chartPoints.length - 1].x}
              y2={chartPoints[chartPoints.length - 1].y}
              stroke={colors.border.default}
              strokeWidth="1"
            />
            <G>
              {chartPoints.map((p, idx) => (
                <Circle key={idx} cx={p.x} cy={p.y} r="4" fill={colors.primary} />
              ))}
            </G>
            <G>
              {chartPoints.map((p, idx) => (
                <SvgText
                  key={idx}
                  x={p.x}
                  y={p.y - 10}
                  fontSize="10"
                  fill={colors.textSecondary}
                  textAnchor="middle"
                >
                  {p.score}
                </SvgText>
              ))}
            </G>
          </Svg>
        ) : (
          <Text style={styles.emptyText}>Not enough history to display trend.</Text>
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Weights</Text>
        {(Object.keys(DEFAULT_WEIGHTS) as Array<keyof typeof DEFAULT_WEIGHTS>).map((factor) => (
          <View key={factor} style={styles.weightRow}>
            <Text style={styles.weightLabel}>{factor.replace(/([A-Z])/g, ' $1').trim()}</Text>
            <View style={styles.weightControls}>
              <TouchableOpacity
                onPress={() => handleWeightChange(factor, Math.max(0, weights[factor] - 0.05))}
                style={styles.weightButton}
              >
                <Text style={styles.weightButtonText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.weightValue}>{weights[factor].toFixed(2)}</Text>
              <TouchableOpacity
                onPress={() => handleWeightChange(factor, Math.min(1, weights[factor] + 0.05))}
                style={styles.weightButton}
              >
                <Text style={styles.weightButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </Card>

      {scoreInterventions.length > 0 && (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Interventions</Text>
          {scoreInterventions.map((intervention) => (
            <View key={intervention.id} style={styles.interventionRow}>
              <Text style={styles.interventionType}>{intervention.type}</Text>
              <Text style={styles.interventionDate}>
                {new Date(intervention.triggeredAt).toLocaleString()}
              </Text>
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
};

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background.primary,
    },
    content: {
      padding: spacing.lg,
    },
    title: {
      ...typography.h2,
      color: colors.text,
      marginBottom: spacing.xs,
    },
    subtitle: {
      ...typography.body2,
      color: colors.textSecondary,
      marginBottom: spacing.lg,
    },
    scoreCard: {
      backgroundColor: colors.background.secondary,
      borderRadius: borderRadius.lg,
      padding: spacing.lg,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    scoreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    scoreValue: {
      ...typography.h1,
      color: colors.text,
    },
    statusBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.sm,
    },
    statusText: {
      ...typography.caption,
      fontWeight: '700',
    },
    trendText: {
      ...typography.body2,
      color: colors.textSecondary,
    },
    overrideText: {
      ...typography.body2,
      color: colors.warning,
      marginTop: spacing.xs,
    },
    card: {
      marginBottom: spacing.md,
    },
    sectionTitle: {
      ...typography.h3,
      color: colors.text,
      marginBottom: spacing.sm,
    },
    breakdownRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    breakdownItem: {
      alignItems: 'center',
      flex: 1,
    },
    breakdownLabel: {
      ...typography.caption,
      color: colors.textSecondary,
      marginBottom: spacing.xs,
    },
    breakdownValue: {
      ...typography.body,
      color: colors.text,
      fontWeight: '600',
    },
    chartRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    rangeChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border.default,
      backgroundColor: colors.background.secondary,
    },
    rangeChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + '20',
    },
    rangeChipText: {
      ...typography.body2,
      color: colors.textSecondary,
    },
    rangeChipTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    chart: {
      alignSelf: 'center',
    },
    emptyText: {
      ...typography.body2,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingVertical: spacing.md,
    },
    weightRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    weightLabel: {
      ...typography.body,
      color: colors.text,
      flex: 1,
    },
    weightControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    weightButton: {
      width: 28,
      height: 28,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border.default,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background.secondary,
    },
    weightButtonText: {
      ...typography.body,
      color: colors.text,
    },
    weightValue: {
      ...typography.body,
      color: colors.text,
      width: 40,
      textAlign: 'center',
    },
    interventionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    interventionType: {
      ...typography.body,
      color: colors.text,
      textTransform: 'capitalize',
    },
    interventionDate: {
      ...typography.body2,
      color: colors.textSecondary,
    },
  });

export default CustomerHealthScreen;
