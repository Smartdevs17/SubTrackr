import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useDunningStore, RETRY_SCHEDULE_DAYS } from '../store/dunningStore';
import { DunningEntry, DunningStage } from '../types/dunning';
import { colors, spacing, typography, borderRadius } from '../utils/constants';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STAGE_COLOR: Record<DunningStage, string> = {
  retry: colors.warning,
  warn: '#f97316', // orange
  suspend: colors.error,
  cancel: '#6b7280', // gray
};

const STAGE_LABEL: Record<DunningStage, string> = {
  retry: 'Retrying',
  warn: 'Warning',
  suspend: 'Suspended',
  cancel: 'Cancelled',
};

const STAGE_ICON: Record<DunningStage, string> = {
  retry: '🔄',
  warn: '⚠️',
  suspend: '⏸️',
  cancel: '❌',
};

function formatTs(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeUntil(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return 'Now';
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  return `${h}h`;
}

// ─── Analytics bar ────────────────────────────────────────────────────────────

const AnalyticsBar: React.FC = () => {
  const getAnalytics = useDunningStore((s) => s.getAnalytics);
  const analytics = getAnalytics();

  const stats = [
    { label: 'Active', value: analytics.totalActiveDunning, color: colors.primary },
    { label: 'Retrying', value: analytics.stageBreakdown.retry, color: colors.warning },
    { label: 'Warned', value: analytics.stageBreakdown.warn, color: '#f97316' },
    { label: 'Suspended', value: analytics.stageBreakdown.suspend, color: colors.error },
    { label: 'Cancelled', value: analytics.stageBreakdown.cancel, color: '#6b7280' },
    { label: 'Recovery %', value: `${analytics.recoveryRate}%`, color: colors.success },
  ];

  return (
    <View style={styles.analyticsBar}>
      {stats.map((s) => (
        <View key={s.label} style={styles.statBox}>
          <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
          <Text style={styles.statLabel}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
};

// ─── Retry schedule chip row ──────────────────────────────────────────────────

const RetrySchedule: React.FC = () => (
  <View style={styles.scheduleRow}>
    <Text style={styles.scheduleTitle}>Retry schedule (days):</Text>
    <View style={styles.scheduleChips}>
      {RETRY_SCHEDULE_DAYS.map((d, i) => (
        <View key={d} style={styles.scheduleChip}>
          <Text style={styles.scheduleChipText}>
            {i + 1}. Day {d}
          </Text>
        </View>
      ))}
    </View>
  </View>
);

// ─── Entry card ───────────────────────────────────────────────────────────────

interface CardProps {
  entry: DunningEntry;
  onPress: (entry: DunningEntry) => void;
}

const EntryCard: React.FC<CardProps> = ({ entry, onPress }) => (
  <TouchableOpacity
    style={[styles.card, entry.isPaused && styles.cardPaused]}
    onPress={() => onPress(entry)}
    accessibilityRole="button"
    accessibilityLabel={`Dunning entry for subscription ${entry.subscriptionId}, stage ${STAGE_LABEL[entry.currentStage]}`}>
    <View style={styles.cardHeader}>
      <Text style={styles.cardIcon}>{STAGE_ICON[entry.currentStage]}</Text>
      <View style={styles.cardHeaderText}>
        <Text style={styles.cardSubId} numberOfLines={1}>
          {entry.subscriptionId}
        </Text>
        <Text style={styles.cardMeta}>Subscriber: {entry.subscriberId}</Text>
      </View>
      <View
        style={[styles.stageBadge, { backgroundColor: STAGE_COLOR[entry.currentStage] + '22' }]}>
        <Text style={[styles.stageBadgeText, { color: STAGE_COLOR[entry.currentStage] }]}>
          {STAGE_LABEL[entry.currentStage]}
        </Text>
      </View>
    </View>

    <View style={styles.cardBody}>
      <View style={styles.cardStat}>
        <Text style={styles.cardStatLabel}>Failed attempts</Text>
        <Text style={styles.cardStatValue}>{entry.totalFailedCharges}</Text>
      </View>
      <View style={styles.cardStat}>
        <Text style={styles.cardStatLabel}>Next action</Text>
        <Text style={styles.cardStatValue}>{timeUntil(entry.nextActionAt)}</Text>
      </View>
      <View style={styles.cardStat}>
        <Text style={styles.cardStatLabel}>First failure</Text>
        <Text style={styles.cardStatValue}>{formatTs(entry.firstFailureAt)}</Text>
      </View>
    </View>

    {entry.isPaused && (
      <View style={styles.pausedBanner}>
        <Text style={styles.pausedText}>⏸ Paused — awaiting manual review</Text>
      </View>
    )}
  </TouchableOpacity>
);

// ─── Detail sheet ─────────────────────────────────────────────────────────────

interface DetailProps {
  entry: DunningEntry;
  onClose: () => void;
}

const DetailSheet: React.FC<DetailProps> = ({ entry, onClose }) => {
  const {
    pauseDunning,
    resumeDunning,
    overrideStage,
    escalateToSupport,
    overrideDunning,
    recordPaymentAttempt,
  } = useDunningStore();

  const handleEscalate = () => {
    Alert.alert(
      'Escalate to Support',
      'This will pause automated retries and flag the case for human review.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Escalate',
          style: 'destructive',
          onPress: () => {
            escalateToSupport(entry.subscriptionId);
            onClose();
          },
        },
      ]
    );
  };

  const handleOverride = (resolution: 'resolved' | 'waived' | 'cancelled') => {
    Alert.alert(
      'Override Dunning',
      `Mark this case as "${resolution}" and remove it from dunning?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            overrideDunning(entry.subscriptionId, resolution);
            onClose();
          },
        },
      ]
    );
  };

  const handleManualPayment = () => {
    Alert.alert(
      'Record Manual Payment',
      'Mark this subscription as paid and remove from dunning?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Paid',
          onPress: () => {
            recordPaymentAttempt(entry.subscriptionId, true);
            onClose();
          },
        },
      ]
    );
  };

  const stages: DunningStage[] = ['retry', 'warn', 'suspend', 'cancel'];

  return (
    <View style={styles.sheetOverlay}>
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Dunning Details</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.sheetClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Info rows */}
          {[
            ['Subscription ID', entry.subscriptionId],
            ['Subscriber', entry.subscriberId],
            ['Plan', entry.planId],
            ['Stage', STAGE_LABEL[entry.currentStage]],
            ['Failed attempts (stage)', String(entry.failedAttempts)],
            ['Total failed charges', String(entry.totalFailedCharges)],
            ['Next action', formatTs(entry.nextActionAt)],
            ['First failure', formatTs(entry.firstFailureAt)],
            ['Last failure', formatTs(entry.lastFailureAt)],
            ['Status', entry.isPaused ? 'Paused' : 'Active'],
          ].map(([label, value]) => (
            <View key={label} style={styles.infoRow}>
              <Text style={styles.infoLabel}>{label}</Text>
              <Text style={styles.infoValue}>{value}</Text>
            </View>
          ))}

          {/* Communication log */}
          {entry.communicationLog.length > 0 && (
            <View style={styles.commSection}>
              <Text style={styles.commTitle}>Notification log</Text>
              {entry.communicationLog.map((c) => (
                <View key={c.id} style={styles.commRow}>
                  <Text style={styles.commChannel}>{c.channel.toUpperCase()}</Text>
                  <Text style={styles.commStage}>{STAGE_LABEL[c.stage]}</Text>
                  <Text style={styles.commDate}>{formatTs(c.sentAt)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Stage override */}
          <Text style={styles.sectionLabel}>Override stage</Text>
          <View style={styles.stageRow}>
            {stages.map((stage) => (
              <TouchableOpacity
                key={stage}
                style={[
                  styles.stageChip,
                  entry.currentStage === stage && { backgroundColor: STAGE_COLOR[stage] },
                ]}
                onPress={() => {
                  overrideStage(entry.subscriptionId, stage);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Set stage to ${STAGE_LABEL[stage]}`}>
                <Text
                  style={[
                    styles.stageChipText,
                    entry.currentStage === stage && { color: colors.text },
                  ]}>
                  {STAGE_LABEL[stage]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Actions */}
          <Text style={styles.sectionLabel}>Actions</Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                entry.isPaused
                  ? resumeDunning(entry.subscriptionId)
                  : pauseDunning(entry.subscriptionId);
                onClose();
              }}>
              <Text style={styles.actionBtnText}>{entry.isPaused ? '▶ Resume' : '⏸ Pause'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBtn} onPress={handleManualPayment}>
              <Text style={styles.actionBtnText}>💳 Manual Payment Override</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnWarn]}
              onPress={handleEscalate}>
              <Text style={[styles.actionBtnText, { color: colors.warning }]}>
                🚨 Escalate to Support
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnDanger]}
              onPress={() => handleOverride('resolved')}>
              <Text style={[styles.actionBtnText, { color: colors.success }]}>
                ✅ Mark Resolved
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnDanger]}
              onPress={() => handleOverride('waived')}>
              <Text style={[styles.actionBtnText, { color: colors.error }]}>🗑 Waive & Remove</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </View>
  );
};

