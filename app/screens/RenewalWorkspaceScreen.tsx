// Issue 560: Renewal Workspace Screen

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing } from '../../src/utils/constants';
import { Card } from '../../src/components/common/Card';
import { renewalService } from '../../backend/services/renewal/renewalService';
import type {
  RenewalRecord,
  RenewalStatus,
  WinLossReason,
} from '../../src/types/renewal';

const STATUS_LABELS: Record<RenewalStatus, string> = {
  pending: 'Pending',
  negotiating: 'Negotiating',
  awaiting_approval: 'Awaiting Approval',
  awaiting_signature: 'Awaiting Signature',
  signed: 'Signed',
  auto_renewed: 'Auto-Renewed',
  won: 'Won',
  lost: 'Lost',
  frozen: 'Frozen',
};

const STATUS_COLORS: Record<RenewalStatus, string> = {
  pending: '#F29900',
  negotiating: '#1A73E8',
  awaiting_approval: '#E37400',
  awaiting_signature: '#9334E6',
  signed: '#1E8E3E',
  auto_renewed: '#1E8E3E',
  won: '#1E8E3E',
  lost: '#D93025',
  frozen: '#5F6368',
};

const WIN_LOSS_REASONS: WinLossReason[] = [
  'accepted_offer',
  'custom_terms_agreed',
  'price_too_high',
  'competitor',
  'budget_cut',
  'scope_change',
  'other',
];

interface RenewalWorkspaceScreenProps {
  renewalId?: string;
}

