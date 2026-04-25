import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Switch,
  Alert,
  Dimensions,
} from 'react-native';
import Svg, { Rect, Text as SvgText, Line, G } from 'react-native-svg';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { Card } from '../components/common/Card';
import { useSubscriptionStore } from '../store/subscriptionStore';
import {
  useAccountingStore,
  RecognitionMethod,
  billingCycleToMs,
  splitRecognisedDeferred,
} from '../store/accountingStore';

const { width: screenWidth } = Dimensions.get('window');
const CHART_WIDTH = screenWidth - spacing.xl * 2;
const CHART_HEIGHT = 180;

type PeriodRange = 'month' | 'quarter' | 'year';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PERIOD_RANGE_MS: Record<PeriodRange, number> = {
  month: 30 * MS_PER_DAY,
  quarter: 90 * MS_PER_DAY,
  year: 365 * MS_PER_DAY,
};

const BUCKET_MS: Record<PeriodRange, number> = {
  month: 7 * MS_PER_DAY, // weekly buckets
  quarter: 30 * MS_PER_DAY, // monthly buckets
  year: 30 * MS_PER_DAY, // monthly buckets
};

const BUCKET_LABELS: Record<PeriodRange, string[]> = {
  month: ['W1', 'W2', 'W3', 'W4', 'W5'],
  quarter: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  year: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const RevenueReportScreen: React.FC = () => {
  const { subscriptions } = useSubscriptionStore();
  const {
    rules,
    schedules,
    deferredRevenue,
    setRecognitionRule,
    removeRecognitionRule,
    generateRevenueSchedule,
    getRevenueAnalyticsByPeriod,
  } = useAccountingStore();

  const [periodRange, setPeriodRange] = useState<PeriodRange>('month');
  const [configSubId, setConfigSubId] = useState<string | null>(null);

  // ── Revenue recognition snapshots ─────────────────────────────────────────
  // Computed directly from state slices — no store action calls inside memos.

  const recognitionData = useMemo(() => {
    const now = Date.now();
    return subscriptions
      .filter((s) => s.isActive)
      .map((s) => {
        const schedule = schedules[s.id];
        const { recognised, deferred } = schedule
          ? splitRecognisedDeferred(schedule, now)
          : { recognised: 0, deferred: 0 };
        return {
          id: s.id,
          name: s.name,
          recognised,
          deferred,
          total: recognised + deferred,
          method: rules[s.id]?.method ?? ('straight-line' as RecognitionMethod),
        };
      });
  }, [subscriptions, schedules, rules]);

  const totalRecognised = useMemo(
    () => recognitionData.reduce((sum, d) => sum + d.recognised, 0),
    [recognitionData]
  );

  // Read deferred balance directly from state — always reactive.
  const totalDeferred = deferredRevenue['default'] ?? 0;

  // ── Analytics chart data ──────────────────────────────────────────────────

  const chartData = useMemo(() => {
    const now = Date.now();
    const from = now - PERIOD_RANGE_MS[periodRange];
    const bucketMs = BUCKET_MS[periodRange];
    const analytics = getRevenueAnalyticsByPeriod(bucketMs, from, now);
    return analytics.map((bucket, i) => ({
      label: BUCKET_LABELS[periodRange][i % BUCKET_LABELS[periodRange].length],
      amount: bucket.recognisedAmount,
      count: bucket.subscriptionCount,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodRange, schedules, getRevenueAnalyticsByPeriod]);

  const maxAmount = Math.max(...chartData.map((d) => d.amount), 1);
  const barWidth = Math.max(4, (CHART_WIDTH - 40) / Math.max(chartData.length, 1) - 6);

  // ── Config helpers ────────────────────────────────────────────────────────

  const handleSimulateCharge = useCallback(
    (subId: string) => {
      const sub = subscriptions.find((s) => s.id === subId);
      if (!sub) return;
      generateRevenueSchedule(sub.id, sub.price, Date.now(), sub.billingCycle);
      Alert.alert('Charge simulated', `Revenue schedule generated for "${sub.name}".`);
    },
    [subscriptions, generateRevenueSchedule]
  );

  const handleToggleMethod = useCallback(
    (subId: string, current: RecognitionMethod) => {
      const next: RecognitionMethod = current === 'straight-line' ? 'usage-based' : 'straight-line';
      const sub = subscriptions.find((s) => s.id === subId);
      if (!sub) return;
      const intervalMs = billingCycleToMs(sub.billingCycle);
      setRecognitionRule({
        subscriptionId: subId,
        method: next,
        recognitionPeriodMs: intervalMs,
      });
    },
    [subscriptions, setRecognitionRule]
  );

  const handleRemoveRule = useCallback(
    (subId: string) => {
      removeRecognitionRule(subId);
      if (configSubId === subId) setConfigSubId(null);
    },
    [removeRecognitionRule, configSubId]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (!subscriptions.length) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>💰</Text>
          <Text style={styles.emptyTitle}>No Revenue Data</Text>
          <Text style={styles.emptyText}>Add subscriptions to track revenue recognition.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Revenue Report</Text>
          <Text style={styles.subtitle}>Recognition & deferred revenue</Text>
        </View>

        {/* Summary cards */}
        <View style={styles.summaryRow}>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Recognised</Text>
            <Text style={[styles.summaryValue, { color: colors.primary }]}>
              ${totalRecognised.toFixed(2)}
            </Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Deferred</Text>
            <Text style={[styles.summaryValue, { color: '#FF9800' }]}>
              ${totalDeferred.toFixed(2)}
            </Text>
          </Card>
        </View>

        {/* Period selector */}
        <View style={styles.periodRow}>
          {(['month', 'quarter', 'year'] as PeriodRange[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.periodBtn, periodRange === p && styles.periodBtnActive]}
              onPress={() => setPeriodRange(p)}>
              <Text style={[styles.periodBtnText, periodRange === p && styles.periodBtnTextActive]}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Revenue chart */}
        <Card style={styles.chartCard}>
          <Text style={styles.chartTitle}>Recognised Revenue by Period</Text>
          {chartData.every((d) => d.amount === 0) ? (
            <Text style={styles.noDataText}>
              No recognised revenue yet. Simulate a charge below.
            </Text>
          ) : (
            <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
              <Line
                x1={30}
                y1={10}
                x2={30}
                y2={CHART_HEIGHT - 30}
                stroke={colors.border}
                strokeWidth={1}
              />
              <Line
                x1={30}
                y1={CHART_HEIGHT - 30}
                x2={CHART_WIDTH - 10}
                y2={CHART_HEIGHT - 30}
                stroke={colors.border}
                strokeWidth={1}
              />
              {chartData.map((data, index) => {
                const barHeight = Math.max(2, (data.amount / maxAmount) * (CHART_HEIGHT - 60));
                const x = 35 + index * (barWidth + 6);
                const y = CHART_HEIGHT - 30 - barHeight;
                return (
                  <G key={`${data.label}-${index}`}>
                    <Rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      fill={colors.primary}
                      rx={3}
                    />
                    <SvgText
                      x={x + barWidth / 2}
                      y={CHART_HEIGHT - 14}
                      fontSize={9}
                      fill={colors.textSecondary}
                      textAnchor="middle">
                      {data.label}
                    </SvgText>
                    {data.amount > 0 && (
                      <SvgText
                        x={x + barWidth / 2}
                        y={y - 4}
                        fontSize={9}
                        fill={colors.text}
                        textAnchor="middle">
                        ${data.amount.toFixed(0)}
                      </SvgText>
                    )}
                  </G>
                );
              })}
            </Svg>
          )}
        </Card>

        {/* Per-subscription recognition table */}
        <Card style={styles.tableCard}>
          <Text style={styles.chartTitle}>Subscription Recognition</Text>
          {recognitionData.map((item) => (
            <View key={item.id} style={styles.tableRow}>
              <View style={styles.tableLeft}>
                <Text style={styles.tableName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.tableMethod}>{item.method}</Text>
              </View>
              <View style={styles.tableRight}>
                <Text style={styles.tableRecognised}>${item.recognised.toFixed(2)}</Text>
                <Text style={styles.tableDeferred}>↓ ${item.deferred.toFixed(2)}</Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Revenue configuration */}
        <Card style={styles.configCard}>
          <Text style={styles.chartTitle}>Revenue Configuration</Text>
          <Text style={styles.configHint}>
            Configure recognition method per subscription. Tap a row to expand.
          </Text>
          {subscriptions
            .filter((s) => s.isActive)
            .map((sub) => {
              const rule = rules[sub.id];
              const method: RecognitionMethod = rule?.method ?? 'straight-line';
              const isExpanded = configSubId === sub.id;

              return (
                <View key={sub.id}>
                  <TouchableOpacity
                    style={styles.configRow}
                    onPress={() => setConfigSubId(isExpanded ? null : sub.id)}>
                    <Text style={styles.configName} numberOfLines={1}>
                      {sub.name}
                    </Text>
                    <Text style={styles.configChevron}>{isExpanded ? '▲' : '▼'}</Text>
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.configDetail}>
                      {/* Method toggle */}
                      <View style={styles.configDetailRow}>
                        <Text style={styles.configDetailLabel}>Usage-based</Text>
                        <Switch
                          value={method === 'usage-based'}
                          onValueChange={() => handleToggleMethod(sub.id, method)}
                          trackColor={{ false: colors.border, true: colors.primary }}
                          thumbColor={colors.surface}
                        />
                      </View>
                      <Text style={styles.configMethodDesc}>
                        {method === 'straight-line'
                          ? 'Revenue spread evenly across the billing period (ASC 606 default).'
                          : 'Revenue deferred until actual usage is reported by the merchant.'}
                      </Text>

                      {/* Simulate charge */}
                      <TouchableOpacity
                        style={styles.simulateBtn}
                        onPress={() => handleSimulateCharge(sub.id)}>
                        <Text style={styles.simulateBtnText}>Simulate Charge</Text>
                      </TouchableOpacity>

                      {/* Remove rule */}
                      {rule && (
                        <TouchableOpacity
                          style={styles.removeBtn}
                          onPress={() => handleRemoveRule(sub.id)}>
                          <Text style={styles.removeBtnText}>Reset to Default</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  header: { padding: spacing.lg, paddingBottom: spacing.md },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary },

  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  summaryCard: { flex: 1, alignItems: 'center' },
  summaryLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  summaryValue: { ...typography.h2, fontWeight: '700' },

  periodRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  periodBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  periodBtnText: { ...typography.body, color: colors.text },
  periodBtnTextActive: { color: colors.text, fontWeight: '600' },

  chartCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  chartTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
  noDataText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },

  tableCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableLeft: { flex: 1, marginRight: spacing.md },
  tableName: { ...typography.body, color: colors.text, fontWeight: '600' },
  tableMethod: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  tableRight: { alignItems: 'flex-end' },
  tableRecognised: { ...typography.body, color: colors.primary, fontWeight: '600' },
  tableDeferred: { ...typography.caption, color: '#FF9800' },

  configCard: { marginHorizontal: spacing.lg, marginBottom: spacing.xl },
  configHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  configName: { ...typography.body, color: colors.text, flex: 1 },
  configChevron: { ...typography.body, color: colors.textSecondary, marginLeft: spacing.sm },
  configDetail: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  configDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  configDetailLabel: { ...typography.body, color: colors.text },
  configMethodDesc: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  simulateBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  simulateBtnText: { ...typography.body, color: colors.text, fontWeight: '600' },
  removeBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  removeBtnText: { ...typography.body, color: colors.textSecondary },

  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emptyIcon: { fontSize: 64, marginBottom: spacing.md },
  emptyTitle: { ...typography.h2, color: colors.text, marginBottom: spacing.sm },
  emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});

export default RevenueReportScreen;
