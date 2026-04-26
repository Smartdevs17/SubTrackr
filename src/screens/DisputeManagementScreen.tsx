import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useDisputeStore, Dispute, DisputeStatus, DisputeReason, Resolution, EvidenceType, EvidenceFormData, DisputeAnalytics } from '../store/disputeStore';
import { RootStackParamList } from '../navigation/types';

type HomeNavigationProp = NativeStackNavigationProp<RootStackParamList>;

// ════════════════════════════════════════════════════════════════
// COMPONENTS
// ════════════════════════════════════════════════════════════════

/** Status badge component */
const StatusBadge: React.FC<{ status: DisputeStatus }> = ({ status }) => {
  const getStatusColor = () => {
    switch (status) {
      case DisputeStatus.Pending:
        return colors.warning;
      case DisputeStatus.GatheringEvidence:
        return colors.info;
      case DisputeStatus.UnderReview:
        return colors.primary;
      case DisputeStatus.AwaitingManualReview:
        return colors.secondary;
      case DisputeStatus.Resolved:
        return colors.success;
      case DisputeStatus.Rejected:
        return colors.error;
      case DisputeStatus.Expired:
        return colors.muted;
      default:
        return colors.muted;
    }
  };

  const getStatusLabel = () => {
    return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <View style={[styles.statusBadge, { backgroundColor: getStatusColor() + '20' }]}>
      <Text style={[styles.statusBadgeText, { color: getStatusColor() }]}>
        {getStatusLabel()}
      </Text>
    </View>
  );
};

/** Reason badge component */
const ReasonBadge: React.FC<{ reason: DisputeReason }> = ({ reason }) => {
  const getReasonLabel = () => {
    const labels: Record<DisputeReason, string> = {
      [DisputeReason.NotAsDescribed]: 'Not as Described',
      [DisputeReason.NotReceived]: 'Not Received',
      [DisputeReason.Unauthorized]: 'Unauthorized',
      [DisputeReason.Duplicate]: 'Duplicate',
      [DisputeReason.IncorrectAmount]: 'Incorrect Amount',
      [DisputeReason.CancelledSubscription]: 'Cancelled',
      [DisputeReason.RefundNotProcessed]: 'Refund Missing',
      [DisputeReason.Other]: 'Other',
    };
    return labels[reason] || reason;
  };

  return (
    <View style={styles.reasonBadge}>
      <Text style={styles.reasonBadgeText}>{getReasonLabel()}</Text>
    </View>
  );
};

/** Analytics card component */
const AnalyticsCard: React.FC<{ analytics: DisputeAnalytics }> = ({ analytics }) => {
  return (
    <View style={styles.analyticsCard}>
      <Text style={styles.analyticsTitle}>Dispute Analytics</Text>
      <View style={styles.analyticsGrid}>
        <View style={styles.analyticsItem}>
          <Text style={styles.analyticsValue}>{analytics.totalDisputes}</Text>
          <Text style={styles.analyticsLabel}>Total</Text>
        </View>
        <View style={styles.analyticsItem}>
          <Text style={[styles.analyticsValue, { color: colors.warning }]}>
            {analytics.pendingDisputes}
          </Text>
          <Text style={styles.analyticsLabel}>Pending</Text>
        </View>
        <View style={styles.analyticsItem}>
          <Text style={[styles.analyticsValue, { color: colors.success }]}>
            {analytics.disputesWon}
          </Text>
          <Text style={styles.analyticsLabel}>Won</Text>
        </View>
        <View style={styles.analyticsItem}>
          <Text style={[styles.analyticsValue, { color: colors.error }]}>
            {analytics.disputesLost}
          </Text>
          <Text style={styles.analyticsLabel}>Lost</Text>
        </View>
      </View>
      <View style={styles.analyticsRow}>
        <Text style={styles.analyticsText}>
          Total Disputed: ${analytics.totalAmountDisputed.toFixed(2)}
        </Text>
        <Text style={styles.analyticsText}>
          Refunded: ${analytics.totalAmountRefunded.toFixed(2)}
        </Text>
      </View>
    </View>
  );
};