// ─── Screen ───────────────────────────────────────────────────────────────────

const STAGE_FILTERS: (DunningStage | 'all')[] = ['all', 'retry', 'warn', 'suspend', 'cancel'];

const DunningDashboard: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const entries = useDunningStore((s) => s.entries);
  const [filter, setFilter] = useState<DunningStage | 'all'>('all');
  const [selected, setSelected] = useState<DunningEntry | null>(null);

  const filtered = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.currentStage === filter)),
    [entries, filter]
  );

  return (
    <SafeAreaView style={styles.container} testID="dunning-dashboard-screen">
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Dunning</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Analytics */}
      <AnalyticsBar />

      {/* Retry schedule */}
      <RetrySchedule />

      {/* Filter chips */}
      <View style={styles.filters}>
        {STAGE_FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
            accessibilityRole="radio"
            accessibilityState={{ checked: filter === f }}
            accessibilityLabel={f === 'all' ? 'All stages' : STAGE_LABEL[f]}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
              {f === 'all' ? 'All' : STAGE_LABEL[f]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <EntryCard entry={item} onPress={setSelected} />}
        contentContainerStyle={filtered.length === 0 ? styles.listEmpty : styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyTitle}>No active dunning cases</Text>
            <Text style={styles.emptyBody}>
              Failed payments will appear here and be retried automatically on days{' '}
              {RETRY_SCHEDULE_DAYS.join(', ')}.
            </Text>
          </View>
        }
      />

      {/* Detail sheet */}
      {selected ? <DetailSheet entry={selected} onClose={() => setSelected(null)} /> : null}
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: { padding: spacing.sm },
  backText: { ...typography.body, color: colors.primary, fontWeight: '500' },
  title: { ...typography.h2, color: colors.text, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 60 },

  // Analytics
  analyticsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  statBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center',
    minWidth: 70,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: { ...typography.h3, fontWeight: '700' },
  statLabel: { ...typography.small, color: colors.textSecondary, marginTop: 2 },

  // Retry schedule
  scheduleRow: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  scheduleTitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  scheduleChips: { flexDirection: 'row', gap: spacing.xs },
  scheduleChip: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scheduleChipText: { ...typography.small, color: colors.textSecondary },

  // Filters
  filters: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textSecondary },
  chipTextActive: { color: colors.text, fontWeight: '600' },

  // List
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  listEmpty: { flex: 1 },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPaused: { opacity: 0.7, borderStyle: 'dashed' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  cardIcon: { fontSize: 24, marginRight: spacing.sm },
  cardHeaderText: { flex: 1 },
  cardSubId: { ...typography.body, color: colors.text, fontWeight: '600' },
  cardMeta: { ...typography.caption, color: colors.textSecondary },
  stageBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  stageBadgeText: { ...typography.small, fontWeight: '600' },
  cardBody: { flexDirection: 'row', justifyContent: 'space-between' },
  cardStat: { alignItems: 'center' },
  cardStatLabel: { ...typography.small, color: colors.textSecondary },
  cardStatValue: { ...typography.body, color: colors.text, fontWeight: '600' },
  pausedBanner: {
    marginTop: spacing.sm,
    backgroundColor: colors.warning + '22',
    borderRadius: borderRadius.sm,
    padding: spacing.xs,
    alignItems: 'center',
  },
  pausedText: { ...typography.small, color: colors.warning },

  // Empty
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.sm },
  emptyBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Detail sheet
  sheetOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sheetTitle: { ...typography.h3, color: colors.text },
  sheetClose: { ...typography.h3, color: colors.textSecondary, padding: spacing.sm },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: { ...typography.body, color: colors.textSecondary },
  infoValue: { ...typography.body, color: colors.text, fontWeight: '500' },
  commSection: { marginTop: spacing.md, marginBottom: spacing.sm },
  commTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  commRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  commChannel: { ...typography.small, color: colors.accent, fontWeight: '600', width: 50 },
  commStage: { ...typography.small, color: colors.text, flex: 1 },
  commDate: { ...typography.small, color: colors.textSecondary },
  sectionLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  stageRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.sm },
  stageChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stageChipText: { ...typography.caption, color: colors.textSecondary },
  actions: { gap: spacing.sm, marginBottom: spacing.lg },
  actionBtn: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionBtnWarn: { borderColor: colors.warning + '66' },
  actionBtnDanger: { borderColor: colors.error + '44' },
  actionBtnText: { ...typography.body, color: colors.text, fontWeight: '600' },
});

export default DunningDashboard;
