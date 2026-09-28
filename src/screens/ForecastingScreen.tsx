/**
 * Subscription Metrics Forecasting Screen (#1232)
 *
 * Displays revenue & subscriber forecasts with model/horizon controls,
 * trend analysis, confidence intervals, and forecast alerts.
 */

import React, { useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import Svg, { Line, Rect, Circle, Text as SvgText, G } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components/common/Card';
import { useThemeColors } from '../hooks/useThemeColors';
import { useSubscriptionStore } from '../store';
import { useForecastingStore } from '../store/forecastingStore';
import { spacing, typography, borderRadius } from '../utils/constants';
import { formatCurrency } from '../utils/formatting';
import type {
  ForecastAlert,
  ForecastGranularity,
  ForecastHorizon,
  ForecastModel,
} from '../types/forecasting';

const { width: screenWidth } = Dimensions.get('window');
const CHART_W = screenWidth - spacing.lg * 2 - spacing.md * 2;
const CHART_H = 180;
const CHART_PAD_LEFT = 48;
const CHART_PAD_BOTTOM = 28;

// ── Sub-components ─────────────────────────────────────────────────────────

interface SegmentedControlProps<T extends string> {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  colors: ReturnType<typeof useThemeColors>;
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  colors,
}: SegmentedControlProps<T>) {
  return (
    <View style={segStyles.wrapper}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[
            segStyles.btn,
            { borderColor: colors.border.default },
            value === opt.value && { backgroundColor: colors.primary },
          ]}
          onPress={() => onChange(opt.value)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === opt.value }}>
          <Text
            style={[
              segStyles.label,
              { color: value === opt.value ? '#fff' : colors.text.secondary },
            ]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const segStyles = StyleSheet.create({
  wrapper: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  btn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
  },
  label: { ...typography.small },
});

// ── Alert badge ────────────────────────────────────────────────────────────

function AlertBadge({ alert, colors }: { alert: ForecastAlert; colors: ReturnType<typeof useThemeColors> }) {
  const bg =
    alert.severity === 'critical'
      ? colors.status.error
      : alert.severity === 'warning'
      ? colors.status.warning
      : colors.status.success;

  return (
    <View style={[alertStyles.container, { borderLeftColor: bg }]}>
      <Text style={[alertStyles.title, { color: colors.text.primary }]}>{alert.title}</Text>
      <Text style={[alertStyles.msg, { color: colors.text.secondary }]}>{alert.message}</Text>
    </View>
  );
}

