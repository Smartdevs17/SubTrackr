/**
 * FraudCaseCard
 *
 * Displays a single fraud case in the investigation workflow.
 * Shows risk score badge, subscriber details, signal pills, status badge,
 * evidence count, and action buttons (Approve / Block / Dismiss).
 *
 * The card supports an expand/collapse mode to show signal details
 * and evidence without leaving the list view.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Pressable } from 'react-native';
import { FraudCase } from '../../types/fraud';
import { colors, spacing, typography, borderRadius } from '../../utils/constants';

// ── Props ─────────────────────────────────────────────────────────────────────

interface FraudCaseCardProps {
  fraudCase: FraudCase;
  onApprove: (caseId: string) => void;
  onBlock: (caseId: string) => void;
  onDismiss: (caseId: string) => void;
  onViewEvidence?: (caseId: string) => void;
  expanded?: boolean;
  onToggleExpand?: (caseId: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function riskColor(score: number): string {
  if (score >= 80) return colors.error;
  if (score >= 50) return colors.warning;
  return colors.success;
}

function statusColor(status: FraudCase['status']): string {
  switch (status) {
    case 'pending':
      return colors.warning;
    case 'escalated':
      return colors.error;
    case 'reviewed':
      return colors.success;
    case 'dismissed':
      return colors.textSecondary;
    default:
      return colors.textSecondary;
  }
}

function statusLabel(status: FraudCase['status']): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'escalated':
      return 'Escalated';
    case 'reviewed':
      return 'Reviewed';
    case 'dismissed':
      return 'Dismissed';
    default:
      return status;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export const FraudCaseCard: React.FC<FraudCaseCardProps> = ({
  fraudCase,
  onApprove,
  onBlock,
  onDismiss,
  onViewEvidence,
  expanded = false,
  onToggleExpand,
}) => {
  const {
    caseId,
    merchantName,
    subscriberId,
    subscriptionName,
    riskScore,
    action,
    status,
    reason,
    evidence = [],
    notes,
    signals = [],
  } = fraudCase;

  const rc = riskColor(riskScore);
  const sc = statusColor(status);

  const handleToggle = () => onToggleExpand?.(caseId);

  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`Fraud case for ${merchantName}, risk score ${riskScore}`}>
      {/* Header row */}
      <Pressable
        onPress={handleToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityHint="Tap to expand or collapse case details">
        {/* Risk score badge */}
        <View style={[styles.scoreBadge, { backgroundColor: rc }]}>
          <Text style={styles.scoreText}>{riskScore}</Text>
        </View>

        {/* Merchant + subscription info */}
        <View style={styles.headerInfo}>
          <Text style={styles.merchantName} numberOfLines={1}>
            {merchantName}
          </Text>
          <Text style={styles.subscriptionName} numberOfLines={1}>
            {subscriptionName}
          </Text>
          <Text style={styles.subscriberId} numberOfLines={1}>
            {subscriberId}
          </Text>
        </View>

        {/* Status badge */}
        <View style={[styles.statusBadge, { backgroundColor: sc }]}>
          <Text style={styles.statusText}>{statusLabel(status)}</Text>
        </View>
      </Pressable>

      {/* Reason */}
      <Text style={styles.reason}>{reason}</Text>

      {/* Expanded content */}
      {expanded && (
        <View style={styles.expandedContent}>
          {/* Signals */}
          {signals.length > 0 && (
            <View style={styles.signalsRow}>
              {signals.map((signal, idx) => (
                <View
                  key={`${signal.kind}-${idx}`}
                  style={[styles.signalChip, { borderColor: riskColor(signal.score) }]}>
                  <Text style={styles.signalChipText}>
                    {signal.kind} ({signal.score})
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Notes */}
          {notes ? <Text style={styles.notesText}>Note: {notes}</Text> : null}

          {/* Evidence count */}
          {evidence.length > 0 && onViewEvidence && (
            <TouchableOpacity
              style={styles.evidenceButton}
              onPress={() => onViewEvidence(caseId)}
              accessibilityRole="button"
              accessibilityLabel={`View ${evidence.length} evidence item${evidence.length !== 1 ? 's' : ''}`}>
              <Text style={styles.evidenceButtonText}>
                View {evidence.length} evidence item{evidence.length !== 1 ? 's' : ''}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Action strip */}
      {status !== 'reviewed' && status !== 'dismissed' && (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, styles.approveButton]}
            onPress={() => onApprove(caseId)}
            accessibilityRole="button"
            accessibilityLabel="Approve this case">
            <Text style={styles.approveText}>Approve</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.blockButton]}
            onPress={() => onBlock(caseId)}
            accessibilityRole="button"
            accessibilityLabel="Block this case">
            <Text style={styles.blockText}>Block</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.dismissButton]}
            onPress={() => onDismiss(caseId)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss this case">
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Outcome badge for closed cases */}
      {(status === 'reviewed' || status === 'dismissed') && (
        <View style={styles.closedBanner}>
          <Text style={styles.closedBannerText}>
            {status === 'reviewed' ? `Case reviewed — action: ${action}` : 'Case dismissed'}
          </Text>
        </View>
      )}
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface ?? colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border ?? '#E5E7EB',
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scoreBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  scoreText: {
    ...typography.h3,
    color: '#fff',
    fontWeight: '700',
  },
  headerInfo: {
    flex: 1,
    gap: 2,
  },
  merchantName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  subscriptionName: {
    ...(typography.caption ?? typography.body),
    color: colors.textSecondary,
    fontSize: 13,
  },
  subscriberId: {
    ...(typography.caption ?? typography.body),
    color: colors.textSecondary,
    fontSize: 11,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    flexShrink: 0,
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reason: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
  },
  expandedContent: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border ?? '#E5E7EB',
    paddingTop: spacing.sm,
  },
  signalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  signalChip: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  signalChipText: {
    fontSize: 11,
    color: colors.text,
  },
  notesText: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 12,
    fontStyle: 'italic',
  },
  evidenceButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  evidenceButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border ?? '#E5E7EB',
    paddingTop: spacing.sm,
  },
  actionButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
  },
  approveButton: {
    backgroundColor: colors.success + '20',
    borderWidth: 1,
    borderColor: colors.success,
  },
  approveText: {
    color: colors.success,
    fontWeight: '600',
    fontSize: 13,
  },
  blockButton: {
    backgroundColor: colors.error + '20',
    borderWidth: 1,
    borderColor: colors.error,
  },
  blockText: {
    color: colors.error,
    fontWeight: '600',
    fontSize: 13,
  },
  dismissButton: {
    backgroundColor: colors.textSecondary + '20',
    borderWidth: 1,
    borderColor: colors.textSecondary,
  },
  dismissText: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 13,
  },
  closedBanner: {
    backgroundColor: colors.surface ?? '#F3F4F6',
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
  },
  closedBannerText: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
  },
});
