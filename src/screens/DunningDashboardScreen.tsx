/**
 * DunningDashboardScreen — ML-enhanced dunning dashboard.
 * Extends the base DunningDashboard with:
 *  - Recovery funnel visualization
 *  - Smart retry decision display
 *  - Decline code breakdown
 *  - Multi-channel outreach stats
 *  - Card updater status
 */
import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useDunningStore } from '../store/dunningStore';
import { dunningEngine, smartRetryService, type DeclineCode } from '../services/smartRetryService';
import type { DunningStage } from '../types/dunning';
import { colors, spacing, typography, borderRadius } from '../utils/constants';

const DECLINE_CODE_LABELS: Record<DeclineCode, string> = {
  insufficient_funds: 'Insufficient funds',
  card_expired: 'Card expired',
  do_not_honor: 'Do not honor',
  card_lost_stolen: 'Lost / stolen',
  authentication_required: '3DS required',
  generic_decline: 'Generic decline',
};

const STAGE_COLORS: Record<DunningStage, string> = {
  retry: colors.warning,
  warn: '#f97316',
  suspend: colors.error,
  cancel: '#6b7280',
};

// ─── Recovery Funnel ──────────────────────────────────────────────────────────

const RecoveryFunnel: React.FC<{ entries: ReturnType<typeof useDunningStore>['entries'] }> = ({
  entries,
}) => {
  const stats = useMemo(() => dunningEngine.buildFunnelStats(entries), [entries]);

  const funnelSteps = [
    { label: 'Total at risk', count: stats.total, color: colors.primary },
    { label: 'Retrying', count: stats.retrying, color: colors.warning },
    { label: 'Recovered', count: stats.recovered, color: colors.success },
    { label: 'Failed / lost', count: stats.failed, color: colors.error },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>📊 Recovery Funnel</Text>
      <View style={styles.funnelRow}>
        {funnelSteps.map((step, i) => (
          <View key={step.label} style={styles.funnelStep}>
            <Text style={[styles.funnelCount, { color: step.color }]}>{step.count}</Text>
            <Text style={styles.funnelLabel}>{step.label}</Text>
            {i < funnelSteps.length - 1 && <Text style={styles.funnelArrow}>›</Text>}
          </View>
        ))}
      </View>
      <View style={styles.recoveryRateBar}>
        <View
          style={[
            styles.recoveryRateFill,
            { width: `${Math.min(stats.recoveryRate, 100)}%` as `${number}%` },
          ]}
        />
      </View>
      <Text style={styles.recoveryRateText}>Recovery rate: {stats.recoveryRate}%</Text>

      {/* Channel breakdown */}
      <Text style={styles.subTitle}>Outreach channels</Text>
      <View style={styles.channelRow}>
        {(['email', 'push', 'sms'] as const).map((ch) => {
          const d = stats.byChannel[ch];
          const rate = d.sent > 0 ? Math.round((d.conversions / d.sent) * 100) : 0;
          return (
            <View key={ch} style={styles.channelBox}>
              <Text style={styles.channelName}>{ch.toUpperCase()}</Text>
              <Text style={styles.channelStat}>{d.sent} sent</Text>
              <Text style={styles.channelStat}>{rate}% conv.</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

// ─── Stage Breakdown ──────────────────────────────────────────────────────────

const StageBreakdown: React.FC<{ entries: ReturnType<typeof useDunningStore>['entries'] }> = ({
  entries,
}) => {
  const breakdown: Record<DunningStage, number> = { retry: 0, warn: 0, suspend: 0, cancel: 0 };
  for (const e of entries) {
    breakdown[e.currentStage] = (breakdown[e.currentStage] ?? 0) + 1;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>🎯 Stage Breakdown</Text>
      <View style={styles.stageRow}>
        {(Object.keys(breakdown) as DunningStage[]).map((stage) => (
          <View key={stage} style={[styles.stageBox, { borderColor: STAGE_COLORS[stage] }]}>
            <Text style={[styles.stageCount, { color: STAGE_COLORS[stage] }]}>
              {breakdown[stage]}
            </Text>
            <Text style={styles.stageLabel}>{stage}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

// ─── Smart Retry Demo ─────────────────────────────────────────────────────────

const SmartRetryPanel: React.FC = () => {
  const [result, setResult] = useState<string | null>(null);
  const declineCodes: DeclineCode[] = [
    'insufficient_funds',
    'card_expired',
    'authentication_required',
    'generic_decline',
  ];

  const simulateRetry = (code: DeclineCode) => {
    const invoiceId = `demo_inv_${code}`;
    if (!smartRetryService.getRecord(invoiceId)) {
      smartRetryService.registerInvoice(invoiceId, 'demo_sub', 149.99, 'USD', 6);
    }
    const decision = smartRetryService.decideRetry(invoiceId, code);
    const msg = [
      `Decline: ${DECLINE_CODE_LABELS[code]}`,
      `Retry: ${decision.shouldRetry ? 'Yes' : 'No'}`,
      `Delay: ${decision.delayHours}h`,
      decision.splitAmount ? `Split: $${decision.splitAmount}` : '',
      `Channel: ${decision.outreachChannel.toUpperCase()}`,
      `Priority escalated: ${decision.escalatePriority ? 'Yes' : 'No'}`,
      `Reason: ${decision.reason}`,
    ]
      .filter(Boolean)
      .join('\n');
    setResult(msg);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>🤖 ML Smart Retry Simulator</Text>
      <Text style={styles.desc}>
        Tap a decline code to see the ML-optimized retry decision, amount splitting, and channel
        escalation.
      </Text>
      <View style={styles.codeChips}>
        {declineCodes.map((code) => (
          <TouchableOpacity
            key={code}
            style={styles.codeChip}
            onPress={() => simulateRetry(code)}
            accessibilityRole="button"
            accessibilityLabel={`Simulate ${DECLINE_CODE_LABELS[code]} decline`}>
            <Text style={styles.codeChipText}>{DECLINE_CODE_LABELS[code]}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {result && (
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>{result}</Text>
        </View>
      )}
    </View>
  );
};

// ─── Screen ───────────────────────────────────────────────────────────────────

const DunningDashboardScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const entries = useDunningStore((s) => s.entries);
  const startDunning = useDunningStore((s) => s.startDunning);

  const handleSeedDemo = () => {
    if (entries.length > 0) {
      Alert.alert('Demo data already seeded.');
      return;
    }
    startDunning('sub_001', 'user_1', 'merchant_1', 'pro_plan');
    startDunning('sub_002', 'user_2', 'merchant_1', 'basic_plan');
    Alert.alert('Demo seeded', '2 dunning cases created.');
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      accessibilityLabel="Dunning Dashboard screen">
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Dunning</Text>
        <TouchableOpacity
          onPress={handleSeedDemo}
          accessibilityRole="button"
          accessibilityLabel="Seed demo data">
          <Text style={styles.demoBtn}>Demo</Text>
        </TouchableOpacity>
      </View>

      <RecoveryFunnel entries={entries} />
      <StageBreakdown entries={entries} />
      <SmartRetryPanel />

      <TouchableOpacity
        style={styles.viewAllBtn}
        onPress={() => navigation.navigate('DunningDashboard')}
        accessibilityRole="button"
        accessibilityLabel="View full dunning dashboard">
        <Text style={styles.viewAllBtnText}>View Full Dunning List →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backText: { ...typography.body, color: colors.primary, fontWeight: '500' },
  title: { ...typography.h2, color: colors.text },
  demoBtn: { ...typography.body, color: colors.accent },
  card: {
    backgroundColor: colors.surface,
    margin: spacing.md,
    marginBottom: 0,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  subTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  desc: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },

  // Funnel
  funnelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginBottom: spacing.sm,
  },
  funnelStep: { alignItems: 'center', flex: 1 },
  funnelCount: { ...typography.h2, fontWeight: '700' },
  funnelLabel: {
    ...typography.small,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  funnelArrow: { fontSize: 20, color: colors.border, position: 'absolute', right: -8 },
  recoveryRateBar: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  recoveryRateFill: { height: '100%', backgroundColor: colors.success, borderRadius: 4 },
  recoveryRateText: { ...typography.small, color: colors.textSecondary, textAlign: 'center' },
  channelRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  channelBox: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  channelName: { ...typography.caption, color: colors.text, fontWeight: '700' },
  channelStat: { ...typography.small, color: colors.textSecondary, marginTop: 2 },

  // Stage breakdown
  stageRow: { flexDirection: 'row', gap: spacing.sm },
  stageBox: {
    flex: 1,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    backgroundColor: colors.background,
  },
  stageCount: { ...typography.h3, fontWeight: '700' },
  stageLabel: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: 2,
    textTransform: 'capitalize',
  },

  // Smart retry
  codeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  codeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeChipText: { ...typography.small, color: colors.text },
  resultBox: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xs,
  },
  resultText: { ...typography.caption, color: colors.text, lineHeight: 20 },

  // Footer
  viewAllBtn: {
    margin: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  viewAllBtnText: { ...typography.body, color: colors.text, fontWeight: '700' },
});

export default DunningDashboardScreen;