/** Dispute item component */
const DisputeItem: React.FC<{
  dispute: Dispute;
  onPress: (dispute: Dispute) => void;
}> = ({ dispute, onPress }) => {
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getDaysRemaining = () => {
    const now = new Date();
    const deadline = new Date(dispute.evidenceDeadline);
    const diff = deadline.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const daysRemaining = getDaysRemaining();

  return (
    <TouchableOpacity
      style={styles.disputeItem}
      onPress={() => onPress(dispute)}
      accessibilityRole="button"
      accessibilityLabel={`Dispute for charge ${dispute.chargeId}`}>
      <View style={styles.disputeItemHeader}>
        <View style={styles.disputeItemInfo}>
          <Text style={styles.disputeItemCharge} numberOfLines={1}>
            {dispute.chargeId}
          </Text>
          <Text style={styles.disputeItemDate}>
            Created: {formatDate(dispute.createdAt)}
          </Text>
        </View>
        <View style={styles.disputeItemAmount}>
          <Text style={styles.disputeItemAmountText}>
            ${dispute.amount.toFixed(2)}
          </Text>
          <Text style={styles.disputeItemCurrency}>{dispute.currency}</Text>
        </View>
      </View>
      <View style={styles.disputeItemBody}>
        <ReasonBadge reason={dispute.reason} />
        <StatusBadge status={dispute.status} />
      </View>
      {dispute.status !== DisputeStatus.Resolved &&
        dispute.status !== DisputeStatus.Rejected &&
        dispute.status !== DisputeStatus.Expired && (
          <View style={styles.disputeItemFooter}>
            <Text
              style={[
                styles.daysRemaining,
                daysRemaining < 3 ? styles.daysRemainingUrgent : null,
              ]}>
              {daysRemaining > 0
                ? `${daysRemaining} days to submit evidence`
                : 'Evidence deadline passed'}
            </Text>
          </View>
        )}
    </TouchableOpacity>
  );
};

/** Evidence form component */
const EvidenceForm: React.FC<{
  visible: boolean;
  onClose: () => void;
  onSubmit: (evidence: EvidenceFormData) => void;
}> = ({ visible, onClose, onSubmit }) => {
  const [evidenceType, setEvidenceType] = useState<EvidenceType>(EvidenceType.Receipt);
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');

  const handleSubmit = () => {
    if (!description.trim()) {
      Alert.alert('Error', 'Please provide a description');
      return;
    }

    onSubmit({
      evidenceType,
      description: description.trim(),
      reference: reference.trim(),
    });

    // Reset form
    setEvidenceType(EvidenceType.Receipt);
    setDescription('');
    setReference('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.formModal}>
        <View style={styles.formHeader}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.formCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.formTitle}>Submit Evidence</Text>
          <TouchableOpacity onPress={handleSubmit}>
            <Text style={styles.formSubmit}>Submit</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.formContent}>
          <Text style={styles.formLabel}>Evidence Type</Text>
          <View style={styles.evidenceTypeGrid}>
            {Object.values(EvidenceType).map((type) => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.evidenceTypeButton,
                  evidenceType === type && styles.evidenceTypeButtonSelected,
                ]}
                onPress={() => setEvidenceType(type)}>
                <Text
                  style={[
                    styles.evidenceTypeText,
                    evidenceType === type && styles.evidenceTypeTextSelected,
                  ]}>
                  {type.replace(/_/g, ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.formLabel}>Description</Text>
          <TextInput
            style={styles.formInput}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe the evidence..."
            multiline
            numberOfLines={4}
          />
          <Text style={styles.formLabel}>Reference/URL</Text>
          <TextInput
            style={styles.formInput}
            value={reference}
            onChangeText={setReference}
            placeholder="https://..."
            autoCapitalize="none"
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

/** Create dispute form component */
const CreateDisputeForm: React.FC<{
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: {
    chargeId: string;
    reason: DisputeReason;
    amount: number;
    currency: string;
    subscriptionId?: string;
  }) => void;
}> = ({ visible, onClose, onSubmit }) => {
  const [chargeId, setChargeId] = useState('');
  const [reason, setReason] = useState<DisputeReason>(DisputeReason.Other);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');

  const handleSubmit = () => {
    if (!chargeId.trim()) {
      Alert.alert('Error', 'Please enter a charge ID');
      return;
    }
    if (!amount.trim() || isNaN(Number(amount))) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    onSubmit({
      chargeId: chargeId.trim(),
      reason,
      amount: Number(amount),
      currency,
    });

    // Reset form
    setChargeId('');
    setReason(DisputeReason.Other);
    setAmount('');
    setCurrency('USD');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.formModal}>
        <View style={styles.formHeader}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.formCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.formTitle}>Create Dispute</Text>
          <TouchableOpacity onPress={handleSubmit}>
            <Text style={styles.formSubmit}>Create</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.formContent}>
          <Text style={styles.formLabel}>Charge ID *</Text>
          <TextInput
            style={styles.formInput}
            value={chargeId}
            onChangeText={setChargeId}
            placeholder="Enter charge ID"
          />
          <Text style={styles.formLabel}>Reason *</Text>
          <View style={styles.reasonGrid}>
            {Object.values(DisputeReason).map((r) => (
              <TouchableOpacity
                key={r}
                style={[
                  styles.reasonButton,
                  reason === r && styles.reasonButtonSelected,
                ]}
                onPress={() => setReason(r)}>
                <Text
                  style={[
                    styles.reasonText,
                    reason === r && styles.reasonTextSelected,
                  ]}>
                  {r.replace(/_/g, ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.formLabel}>Amount *</Text>
          <TextInput
            style={styles.formInput}
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
          <Text style={styles.formLabel}>Currency</Text>
          <TextInput
            style={styles.formInput}
            value={currency}
            onChangeText={setCurrency}
            placeholder="USD"
            maxLength={3}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

/** Resolution form component */
const ResolutionForm: React.FC<{
  visible: boolean;
  onClose: () => void;
  onSubmit: (resolution: Resolution, notes?: string) => void;
}> = ({ visible, onClose, onSubmit }) => {
  const [resolution, setResolution] = useState<Resolution>(Resolution.Refund);
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    onSubmit(resolution, notes.trim() || undefined);
    setResolution(Resolution.Refund);
    setNotes('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.formModal}>
        <View style={styles.formHeader}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.formCancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.formTitle}>Resolve Dispute</Text>
          <TouchableOpacity onPress={handleSubmit}>
            <Text style={styles.formSubmit}>Resolve</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.formContent}>
          <Text style={styles.formLabel}>Resolution *</Text>
          <View style={styles.resolutionGrid}>
            {Object.values(Resolution).map((r) => (
              <TouchableOpacity
                key={r}
                style={[
                  styles.resolutionButton,
                  resolution === r && styles.resolutionButtonSelected,
                ]}
                onPress={() => setResolution(r)}>
                <Text
                  style={[
                    styles.resolutionText,
                    resolution === r && styles.resolutionTextSelected,
                  ]}>
                  {r.charAt(0).toUpperCase() + r.slice(1).replace(/_/g, ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.formLabel}>Notes (Optional)</Text>
          <TextInput
            style={styles.formInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Add resolution notes..."
            multiline
            numberOfLines={4}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

/** Dispute detail modal */
const DisputeDetailModal: React.FC<{
  visible: boolean;
  dispute: Dispute | null;
  onClose: () => void;
  onSubmitEvidence: () => void;
  onRequestReview: () => void;
  onResolve: () => void;
}> = ({ visible, dispute, onClose, onSubmitEvidence, onRequestReview, onResolve }) => {
  if (!dispute) return null;

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.detailModal}>
        <View style={styles.detailHeader}>
          <Text style={styles.detailTitle}>Dispute Details</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.detailClose}>Close</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.detailContent}>
          <View style={styles.detailSection}>
            <Text style={styles.detailSectionTitle}>Charge Information</Text>
            <Text style={styles.detailText}>Charge ID: {dispute.chargeId}</Text>
            <Text style={styles.detailText}>
              Amount: ${dispute.amount.toFixed(2)} {dispute.currency}
            </Text>
            {dispute.subscriptionId && (
              <Text style={styles.detailText}>
                Subscription: {dispute.subscriptionName || dispute.subscriptionId}
              </Text>
            )}
          </View>

          <View style={styles.detailSection}>
            <Text style={styles.detailSectionTitle}>Status</Text>
            <View style={styles.detailRow}>
              <ReasonBadge reason={dispute.reason} />
              <StatusBadge status={dispute.status} />
            </View>
          </View>

          <View style={styles.detailSection}>
            <Text style={styles.detailSectionTitle}>Timeline</Text>
            {dispute.timeline.map((event, index) => (
              <View key={event.id} style={styles.timelineItem}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineDescription}>{event.description}</Text>
                  <Text style={styles.timelineDate}>{formatDate(event.timestamp)}</Text>
                </View>
              </View>
            ))}
          </View>

          {dispute.evidence.length > 0 && (
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>
                Evidence ({dispute.evidence.length})
              </Text>
              {dispute.evidence.map((ev) => (
                <View key={ev.id} style={styles.evidenceItem}>
                  <Text style={styles.evidenceType}>
                    {ev.evidenceType.replace(/_/g, ' ')}
                  </Text>
                  <Text style={styles.evidenceDescription}>{ev.description}</Text>
                  {ev.reference && (
                    <Text style={styles.evidenceReference}>{ev.reference}</Text>
                  )}
                  <Text style={styles.evidenceDate}>
                    Submitted: {formatDate(ev.submittedAt)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {dispute.resolution && (
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>Resolution</Text>
              <Text style={styles.detailText}>
                Outcome: {dispute.resolution.charAt(0).toUpperCase() + dispute.resolution.slice(1)}
              </Text>
              {dispute.resolutionNotes && (
                <Text style={styles.detailText}>Notes: {dispute.resolutionNotes}</Text>
              )}
              {dispute.resolvedAt && (
                <Text style={styles.detailText}>
                  Resolved: {formatDate(dispute.resolvedAt)}
                </Text>
              )}
            </View>
          )}
        </ScrollView>

        {dispute.status !== DisputeStatus.Resolved &&
          dispute.status !== DisputeStatus.Rejected &&
          dispute.status !== DisputeStatus.Expired && (
            <View style={styles.detailActions}>
              <TouchableOpacity
                style={styles.detailActionButton}
                onPress={onSubmitEvidence}>
                <Text style={styles.detailActionText}>Submit Evidence</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.detailActionButton, styles.secondaryButton]}
                onPress={onRequestReview}>
                <Text style={[styles.detailActionText, styles.secondaryText]}>
                  Request Review
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.detailActionButton, styles.dangerButton]}
                onPress={onResolve}>
                <Text style={[styles.detailActionText, styles.dangerText]}>
                  Resolve
                </Text>
              </TouchableOpacity>
            </View>
          )}
      </SafeAreaView>
    </Modal>
  );
};

// ════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ════════════════════════════════════════════════════════════════

const DisputeManagementScreen: React.FC = () => {
  const navigation = useNavigation<HomeNavigationProp>();
  const {
    disputes,
    analytics,
    createDispute,
    submitEvidence,
    requestManualReview,
    resolveDispute,
    updateAnalytics,
  } = useDisputeStore();

  const [refreshing, setRefreshing] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEvidenceForm, setShowEvidenceForm] = useState(false);
  const [showResolutionForm, setShowResolutionForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<DisputeStatus | 'all'>('all');

  // Filter disputes
  const filteredDisputes = useMemo(() => {
    if (filterStatus === 'all') return disputes;
    return disputes.filter((d) => d.status === filterStatus);
  }, [disputes, filterStatus]);

  // Update analytics on mount
  useEffect(() => {
    updateAnalytics();
  }, [updateAnalytics]);

  const onRefresh = async () => {
    setRefreshing(true);
    updateAnalytics();
    setRefreshing(false);
  };

  const handleCreateDispute = async (data: {
    chargeId: string;
    reason: DisputeReason;
    amount: number;
    currency: string;
    subscriptionId?: string;
  }) => {
    try {
      await createDispute(data, 'current-user');
      Alert.alert('Success', 'Dispute created successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to create dispute');
    }
  };

  const handleSubmitEvidence = async (evidence: EvidenceFormData) => {
    if (!selectedDispute) return;
    try {
      await submitEvidence(selectedDispute.id, evidence, 'current-user');
      Alert.alert('Success', 'Evidence submitted successfully');
      setShowEvidenceForm(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to submit evidence');
    }
  };

  const handleRequestReview = async () => {
    if (!selectedDispute) return;
    try {
      await requestManualReview(selectedDispute.id, 'current-user');
      Alert.alert('Success', 'Manual review requested');
    } catch (error) {
      Alert.alert('Error', 'Failed to request review');
    }
  };

  const handleResolve = async (resolution: Resolution, notes?: string) => {
    if (!selectedDispute) return;
    try {
      await resolveDispute(selectedDispute.id, resolution, notes, 'admin');
      Alert.alert('Success', 'Dispute resolved successfully');
      setShowResolutionForm(false);
      setSelectedDispute(null);
    } catch (error) {
      Alert.alert('Error', 'Failed to resolve dispute');
    }
  };

  const handleDisputePress = (dispute: Dispute) => {
    setSelectedDispute(dispute);
  };

  const renderDisputeItem = ({ item }: { item: Dispute }) => (
    <DisputeItem dispute={item} onPress={handleDisputePress} />
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }>
        <View style={styles.header}>
          <Text style={styles.title}>Dispute Management</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowCreateForm(true)}>
            <Text style={styles.addButtonText}>+ New</Text>
          </TouchableOpacity>
        </View>

        {/* Analytics Card */}
        <AnalyticsCard analytics={analytics} />

        {/* Filter */}
        <View style={styles.filterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <TouchableOpacity
              style={[
                styles.filterButton,
                filterStatus === 'all' && styles.filterButtonActive,
              ]}
              onPress={() => setFilterStatus('all')}>
              <Text
                style={[
                  styles.filterText,
                  filterStatus === 'all' && styles.filterTextActive,
                ]}>
                All
              </Text>
            </TouchableOpacity>
            {Object.values(DisputeStatus).map((status) => (
              <TouchableOpacity
                key={status}
                style={[
                  styles.filterButton,
                  filterStatus === status && styles.filterButtonActive,
                ]}
                onPress={() => setFilterStatus(status)}>
                <Text
                  style={[
                    styles.filterText,
                    filterStatus === status && styles.filterTextActive,
                  ]}>
                  {status.replace(/_/g, ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Dispute List */}
        <View style={styles.listContainer}>
          <Text style={styles.listTitle}>
            Disputes ({filteredDisputes.length})
          </Text>
          {filteredDisputes.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No disputes found</Text>
              <Text style={styles.emptySubtext}>
                Create a new dispute to get started
              </Text>
            </View>
          ) : (
            filteredDisputes.map((dispute) => (
              <DisputeItem
                key={dispute.id}
                dispute={dispute}
                onPress={handleDisputePress}
              />
            ))
          )}
        </View>
      </ScrollView>

      {/* Modals */}
      <CreateDisputeForm
        visible={showCreateForm}
        onClose={() => setShowCreateForm(false)}
        onSubmit={handleCreateDispute}
      />

      <DisputeDetailModal
        visible={!!selectedDispute}
        dispute={selectedDispute}
        onClose={() => setSelectedDispute(null)}
        onSubmitEvidence={() => setShowEvidenceForm(true)}
        onRequestReview={handleRequestReview}
        onResolve={() => setShowResolutionForm(true)}
      />

      <EvidenceForm
        visible={showEvidenceForm}
        onClose={() => setShowEvidenceForm(false)}
        onSubmit={handleSubmitEvidence}
      />

      <ResolutionForm
        visible={showResolutionForm}
        onClose={() => setShowResolutionForm(false)}
        onSubmit={handleResolve}
      />
    </SafeAreaView>
  );
};

// ════════════════════════════════════════════════════════════════
// STYLES
// ════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    fontSize: typography.xl,
    fontWeight: 'bold',
    color: colors.text,
  },
  addButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  addButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  analyticsCard: {
    backgroundColor: colors.card,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  analyticsTitle: {
    fontSize: typography.lg,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
  },
  analyticsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  analyticsItem: {
    alignItems: 'center',
  },
  analyticsValue: {
    fontSize: typography.xl,
    fontWeight: 'bold',
    color: colors.text,
  },
  analyticsLabel: {
    fontSize: typography.sm,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  analyticsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  analyticsText: {
    fontSize: typography.sm,
    color: colors.muted,
  },
  filterContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  filterButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.card,
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
  },
  filterText: {
    fontSize: typography.sm,
    color: colors.muted,
  },
  filterTextActive: {
    color: colors.white,
    fontWeight: '600',
  },
  listContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  listTitle: {
    fontSize: typography.lg,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: typography.lg,
    color: colors.muted,
  },
  emptySubtext: {
    fontSize: typography.sm,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  disputeItem: {
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
  },
  disputeItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  disputeItemInfo: {
    flex: 1,
  },
  disputeItemCharge: {
    fontSize: typography.md,
    fontWeight: '600',
    color: colors.text,
  },
  disputeItemDate: {
    fontSize: typography.sm,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  disputeItemAmount: {
    alignItems: 'flex-end',
  },
  disputeItemAmountText: {
    fontSize: typography.lg,
    fontWeight: 'bold',
    color: colors.text,
  },
  disputeItemCurrency: {
    fontSize: typography.sm,
    color: colors.muted,
  },
  disputeItemBody: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  disputeItemFooter: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  statusBadgeText: {
    fontSize: typography.xs,
    fontWeight: '600',
  },
  reasonBadge: {
    backgroundColor: colors.muted + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  reasonBadgeText: {
    fontSize: typography.xs,
    color: colors.text,
  },
  daysRemaining: {
    fontSize: typography.sm,
    color: colors.muted,
  },
  daysRemainingUrgent: {
    color: colors.error,
  },
  formModal: {
    flex: 1,
    backgroundColor: colors.background,
  },
  formHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  formTitle: {
    fontSize: typography.lg,
    fontWeight: '600',
    color: colors.text,
  },
  formCancel: {
    fontSize: typography.md,
    color: colors.muted,
  },
  formSubmit: {
    fontSize: typography.md,
    color: colors.primary,
    fontWeight: '600',
  },
  formContent: {
    flex: 1,
    padding: spacing.lg,
  },
  formLabel: {
    fontSize: typography.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  formInput: {
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    fontSize: typography.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  evidenceTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  evidenceTypeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  evidenceTypeButtonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  evidenceTypeText: {
    fontSize: typography.sm,
    color: colors.text,
  },
  evidenceTypeTextSelected: {
    color: colors.white,
  },
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  reasonButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reasonButtonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  reasonText: {
    fontSize: typography.sm,
    color: colors.text,
  },
  reasonTextSelected: {
    color: colors.white,
  },
  resolutionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  resolutionButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resolutionButtonSelected: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  resolutionText: {
    fontSize: typography.sm,
    color: colors.text,
  },
  resolutionTextSelected: {
    color: colors.white,
  },
  detailModal: {
    flex: 1,
    backgroundColor: colors.background,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailTitle: {
    fontSize: typography.lg,
    fontWeight: '600',
    color: colors.text,
  },
  detailClose: {
    fontSize: typography.md,
    color: colors.primary,
  },
  detailContent: {
    flex: 1,
    padding: spacing.lg,
  },
  detailSection: {
    marginBottom: spacing.lg,
  },
  detailSectionTitle: {
    fontSize: typography.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  detailText: {
    fontSize: typography.sm,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginTop: 4,
    marginRight: spacing.md,
  },
  timelineContent: {
    flex: 1,
  },
  timelineDescription: {
    fontSize: typography.sm,
    color: colors.text,
  },
  timelineDate: {
    fontSize: typography.xs,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  evidenceItem: {
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  evidenceType: {
    fontSize: typography.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  evidenceDescription: {
    fontSize: typography.sm,
    color: colors.text,
    marginTop: spacing.xs,
  },
  evidenceReference: {
    fontSize: typography.xs,
    color: colors.primary,
    marginTop: spacing.xs,
  },
  evidenceDate: {
    fontSize: typography.xs,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  detailActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailActionButton: {
    flex: 1,
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginHorizontal: spacing.xs,
    alignItems: 'center',
  },
  detailActionText: {
    color: colors.white,
    fontWeight: '600',
    fontSize: typography.sm,
  },
  secondaryButton: {
    backgroundColor: colors.secondary,
  },
  secondaryText: {
    color: colors.white,
  },
  dangerButton: {
    backgroundColor: colors.error,
  },
  dangerText: {
    color: colors.white,
  },
});

export default DisputeManagementScreen;