const alertStyles = StyleSheet.create({
  container: {
    borderLeftWidth: 4,
    paddingLeft: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  title: { ...typography.body, fontWeight: '600' },
  msg: { ...typography.caption },
});

// ── Chart ──────────────────────────────────────────────────────────────────

function ForecastChart({
  historicalData,
  forecasts,
  colors,
}: {
  historicalData: { period: string; revenue: number }[];
  forecasts: { period: string; predictedRevenue: number; lowerBound: number; upperBound: number }[];
  colors: ReturnType<typeof useThemeColors>;
}) {
  const allRevenues = [
    ...historicalData.map((d) => d.revenue),
    ...forecasts.flatMap((f) => [f.lowerBound, f.upperBound]),
  ];
  const maxVal = Math.max(...allRevenues, 1);
  const minVal = Math.min(...allRevenues, 0);
  const range = maxVal - minVal || 1;

  const allPeriods = [
    ...historicalData.map((d) => d.period),
    ...forecasts.map((f) => f.period),
  ];
  const totalPoints = allPeriods.length;
  if (totalPoints === 0) return null;

  const usableW = CHART_W - CHART_PAD_LEFT - spacing.sm;
  const usableH = CHART_H - CHART_PAD_BOTTOM;

  const xPos = (i: number) => CHART_PAD_LEFT + (i / (totalPoints - 1 || 1)) * usableW;
  const yPos = (v: number) => usableH - ((v - minVal) / range) * usableH * 0.85;

  // Build historical polyline
  const histPoints = historicalData
    .map((d, i) => `${xPos(i).toFixed(1)},${yPos(d.revenue).toFixed(1)}`)
    .join(' ');

  // Build forecast polyline (starts at last historical index)
  const hLen = historicalData.length;
  const forecastPoints = forecasts
    .map((f, i) => `${xPos(hLen - 1 + i + 1).toFixed(1)},${yPos(f.predictedRevenue).toFixed(1)}`)
    .join(' ');

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: yPos(minVal + range * t),
    label: formatCurrency(minVal + range * t, 'USD'),
  }));

  // X-axis labels (show every other)
  const xLabels = allPeriods
    .map((p, i) => ({ i, label: p.slice(2, 7) }))
    .filter((_, i) => i % Math.max(1, Math.floor(totalPoints / 5)) === 0);

  return (
    <Svg width={CHART_W} height={CHART_H}>
      {/* Y-axis ticks */}
      {yTicks.map((t, i) => (
        <G key={i}>
          <Line
            x1={CHART_PAD_LEFT}
            y1={t.y}
            x2={CHART_W - spacing.sm}
            y2={t.y}
            stroke={colors.border.default}
            strokeWidth={0.5}
            strokeDasharray="3,3"
          />
          <SvgText
            x={CHART_PAD_LEFT - 4}
            y={t.y + 4}
            textAnchor="end"
            fontSize={8}
            fill={colors.text.secondary}>
            {t.label.replace('$', '$').split('.')[0]}
          </SvgText>
        </G>
      ))}

      {/* X-axis labels */}
      {xLabels.map(({ i, label }) => (
        <SvgText
          key={i}
          x={xPos(i)}
          y={CHART_H - 4}
          textAnchor="middle"
          fontSize={8}
          fill={colors.text.secondary}>
          {label}
        </SvgText>
      ))}

      {/* Confidence band (shaded) */}
      {forecasts.map((f, i) => {
        const xi = xPos(hLen - 1 + i + 1);
        const yu = yPos(f.upperBound);
        const yl = yPos(f.lowerBound);
        return (
          <Rect
            key={i}
            x={xi - 4}
            y={yu}
            width={8}
            height={Math.max(0, yl - yu)}
            fill={colors.primary}
            opacity={0.15}
          />
        );
      })}

      {/* Historical line */}
      {historicalData.length > 1 && (
        <Svg>
          {historicalData.slice(0, -1).map((_, i) => (
            <Line
              key={i}
              x1={xPos(i)}
              y1={yPos(historicalData[i].revenue)}
              x2={xPos(i + 1)}
              y2={yPos(historicalData[i + 1].revenue)}
              stroke={colors.text.primary}
              strokeWidth={2}
            />
          ))}
        </Svg>
      )}

      {/* Forecast line */}
      {forecasts.length > 0 && (
        <Svg>
          {/* Connect last historical to first forecast */}
          {historicalData.length > 0 && (
            <Line
              x1={xPos(hLen - 1)}
              y1={yPos(historicalData[hLen - 1].revenue)}
              x2={xPos(hLen)}
              y2={yPos(forecasts[0].predictedRevenue)}
              stroke={colors.primary}
              strokeWidth={2}
              strokeDasharray="5,3"
            />
          )}
          {forecasts.slice(0, -1).map((_, i) => (
            <Line
              key={i}
              x1={xPos(hLen + i)}
              y1={yPos(forecasts[i].predictedRevenue)}
              x2={xPos(hLen + i + 1)}
              y2={yPos(forecasts[i + 1].predictedRevenue)}
              stroke={colors.primary}
              strokeWidth={2}
              strokeDasharray="5,3"
            />
          ))}
          {/* Forecast dots */}
          {forecasts.map((f, i) => (
            <Circle
              key={i}
              cx={xPos(hLen + i)}
              cy={yPos(f.predictedRevenue)}
              r={3}
              fill={colors.primary}
            />
          ))}
        </Svg>
      )}

      {/* Historical dots */}
      {historicalData.map((d, i) => (
        <Circle
          key={i}
          cx={xPos(i)}
          cy={yPos(d.revenue)}
          r={3}
          fill={colors.text.primary}
        />
      ))}
    </Svg>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────

const MODEL_OPTIONS: { label: string; value: ForecastModel }[] = [
  { label: 'Linear', value: 'linear' },
  { label: 'Exp. Smooth', value: 'exponential' },
  { label: 'Moving Avg', value: 'moving_average' },
];

const HORIZON_OPTIONS: { label: string; value: ForecastHorizon }[] = [
  { label: '3M', value: 3 },
  { label: '6M', value: 6 },
  { label: '12M', value: 12 },
];

const GRANULARITY_OPTIONS: { label: string; value: ForecastGranularity }[] = [
  { label: 'Weekly', value: 'week' },
  { label: 'Monthly', value: 'month' },
  { label: 'Quarterly', value: 'quarter' },
];

const ForecastingScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { subscriptions } = useSubscriptionStore();
  const {
    currentForecast,
    historicalData,
    accuracy,
    selectedModel,
    selectedHorizon,
    selectedGranularity,
    isLoading,
    error,
    generateForecast,
    setModel,
    setHorizon,
    setGranularity,
    autoSelectModel,
    computeAccuracy,
    clearError,
  } = useForecastingStore();

  // Generate forecast on mount / when subscriptions change
  useEffect(() => {
    generateForecast(subscriptions);
  }, [subscriptions.length]);

  const handleAutoSelect = useCallback(() => {
    autoSelectModel();
  }, [autoSelectModel]);

  const handleComputeAccuracy = useCallback(() => {
    computeAccuracy(3);
  }, [computeAccuracy]);

  const forecast = currentForecast;
  const vizSummary = forecast?.visualization?.summary;

  const growthColor =
    (vizSummary?.growthRate ?? 0) >= 0 ? colors.status.success : colors.status.error;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Revenue Forecasting</Text>
          <Text style={styles.subtitle}>
            Subscription metrics forecast with confidence intervals
          </Text>
        </View>

        {/* Error banner */}
        {error && (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={clearError}>
              <Text style={[styles.errorText, { marginTop: 4, textDecorationLine: 'underline' }]}>
                Dismiss
              </Text>
            </TouchableOpacity>
          </Card>
        )}

        {/* Controls */}
        <Card style={styles.controlCard}>
          <Text style={styles.sectionLabel}>Forecast Model</Text>
          <SegmentedControl
            options={MODEL_OPTIONS}
            value={selectedModel}
            onChange={setModel}
            colors={colors}
          />

          <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Horizon</Text>
          <SegmentedControl
            options={HORIZON_OPTIONS}
            value={selectedHorizon}
            onChange={setHorizon}
            colors={colors}
          />

          <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Granularity</Text>
          <SegmentedControl
            options={GRANULARITY_OPTIONS}
            value={selectedGranularity}
            onChange={setGranularity}
            colors={colors}
          />

          <TouchableOpacity style={styles.autoBtn} onPress={handleAutoSelect}>
            <Text style={styles.autoBtnText}>🤖 Auto-Select Best Model</Text>
          </TouchableOpacity>
        </Card>

        {/* Summary KPIs */}
        {vizSummary && (
          <View style={styles.kpiRow}>
            <Card style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Current MRR</Text>
              <Text style={styles.kpiValue}>
                {formatCurrency(vizSummary.currentMrr, 'USD')}
              </Text>
            </Card>
            <Card style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Projected MRR</Text>
              <Text style={styles.kpiValue}>
                {formatCurrency(vizSummary.projectedMrr, 'USD')}
              </Text>
            </Card>
            <Card style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Growth</Text>
              <Text style={[styles.kpiValue, { color: growthColor }]}>
                {vizSummary.growthRate >= 0 ? '+' : ''}
                {vizSummary.growthRate.toFixed(1)}%
              </Text>
            </Card>
          </View>
        )}

        {/* Trend badges */}
        {forecast?.trend && (
          <View style={styles.trendRow}>
            <View style={[styles.trendBadge, { backgroundColor: colors.background.card }]}>
              <Text style={styles.trendBadgeLabel}>Trend</Text>
              <Text
                style={[
                  styles.trendBadgeValue,
                  {
                    color:
                      forecast.trend.direction === 'up'
                        ? colors.status.success
                        : forecast.trend.direction === 'down'
                        ? colors.status.error
                        : colors.text.secondary,
                  },
                ]}>
                {forecast.trend.direction === 'up'
                  ? '▲ Upward'
                  : forecast.trend.direction === 'down'
                  ? '▼ Downward'
                  : '→ Stable'}
              </Text>
            </View>
            <View style={[styles.trendBadge, { backgroundColor: colors.background.card }]}>
              <Text style={styles.trendBadgeLabel}>R² Strength</Text>
              <Text style={[styles.trendBadgeValue, { color: colors.text.primary }]}>
                {(forecast.trend.strength * 100).toFixed(0)}%
              </Text>
            </View>
            <View style={[styles.trendBadge, { backgroundColor: colors.background.card }]}>
              <Text style={styles.trendBadgeLabel}>Seasonality</Text>
              <Text style={[styles.trendBadgeValue, { color: colors.text.primary }]}>
                {forecast.trend.hasSeasonality ? 'Detected' : 'None'}
              </Text>
            </View>
          </View>
        )}

        {/* Chart */}
        <Card style={styles.chartCard} padding="none">
          <Text style={[styles.sectionLabel, { padding: spacing.md, paddingBottom: 0 }]}>
            Revenue Forecast
          </Text>
          <Text
            style={[
              styles.chartNote,
              { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
            ]}>
            — Historical &nbsp;&nbsp; - - Forecast (shaded = confidence interval)
          </Text>
          {isLoading ? (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={{ marginVertical: spacing.lg }}
            />
          ) : historicalData.length === 0 ? (
            <Text style={styles.emptyText}>Add subscriptions to generate forecasts.</Text>
          ) : (
            <View style={{ padding: spacing.md }}>
              <ForecastChart
                historicalData={historicalData}
                forecasts={forecast?.forecasts ?? []}
                colors={colors}
              />
            </View>
          )}
        </Card>

        {/* Forecast table */}
        {forecast && forecast.forecasts.length > 0 && (
          <Card style={styles.tableCard}>
            <Text style={styles.sectionLabel}>Forecast Detail</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCell, styles.tableHeadText, { flex: 2 }]}>Period</Text>
              <Text style={[styles.tableCell, styles.tableHeadText]}>Revenue</Text>
              <Text style={[styles.tableCell, styles.tableHeadText]}>Low</Text>
              <Text style={[styles.tableCell, styles.tableHeadText]}>High</Text>
              <Text style={[styles.tableCell, styles.tableHeadText]}>Subs</Text>
            </View>
            {forecast.forecasts.map((f) => (
              <View key={f.period} style={styles.tableRow}>
                <Text style={[styles.tableCell, { flex: 2, color: colors.text.primary }]}>
                  {f.period}
                </Text>
                <Text style={[styles.tableCell, { color: colors.primary }]}>
                  {formatCurrency(f.predictedRevenue, 'USD')}
                </Text>
                <Text style={[styles.tableCell, { color: colors.text.secondary }]}>
                  {formatCurrency(f.lowerBound, 'USD')}
                </Text>
                <Text style={[styles.tableCell, { color: colors.text.secondary }]}>
                  {formatCurrency(f.upperBound, 'USD')}
                </Text>
                <Text style={[styles.tableCell, { color: colors.text.primary }]}>
                  {f.predictedSubscribers}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {/* Alerts */}
        {forecast && forecast.alerts.length > 0 && (
          <Card style={styles.alertsCard}>
            <Text style={styles.sectionLabel}>Forecast Alerts</Text>
            {forecast.alerts.map((alert, i) => (
              <AlertBadge key={i} alert={alert} colors={colors} />
            ))}
          </Card>
        )}

        {/* Accuracy section */}
        <Card style={styles.accuracyCard}>
          <Text style={styles.sectionLabel}>Back-Test Accuracy</Text>
          {accuracy ? (
            <View style={styles.accuracyGrid}>
              <View style={styles.accuracyItem}>
                <Text style={styles.accLabel}>MAE</Text>
                <Text style={styles.accValue}>{formatCurrency(accuracy.mae, 'USD')}</Text>
              </View>
              <View style={styles.accuracyItem}>
                <Text style={styles.accLabel}>MAPE</Text>
                <Text style={styles.accValue}>{accuracy.mape.toFixed(1)}%</Text>
              </View>
              <View style={styles.accuracyItem}>
                <Text style={styles.accLabel}>RMSE</Text>
                <Text style={styles.accValue}>{formatCurrency(accuracy.rmse, 'USD')}</Text>
              </View>
              <View style={styles.accuracyItem}>
                <Text style={styles.accLabel}>R²</Text>
                <Text style={styles.accValue}>{accuracy.rSquared.toFixed(3)}</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.emptyText}>
              Run back-test to evaluate forecast accuracy against hold-out data.
            </Text>
          )}
          <TouchableOpacity style={styles.autoBtn} onPress={handleComputeAccuracy}>
            <Text style={styles.autoBtnText}>Run Back-Test (last 3 periods)</Text>
          </TouchableOpacity>
        </Card>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    scroll: { paddingHorizontal: spacing.lg },
    header: { paddingTop: spacing.lg, paddingBottom: spacing.md },
    title: { ...typography.h1, color: colors.text.primary, marginBottom: spacing.xs },
    subtitle: { ...typography.body, color: colors.text.secondary },

    errorCard: {
      marginBottom: spacing.md,
      backgroundColor: colors.status.error,
      padding: spacing.md,
    },
    errorText: { ...typography.caption, color: '#fff' },

    controlCard: { marginBottom: spacing.md },
    sectionLabel: { ...typography.h3, color: colors.text.primary, marginBottom: spacing.sm },

    autoBtn: {
      marginTop: spacing.md,
      backgroundColor: colors.primary,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      alignItems: 'center',
    },
    autoBtnText: { ...typography.button, color: '#fff' },

    kpiRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    kpiCard: { flex: 1, alignItems: 'center', padding: spacing.sm },
    kpiLabel: { ...typography.small, color: colors.text.secondary, marginBottom: 2 },
    kpiValue: { ...typography.h3, color: colors.text.primary },

    trendRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    trendBadge: {
      flex: 1,
      borderRadius: borderRadius.md,
      padding: spacing.sm,
      alignItems: 'center',
    },
    trendBadgeLabel: { ...typography.small, color: colors.text.secondary },
    trendBadgeValue: { ...typography.body, fontWeight: '600' },

    chartCard: { marginBottom: spacing.md, overflow: 'hidden' },
    chartNote: { ...typography.small, color: colors.text.secondary },
    emptyText: {
      ...typography.body,
      color: colors.text.secondary,
      textAlign: 'center',
      padding: spacing.lg,
    },

    tableCard: { marginBottom: spacing.md },
    tableHeader: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
      paddingBottom: spacing.xs,
      marginBottom: spacing.xs,
    },
    tableHeadText: { ...typography.small, color: colors.text.secondary, fontWeight: '600' },
    tableRow: {
      flexDirection: 'row',
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    tableCell: { ...typography.small, flex: 1, textAlign: 'right' },

    alertsCard: { marginBottom: spacing.md },

    accuracyCard: { marginBottom: spacing.md },
    accuracyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.md },
    accuracyItem: { flex: 1, minWidth: 80, alignItems: 'center' },
    accLabel: { ...typography.small, color: colors.text.secondary },
    accValue: { ...typography.h3, color: colors.text.primary },
  });
}

export default ForecastingScreen;
