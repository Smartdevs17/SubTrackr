import React, { useState, useMemo } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { Chargeback, ChargebackStatus, REASON_CODES } from '../../backend/chargeback/domain/types';

// ─── Mock Data ───────────────────────────────────────────────────────────────
const MOCK_CHARGEBACKS: Chargeback[] = [
  {
    id: 'cb_001',
    transactionId: 'txn_abc123',
    merchantId: 'merch_1',
    amount: 4999,
    currency: 'USD',
    network: 'visa',
    reasonCode: '13.1',
    status: 'under_review',
    filedAt: '2026-06-15T10:00:00Z',
    representmentDeadline: '2026-06-27T10:00:00Z',
    evidenceItems: [
      { id: 'ev1', chargebackId: 'cb_001', description: 'Proof of delivery', autoPopulated: true },
      { id: 'ev2', chargebackId: 'cb_001', description: 'Customer comms', autoPopulated: true },
    ],
    isRefundedTransaction: false,
    isPreArbitration: false,
    isSecondChargeback: false,
    createdAt: '2026-06-15T10:00:00Z',
    updatedAt: '2026-06-15T10:00:00Z',
  },
  {
    id: 'cb_002',
    transactionId: 'txn_def456',
    merchantId: 'merch_1',
    amount: 12000,
    currency: 'USD',
    network: 'mastercard',
    reasonCode: '4853',
    status: 'won',
    filedAt: '2026-05-10T08:00:00Z',
    representmentDeadline: '2026-05-25T08:00:00Z',
    evidenceItems: [],
    isRefundedTransaction: true,
    isPreArbitration: false,
    isSecondChargeback: false,
    createdAt: '2026-05-10T08:00:00Z',
    updatedAt: '2026-05-20T08:00:00Z',
  },
  {
    id: 'cb_003',
    transactionId: 'txn_ghi789',
    merchantId: 'merch_1',
    amount: 7500,
    currency: 'USD',
    network: 'amex',
    reasonCode: 'C28',
    status: 'pre_arbitration',
    filedAt: '2026-06-01T12:00:00Z',
    representmentDeadline: '2026-06-28T12:00:00Z',
    evidenceItems: [],
    isRefundedTransaction: false,
    isPreArbitration: true,
    isSecondChargeback: false,
    createdAt: '2026-06-01T12:00:00Z',
    updatedAt: '2026-06-10T12:00:00Z',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<ChargebackStatus, string> = {
  received: colors.accent,
  under_review: colors.warning,
  evidence_submitted: colors.primary,
  won: colors.success,
  lost: colors.error,
  pre_arbitration: '#f97316',
  second_chargeback: '#ec4899',
};

function daysUntil(isoDate: string): number {
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86400000);
}

function formatAmount(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

function getReasonLabel(network: string, code: string): string {
  const map = REASON_CODES[network as keyof typeof REASON_CODES];
  return map?.[code] ?? code;
}

// ─── Component ────────────────────────────────────────────────────────────────
const ChargebackDashboardScreen: React.FC = () => {
  const [selected, setSelected] = useState<Chargeback | null>(null);
  const data = MOCK_CHARGEBACKS;

  const analytics = useMemo(() => {
    const won = data.filter((c) => c.status === 'won').length;
    const lost = data.filter((c) => c.status === 'lost').length;
    const resolved = won + lost;
    const byCode: Record<string, number> = {};
    data.forEach((c) => {
      byCode[c.reasonCode] = (byCode[c.reasonCode] ?? 0) + 1;
    });
    return {
      won,
      lost,
      total: data.length,
      winRate: resolved > 0 ? (won / resolved) * 100 : 0,
      byCode,
    };
  }, [data]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <Text style={styles.title}>Chargeback Management</Text>
        <Text style={styles.subtitle}>Track, respond to, and analyze chargebacks</Text>

        {/* Analytics Summary */}
        <View style={styles.metricsRow}>
          <Card style={styles.metricCard}>
            <Text style={styles.metricValue}>{analytics.total}</Text>
            <Text style={styles.metricLabel}>Total</Text>
          </Card>
          <Card style={[styles.metricCard, { borderColor: colors.success }]}>
            <Text style={[styles.metricValue, { color: colors.success }]}>{analytics.won}</Text>
            <Text style={styles.metricLabel}>Won</Text>
          </Card>
          <Card style={[styles.metricCard, { borderColor: colors.error }]}>
            <Text style={[styles.metricValue, { color: colors.error }]}>{analytics.lost}</Text>
            <Text style={styles.metricLabel}>Lost</Text>
          </Card>
          <Card style={[styles.metricCard, { borderColor: colors.primary }]}>
            <Text style={[styles.metricValue, { color: colors.primary }]}>
              {analytics.winRate.toFixed(0)}%
            </Text>
            <Text style={styles.metricLabel}>Win Rate</Text>
          </Card>
        </View>

        {/* Reason Code Distribution */}
        <Text style={styles.sectionTitle}>By Reason Code</Text>
        <Card style={styles.codeCard}>
          {Object.entries(analytics.byCode).map(([code, count]) => (
            <View key={code} style={styles.codeRow}>
              <Text style={styles.codeText}>{code}</Text>
              <Text style={styles.codeCount}>{count}</Text>
            </View>
          ))}
        </Card>

        {/* Chargeback List */}
        <Text style={styles.sectionTitle}>Open Cases</Text>
        {data.map((cb) => {
          const days = daysUntil(cb.representmentDeadline);
          const isUrgent = days <= 3 && cb.status !== 'won' && cb.status !== 'lost';
          return (
            <TouchableOpacity
              key={cb.id}
              onPress={() => setSelected(selected?.id === cb.id ? null : cb)}>
              <Card style={[styles.caseCard, isUrgent && styles.urgentCard]}>
                <View style={styles.caseHeader}>
                  <View>
                    <Text style={styles.caseId}>#{cb.transactionId}</Text>
                    <Text style={styles.caseNetwork}>
                      {cb.network.toUpperCase()} · {cb.reasonCode}
                    </Text>
                    <Text style={styles.caseReason} numberOfLines={1}>
                      {getReasonLabel(cb.network, cb.reasonCode)}
                    </Text>
                  </View>
                  <View style={styles.caseRight}>
                    <Text style={styles.caseAmount}>{formatAmount(cb.amount, cb.currency)}</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: STATUS_COLOR[cb.status] + '33' },
                      ]}>
                      <Text style={[styles.statusText, { color: STATUS_COLOR[cb.status] }]}>
                        {cb.status.replace(/_/g, ' ')}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Deadline countdown */}
                {cb.status !== 'won' && cb.status !== 'lost' && (
                  <View style={[styles.deadlineRow, isUrgent && styles.deadlineUrgent]}>
                    <Text style={[styles.deadlineText, isUrgent && { color: colors.error }]}>
                      {days <= 0 ? 'DEADLINE PASSED' : `Deadline in ${days}d`}
                      {isUrgent ? ' — ESCALATED' : ''}
                    </Text>
                  </View>
                )}

                {/* Edge case flags */}
                <View style={styles.flagsRow}>
                  {cb.isRefundedTransaction && (
                    <View style={styles.flag}>
                      <Text style={styles.flagText}>⚠ Refunded Txn</Text>
                    </View>
                  )}
                  {cb.isPreArbitration && (
                    <View style={[styles.flag, { backgroundColor: '#f9731622' }]}>
                      <Text style={[styles.flagText, { color: '#f97316' }]}>Pre-Arbitration</Text>
                    </View>
                  )}
                  {cb.isSecondChargeback && (
                    <View style={[styles.flag, { backgroundColor: '#ec489922' }]}>
                      <Text style={[styles.flagText, { color: '#ec4899' }]}>2nd Chargeback</Text>
                    </View>
                  )}
                </View>

                {/* Expanded evidence checklist */}
                {selected?.id === cb.id && cb.evidenceItems.length > 0 && (
                  <View style={styles.evidenceBox}>
                    <Text style={styles.evidenceTitle}>Evidence Checklist</Text>
                    {cb.evidenceItems.map((ev) => (
                      <Text key={ev.id} style={styles.evidenceItem}>
                        {ev.submittedAt ? '✅' : ev.fileUrl ? '📎' : '☐'} {ev.description}
                        {ev.autoPopulated ? ' (auto)' : ''}
                      </Text>
                    ))}
                  </View>
                )}
              </Card>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
};

export default ChargebackDashboardScreen;

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  title: { ...typography.h2, color: colors.text, marginBottom: spacing.xs },
  subtitle: { ...typography.body2, color: colors.textSecondary, marginBottom: spacing.lg },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  metricsRow: { flexDirection: 'row', gap: spacing.sm },
  metricCard: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricValue: { ...typography.h2, color: colors.text },
  metricLabel: { ...typography.small, color: colors.textSecondary },
  codeCard: { padding: spacing.md },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  codeText: { ...typography.body2, color: colors.textSecondary },
  codeCount: { ...typography.body2, color: colors.text, fontWeight: '600' },
  caseCard: { marginBottom: spacing.sm, padding: spacing.md },
  urgentCard: { borderColor: colors.error, borderWidth: 1 },
  caseHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  caseId: { ...typography.body2, color: colors.textSecondary },
  caseNetwork: { ...typography.small, color: colors.accent },
  caseReason: { ...typography.body2, color: colors.text, maxWidth: 200 },
  caseRight: { alignItems: 'flex-end' },
  caseAmount: { ...typography.body, color: colors.text, fontWeight: '600' },
  statusBadge: {
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: spacing.xs,
  },
  statusText: { ...typography.small, fontWeight: '600', textTransform: 'capitalize' },
  deadlineRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  deadlineUrgent: { borderTopColor: colors.error + '44' },
  deadlineText: { ...typography.small, color: colors.warning },
  flagsRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' },
  flag: {
    backgroundColor: colors.warningBackground,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  flagText: { ...typography.small, color: colors.warning },
  evidenceBox: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  evidenceTitle: {
    ...typography.body2,
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  evidenceItem: { ...typography.small, color: colors.textSecondary, marginBottom: 2 },
});