const RenewalWorkspaceScreen: React.FC<RenewalWorkspaceScreenProps> = ({ renewalId }) => {
  const [loading, setLoading] = useState(false);
  const [renewal, setRenewal] = useState<RenewalRecord | null>(
    renewalId ? (() => {
      try { return renewalService.getRenewal(renewalId); } catch { return null; }
    })() : null
  );
  const [demoMode, setDemoMode] = useState(!renewalId);
  const [negotiationText, setNegotiationText] = useState('');
  const [discountText, setDiscountText] = useState('0');

  const createDemo = useCallback(() => {
    setLoading(true);
    try {
      // Seed a demo approval chain
      renewalService.configureApprovalChain('demo_merchant', [
        'sales_manager',
        'finance',
        'legal',
      ]);
      const endDate = Date.now() + 25 * 86_400_000; // 25 days from now
      const r = renewalService.createRenewal(
        'sub_demo_001',
        'subscriber_001',
        'demo_merchant',
        endDate,
        'opt_in'
      );
      renewalService.generateQuote(r.id, 1200, 5, 0);
      setRenewal(renewalService.getRenewal(r.id));
      setDemoMode(false);
    } catch (e) {
      Alert.alert('Error', String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    if (!renewal) return;
    try {
      setRenewal(renewalService.getRenewal(renewal.id));
    } catch { /* ignore */ }
  }, [renewal]);

  const handleOpenNegotiation = () => {
    if (!renewal) return;
    try {
      renewalService.openNegotiation(renewal.id, 'Standard SaaS Terms v2', 'Starting negotiation');
      refresh();
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  };

  const handleUpdateNegotiation = () => {
    if (!renewal) return;
    try {
      renewalService.updateNegotiation(renewal.id, {
        counterTerms: negotiationText || undefined,
        agreedDiscount: parseFloat(discountText) || 0,
      });
      refresh();
      Alert.alert('Updated', 'Negotiation terms updated');
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  };

  const handleFreeze = () => {
    if (!renewal) return;
    Alert.alert('Freeze Contract', 'Freeze mid-negotiation?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Freeze',
        style: 'destructive',
        onPress: () => {
          try {
            renewalService.freezeNegotiation(renewal.id);
            refresh();
          } catch (e) {
            Alert.alert('Error', String(e));
          }
        },
      },
    ]);
  };

  const handleApprove = () => {
    if (!renewal) return;
    try {
      renewalService.approveStep(renewal.id, 'current_user', 'Approved via mobile');
      refresh();
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  };

  const handleRequestSignature = () => {
    if (!renewal) return;
    try {
      renewalService.requestESignature(
        renewal.id,
        'docusign',
        'https://app.docusign.com/contracts/' + renewal.id
      );
      refresh();
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  };

  const handleOutcome = (outcome: 'won' | 'lost') => {
    if (!renewal) return;
    const reason: WinLossReason = outcome === 'won' ? 'accepted_offer' : 'price_too_high';
    try {
      renewalService.recordOutcome(renewal.id, outcome, reason);
      refresh();
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (demoMode || !renewal) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>Renewal Workspace</Text>
        <Text style={styles.emptySubtitle}>
          No active renewal selected. Create a demo to explore the workspace.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={createDemo}>
          <Text style={styles.primaryButtonText}>Create Demo Renewal</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const statusColor = STATUS_COLORS[renewal.status];
  const daysLeft = Math.ceil((renewal.contractEndDate - Date.now()) / 86_400_000);
  const approvalProgress = renewal.approval
    ? `${renewal.approval.currentStep}/${renewal.approval.chain.length}`
    : 'N/A';

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Renewal Workspace</Text>
        <Text style={styles.subtitle}>Contract ID: {renewal.subscriptionId}</Text>
      </View>

      {/* Status card */}
      <Card style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Status</Text>
          <View style={[styles.badge, { backgroundColor: statusColor }]}>
            <Text style={styles.badgeText}>{STATUS_LABELS[renewal.status]}</Text>
          </View>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Type</Text>
          <Text style={styles.value}>{renewal.renewalType === 'auto' ? 'Auto-Renewal' : 'Opt-In'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Days Until Expiry</Text>
          <Text style={[styles.value, { color: daysLeft <= 30 ? '#D93025' : colors.text }]}>
            {daysLeft > 0 ? `${daysLeft} days` : 'Expired'}
          </Text>
        </View>
      </Card>

      {/* Milestones */}
      {renewal.milestones.length > 0 && (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Milestones Triggered</Text>
          {renewal.milestones.map((m, i) => (
            <View key={i} style={styles.milestoneRow}>
              <Text style={styles.milestoneLabel}>{m.milestone.replace('_', '-')}</Text>
              <Text style={styles.milestoneStatus}>
                {m.notificationSent ? '✓ Notified' : '⏳ Pending'}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {/* Quote */}
      {renewal.quote && (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Renewal Quote</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Base Price</Text>
            <Text style={styles.value}>${renewal.quote.basePlanPrice.toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Escalator</Text>
            <Text style={styles.value}>{renewal.quote.escalatorPercent}%</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Discount</Text>
            <Text style={styles.value}>{renewal.quote.discount}%</Text>
          </View>
          <View style={[styles.row, styles.finalPriceRow]}>
            <Text style={styles.finalPriceLabel}>Final Price</Text>
            <Text style={styles.finalPrice}>${renewal.quote.finalPrice.toFixed(2)}</Text>
          </View>
        </Card>
      )}

      {/* Negotiation Workspace */}
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Negotiation Workspace</Text>
        {!renewal.negotiation ? (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleOpenNegotiation}
            disabled={['won', 'lost', 'signed', 'auto_renewed'].includes(renewal.status)}
          >
            <Text style={styles.secondaryButtonText}>Open Negotiation</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Text style={styles.label}>Proposed Terms</Text>
            <Text style={styles.termsText}>{renewal.negotiation.proposedTerms}</Text>

            {renewal.negotiation.frozenAt ? (
              <View style={styles.frozenBanner}>
                <Text style={styles.frozenText}>🔒 Contract Frozen</Text>
              </View>
            ) : (
              <>
                <Text style={[styles.label, { marginTop: spacing.md }]}>Counter Terms</Text>
                <TextInput
                  style={styles.input}
                  value={negotiationText}
                  onChangeText={setNegotiationText}
                  placeholder="Enter counter terms..."
                  multiline
                  accessibilityLabel="Counter terms input"
                />
                <Text style={[styles.label, { marginTop: spacing.sm }]}>Agreed Discount (%)</Text>
                <TextInput
                  style={styles.input}
                  value={discountText}
                  onChangeText={setDiscountText}
                  keyboardType="numeric"
                  accessibilityLabel="Discount percentage input"
                />
                <View style={styles.buttonRow}>
                  <TouchableOpacity style={styles.secondaryButton} onPress={handleUpdateNegotiation}>
                    <Text style={styles.secondaryButtonText}>Update Terms</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dangerButton} onPress={handleFreeze}>
                    <Text style={styles.dangerButtonText}>Freeze</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        )}
      </Card>

      {/* Approval Workflow */}
      {renewal.approval && (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Approval Chain</Text>
          <Text style={styles.label}>Progress: {approvalProgress}</Text>
          {renewal.approval.steps.map((step, i) => (
            <View key={i} style={styles.approvalStep}>
              <Text style={styles.approvalRole}>
                {i + 1}. {step.role.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </Text>
              <Text style={styles.approvalStatus}>
                {step.approvedAt ? '✅ Approved' : step.rejected ? '❌ Rejected' : '⏳ Pending'}
              </Text>
            </View>
          ))}
          {renewal.status === 'negotiating' || renewal.status === 'pending' ? (
            <TouchableOpacity style={styles.secondaryButton} onPress={handleApprove}>
              <Text style={styles.secondaryButtonText}>Approve Current Step</Text>
            </TouchableOpacity>
          ) : null}
        </Card>
      )}

      {/* E-Signature */}
      {renewal.status === 'awaiting_signature' && !renewal.eSignature && (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>E-Signature</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleRequestSignature}>
            <Text style={styles.primaryButtonText}>Request DocuSign</Text>
          </TouchableOpacity>
        </Card>
      )}
      {renewal.eSignature && (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>E-Signature</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Provider</Text>
            <Text style={styles.value}>{renewal.eSignature.provider}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={styles.value}>
              {renewal.eSignature.signedAt ? '✅ Signed' : '⏳ Awaiting'}
            </Text>
          </View>
        </Card>
      )}

      {/* Win/Loss Tracking */}
      {!['won', 'lost', 'auto_renewed'].includes(renewal.status) && (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Record Outcome</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.primaryButton, { flex: 1, marginRight: spacing.sm }]}
              onPress={() => handleOutcome('won')}
            >
              <Text style={styles.primaryButtonText}>Mark Won</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dangerButton, { flex: 1 }]}
              onPress={() => handleOutcome('lost')}
            >
              <Text style={styles.dangerButtonText}>Mark Lost</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {(renewal.status === 'won' || renewal.status === 'lost') && renewal.winLossReason && (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Outcome</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Result</Text>
            <Text style={[styles.value, { color: statusColor }]}>
              {STATUS_LABELS[renewal.status]}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Reason</Text>
            <Text style={styles.value}>
              {renewal.winLossReason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </Text>
          </View>
        </Card>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emptyTitle: { fontSize: 24, fontWeight: 'bold', color: colors.text, marginBottom: spacing.sm },
  emptySubtitle: { fontSize: 16, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
  header: { padding: spacing.xl, paddingTop: 60, backgroundColor: colors.surface },
  title: { fontSize: 28, fontWeight: 'bold', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  card: { margin: spacing.lg, padding: spacing.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  label: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  value: { fontSize: 14, color: colors.text, fontWeight: '600' },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: 12 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: colors.text, marginBottom: spacing.md },
  milestoneRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  milestoneLabel: { fontSize: 14, color: colors.text, textTransform: 'capitalize' },
  milestoneStatus: { fontSize: 13, color: colors.textSecondary },
  finalPriceRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  finalPriceLabel: { fontSize: 16, fontWeight: 'bold', color: colors.text },
  finalPrice: { fontSize: 20, fontWeight: 'bold', color: colors.primary },
  termsText: { fontSize: 14, color: colors.text, lineHeight: 20, marginBottom: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.sm,
    fontSize: 14,
    color: colors.text,
    marginBottom: spacing.sm,
    minHeight: 40,
  },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  primaryButton: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  secondaryButtonText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  dangerButton: {
    backgroundColor: '#D93025',
    padding: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  dangerButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  frozenBanner: {
    backgroundColor: '#F1F3F4',
    padding: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  frozenText: { fontSize: 16, fontWeight: 'bold', color: '#5F6368' },
  approvalStep: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  approvalRole: { fontSize: 14, color: colors.text },
  approvalStatus: { fontSize: 13, color: colors.textSecondary },
});

export default RenewalWorkspaceScreen;
