import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  Share,
  Switch,
  Modal,
  ActivityIndicator,
} from 'react-native';
import {
  useBatchStore,
  BatchOperationType,
  BatchState,
  PerItemResult,
  CancelReason,
  BatchHistoryEntry,
  exportBatchResultToJson as exportJson,
  exportBatchResultToCsv as exportCsv,
} from '../stores/batchStore';
import { colors, spacing, typography, borderRadius } from '../../src/utils/constants';

// ════════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════════

const OPERATION_TYPES: Array<{ key: BatchOperationType; label: string; icon: string }> = [
  { key: 'create', label: 'Create', icon: '+' },
  { key: 'update', label: 'Update', icon: '-' },
  { key: 'charge', label: 'Charge', icon: '$' },
  { key: 'cancel', label: 'Cancel', icon: 'X' },
];

const CANCEL_REASONS: Array<{ key: CancelReason['reason']; label: string }> = [
  { key: 'too_expensive', label: 'Too Expensive' },
  { key: 'no_longer_needed', label: 'No Longer Needed' },
  { key: 'found_alternative', label: 'Found Alternative' },
  { key: 'poor_service', label: 'Poor Service' },
  { key: 'other', label: 'Other' },
];

const STATE_COLORS: Record<BatchState, string> = {
  pending: colors.textSecondary,
  running: colors.warning,
  completed: colors.success,
  partial: colors.warning,
  failed: colors.error,
};

// ════════════════════════════════════════════════════════════════
// Component
// ════════════════════════════════════════════════════════════════

export const BatchOperationsScreen: React.FC = () => {
  const {
    draft,
    currentResult,
    history,
    isRunning,
    progress,
    setOperationType,
    toggleAtomic,
    setChunkSize,
    setCsvContent,
    loadCreateCsv,
    loadCancelCsv,
    loadChargeCsv,
    loadUpdateCsv,
    setDraft,
    executeBatch,
    retryFailed,
    exportResultJson,
    exportResultCsv,
    resetDraft,
    clearResult,
    loadHistory,
    gasEstimate,
  } = useBatchStore();

  const [showHistory, setShowHistory] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showCancelReasons, setShowCancelReasons] = useState(false);
  const [selectedReason, setSelectedReason] = useState<CancelReason['reason']>('other');
  const [cancelNotes, setCancelNotes] = useState('');
  const [updatePrice, setUpdatePrice] = useState('');
  const [updatePlan, setUpdatePlan] = useState('');
  const [updateCategory, setUpdateCategory] = useState('');
  const [updateCurrency, setUpdateCurrency] = useState('');
  const [filterMinPrice, setFilterMinPrice] = useState('');
  const [filterMaxPrice, setFilterMaxPrice] = useState('');
  const [filterPlanChange, setFilterPlanChange] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  const items =
    draft.createInputs.length ||
    draft.updateIds.length ||
    draft.cancelIds.length ||
    draft.chargeItems.length ||
    0;

  const canExecute = items > 0 && !isRunning;

  const onLoadCsv = useCallback(() => {
    const csv = draft.csvContent;
    if (!csv.trim()) {
      Alert.alert('Error', 'Please enter CSV data');
      return;
    }
    switch (draft.operationType) {
      case 'create':
        loadCreateCsv(csv);
        break;
      case 'cancel':
        loadCancelCsv(csv);
        break;
      case 'charge':
        loadChargeCsv(csv);
        break;
      case 'update':
        loadUpdateCsv(csv);
        break;
    }
  }, [draft.csvContent, draft.operationType, loadCreateCsv, loadCancelCsv, loadChargeCsv, loadUpdateCsv]);

  const onExecute = useCallback(async () => {
    await executeBatch();
  }, [executeBatch]);

  const onRetry = useCallback(async () => {
    await retryFailed();
  }, [retryFailed]);

  const onExportJson = useCallback(() => {
    const json = exportResultJson();
    if (json) {
      Share.share({ message: json, title: 'Batch Result' }).catch(() => {});
    }
  }, [exportResultJson]);

  const onExportCsv = useCallback(() => {
    const csv = exportResultCsv();
    if (csv) {
      Share.share({ message: csv, title: 'Batch Result CSV' }).catch(() => {});
    }
  }, [exportResultCsv]);

  const onApplyFilter = useCallback(() => {
    setDraft({
      updateFilter: {
        planChange: filterPlanChange || undefined,
        minPrice: filterMinPrice ? parseFloat(filterMinPrice) : undefined,
        maxPrice: filterMaxPrice ? parseFloat(filterMaxPrice) : undefined,
      },
    });
    setShowFilter(false);
  }, [filterPlanChange, filterMinPrice, filterMaxPrice, setDraft]);

  const onApplyUpdateParams = useCallback(() => {
    setDraft({
      updateParams: {
        price: updatePrice ? parseFloat(updatePrice) : undefined,
        plan: updatePlan || undefined,
        category: updateCategory || undefined,
        currency: updateCurrency || undefined,
      },
    });
  }, [updatePrice, updatePlan, updateCategory, updateCurrency, setDraft]);

  const onAddCancelReason = useCallback(() => {
    if (draft.cancelIds.length > 0) {
      setDraft({
        cancelReasons: draft.cancelIds.map((id) => ({
          subscriptionId: id,
          reason: selectedReason,
          notes: cancelNotes || undefined,
        })),
      });
      Alert.alert('Applied', `Applied reason "${selectedReason}" to ${draft.cancelIds.length} subscription(s)`);
    }
    setShowCancelReasons(false);
  }, [draft.cancelIds, selectedReason, cancelNotes, setDraft]);

  const gasEst = gasEstimate();
  const hasFailedItems = currentResult?.failedItems && currentResult.failedItems > 0;

  const getCsvPlaceholder = (): string => {
    switch (draft.operationType) {
      case 'create':
        return 'name,description,category,price,currency,billingCycle\nNetflix,Streaming,streaming,15.99,USD,monthly\nSpotify,Music,streaming,9.99,USD,monthly';
      case 'update':
        return 'subscriptionId\nsub_abc123\nsub_def456\nsub_ghi789';
      case 'cancel':
        return 'subscriptionId,reason,notes\nsub_abc123,too_expensive,\nsub_def456,no_longer_needed,Switched to competitor';
      case 'charge':
        return 'subscriptionId,amount\nsub_abc123,15.99\nsub_def456,9.99';
      default:
        return '';
    }
  };

  const renderOperationSelector = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Operation Type</Text>
      <View style={styles.chipRow}>
        {OPERATION_TYPES.map((op) => (
          <TouchableOpacity
            key={op.key}
            style={[styles.chip, draft.operationType === op.key && styles.chipActive]}
            onPress={() => setOperationType(op.key)}>
            <Text
              style={[
                styles.chipText,
                draft.operationType === op.key && styles.chipTextActive,
              ]}>
              {op.icon} {op.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderCsvInput = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Data Input (CSV)</Text>
      <TextInput
        style={styles.textArea}
        multiline
        numberOfLines={8}
        placeholder={getCsvPlaceholder()}
        placeholderTextColor={colors.textSecondary}
        value={draft.csvContent}
        onChangeText={setCsvContent}
        autoCapitalize="none"
        textAlignVertical="top"
      />
      <View style={styles.csvActions}>
        <TouchableOpacity style={styles.actionButton} onPress={onLoadCsv}>
          <Text style={styles.actionButtonText}>Parse CSV</Text>
        </TouchableOpacity>
        <Text style={styles.itemCount}>
          {items} item{items !== 1 ? 's' : ''} loaded
        </Text>
      </View>
    </View>
  );

  const renderUpdateParams = () => {
    if (draft.operationType !== 'update') return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Update Parameters</Text>
        <View style={styles.paramRow}>
          <Text style={styles.paramLabel}>New Price:</Text>
          <TextInput
            style={styles.paramInput}
            value={updatePrice}
            onChangeText={setUpdatePrice}
            placeholder="9.99"
            placeholderTextColor={colors.textSecondary}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.paramRow}>
          <Text style={styles.paramLabel}>New Plan:</Text>
          <TextInput
            style={styles.paramInput}
            value={updatePlan}
            onChangeText={setUpdatePlan}
            placeholder="premium"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
        <View style={styles.paramRow}>
          <Text style={styles.paramLabel}>Category:</Text>
          <TextInput
            style={styles.paramInput}
            value={updateCategory}
            onChangeText={setUpdateCategory}
            placeholder="streaming"
            placeholderTextColor={colors.textSecondary}
          />
        </View>
        <View style={styles.paramRow}>
          <Text style={styles.paramLabel}>Currency:</Text>
          <TextInput
            style={styles.paramInput}
            value={updateCurrency}
            onChangeText={setUpdateCurrency}
            placeholder="USD"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="characters"
          />
        </View>
        <View style={styles.paramActions}>
          <TouchableOpacity style={styles.actionButton} onPress={onApplyUpdateParams}>
            <Text style={styles.actionButtonText}>Apply Parameters</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButtonOutline}
            onPress={() => setShowFilter(true)}>
            <Text style={styles.actionButtonOutlineText}>Set Filter</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderCancelReasons = () => {
    if (draft.operationType !== 'cancel') return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cancel Reasons</Text>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => setShowCancelReasons(true)}>
          <Text style={styles.actionButtonText}>
            Set Reason ({draft.cancelReasons.length > 0 ? 'Applied' : 'Not Set'})
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderOptions = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Options</Text>
      <View style={styles.optionRow}>
        <Text style={styles.optionLabel}>Atomic (all-or-nothing)</Text>
        <Switch
          value={draft.atomic}
          onValueChange={toggleAtomic}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={draft.atomic ? colors.onPrimary : colors.textSecondary}
        />
      </View>
      <View style={styles.optionRow}>
        <Text style={styles.optionLabel}>Chunk Size</Text>
        <TextInput
          style={styles.chunkInput}
          value={String(draft.chunkSize)}
          onChangeText={(v: string) => setChunkSize(parseInt(v, 10) || 50)}
          keyboardType="number-pad"
        />
      </View>
      <Text style={styles.gasEstimate}>
        Est. Gas: {gasEst.toLocaleString()} units | {draft.atomic ? 'Atomic' : 'Non-atomic'} mode
      </Text>
    </View>
  );

  const renderActions = () => (
    <View style={styles.section}>
      <TouchableOpacity
        style={[styles.primaryButton, (!canExecute || isRunning) && styles.buttonDisabled]}
        onPress={onExecute}
        disabled={!canExecute || isRunning}>
        {isRunning ? (
          <View style={styles.runningRow}>
            <ActivityIndicator size="small" color={colors.onPrimary} />
            <Text style={styles.primaryButtonText}> Running...</Text>
          </View>
        ) : (
          <Text style={styles.primaryButtonText}>
            Execute Batch ({items} item{items !== 1 ? 's' : ''})
          </Text>
        )}
      </TouchableOpacity>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.secondaryButton, !hasFailedItems && styles.buttonDisabled]}
          onPress={onRetry}
          disabled={!hasFailedItems || isRunning}>
          <Text style={styles.secondaryButtonText}>Retry Failed</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={resetDraft}>
          <Text style={styles.secondaryButtonText}>Reset</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderProgress = () => {
    if (!progress) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Progress</Text>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${progress.percentComplete}%` },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {progress.completed}/{progress.total} ({progress.percentComplete}%) |
          Success: {progress.succeeded} | Failed: {progress.failed}
        </Text>
      </View>
    );
  };

  const renderResults = () => {
    if (!currentResult) return null;
    return (
      <View style={styles.section}>
        <View style={styles.resultHeader}>
          <Text style={styles.sectionTitle}>Results</Text>
          <Text
            style={[
              styles.stateBadge,
              { backgroundColor: STATE_COLORS[currentResult.state] + '30' },
            ]}>
            <Text style={[styles.stateText, { color: STATE_COLORS[currentResult.state] }]}>
              {currentResult.state.toUpperCase()}
            </Text>
          </Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{currentResult.totalItems}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, styles.successText]}>
              {currentResult.successfulItems}
            </Text>
            <Text style={styles.statLabel}>Success</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, styles.errorText]}>
              {currentResult.failedItems}
            </Text>
            <Text style={styles.statLabel}>Failed</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, styles.warningText]}>
              {currentResult.skippedItems}
            </Text>
            <Text style={styles.statLabel}>Skipped</Text>
          </View>
        </View>

        {currentResult.rolledBack && (
          <View style={styles.rollbackBadge}>
            <Text style={styles.rollbackText}>Rolled back (atomic failure)</Text>
          </View>
        )}

        <View style={styles.exportRow}>
          <TouchableOpacity style={styles.exportButton} onPress={onExportJson}>
            <Text style={styles.exportButtonText}>Export JSON</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.exportButton} onPress={onExportCsv}>
            <Text style={styles.exportButtonText}>Export CSV</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={currentResult.results.slice(0, 100)}
          keyExtractor={(r: PerItemResult) => `${r.index}_${r.subscriptionId}`}
          scrollEnabled={false}
          renderItem={({ item }: { item: PerItemResult }) => (
            <View
              style={[
                styles.resultItem,
                item.status === 'success' && styles.resultSuccess,
                item.status === 'failed' && styles.resultFailed,
                item.status === 'skipped' && styles.resultSkipped,
              ]}>
              <View style={styles.resultItemRow}>
                <Text style={styles.resultIndex}>#{item.index + 1}</Text>
                <Text style={styles.resultId} numberOfLines={1}>
                  {item.subscriptionName || item.subscriptionId}
                </Text>
                <Text
                  style={[
                    styles.resultStatus,
                    item.status === 'success' && styles.successText,
                    item.status === 'failed' && styles.errorText,
                    item.status === 'skipped' && styles.warningText,
                  ]}>
                  {item.status}
                </Text>
              </View>
              {item.error && (
                <Text style={styles.resultError} numberOfLines={1}>
                  {item.error}
                </Text>
              )}
              {item.cancelReason && (
                <Text style={styles.resultReason}>
                  Reason: {item.cancelReason.reason}
                  {item.cancelReason.notes ? ` - ${item.cancelReason.notes}` : ''}
                </Text>
              )}
              {item.retryCount > 0 && (
                <Text style={styles.retryCount}>Retries: {item.retryCount}</Text>
              )}
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No results yet</Text>
          }
        />
        {currentResult.results.length > 100 && (
          <Text style={styles.moreText}>
            ...and {currentResult.results.length - 100} more items
          </Text>
        )}
      </View>
    );
  };

  const renderFilterModal = () => (
    <Modal
      visible={showFilter}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowFilter(false)}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Update Filter</Text>
          <TouchableOpacity onPress={() => setShowFilter(false)}>
            <Text style={styles.modalClose}>Close</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.modalBody}>
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>Plan Change Only:</Text>
            <Switch
              value={filterPlanChange}
              onValueChange={setFilterPlanChange}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>Min Price:</Text>
            <TextInput
              style={styles.filterInput}
              value={filterMinPrice}
              onChangeText={setFilterMinPrice}
              placeholder="0.00"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.filterRow}>
            <Text style={styles.filterLabel}>Max Price:</Text>
            <TextInput
              style={styles.filterInput}
              value={filterMaxPrice}
              onChangeText={setFilterMaxPrice}
              placeholder="999.99"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
            />
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={onApplyFilter}>
            <Text style={styles.primaryButtonText}>Apply Filter</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  const renderCancelReasonModal = () => (
    <Modal
      visible={showCancelReasons}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowCancelReasons(false)}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Cancel Reason</Text>
          <TouchableOpacity onPress={() => setShowCancelReasons(false)}>
            <Text style={styles.modalClose}>Close</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.modalBody}>
          {CANCEL_REASONS.map((r) => (
            <TouchableOpacity
              key={r.key}
              style={[
                styles.reasonOption,
                selectedReason === r.key && styles.reasonOptionActive,
              ]}
              onPress={() => setSelectedReason(r.key)}>
              <Text
                style={[
                  styles.reasonOptionText,
                  selectedReason === r.key && styles.reasonOptionTextActive,
                ]}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
          <TextInput
            style={styles.reasonNotes}
            value={cancelNotes}
            onChangeText={setCancelNotes}
            placeholder="Optional notes..."
            placeholderTextColor={colors.textSecondary}
            multiline
          />
          <TouchableOpacity style={styles.primaryButton} onPress={onAddCancelReason}>
            <Text style={styles.primaryButtonText}>
              Apply to {draft.cancelIds.length} item{draft.cancelIds.length !== 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );

  const renderHistoryModal = () => (
    <Modal
      visible={showHistory}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowHistory(false)}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Batch History</Text>
          <TouchableOpacity onPress={() => setShowHistory(false)}>
            <Text style={styles.modalClose}>Close</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          data={history}
          keyExtractor={(item: BatchHistoryEntry) => item.batchId}
          renderItem={({ item }: { item: BatchHistoryEntry }) => (
            <View style={styles.historyItem}>
              <View style={styles.historyRow}>
                <Text style={styles.historyOp}>{item.operationType.toUpperCase()}</Text>
                <Text
                  style={[
                    styles.historyState,
                    { color: STATE_COLORS[item.state as BatchState] || colors.textSecondary },
                  ]}>
                  {item.state}
                </Text>
              </View>
              <Text style={styles.historySummary}>{item.summary}</Text>
              <Text style={styles.historyTime}>
                {new Date(item.timestamp).toLocaleString()}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No batch history</Text>
          }
        />
      </SafeAreaView>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Batch Operations</Text>
          <TouchableOpacity onPress={() => setShowHistory(true)}>
            <Text style={styles.historyLink}>History</Text>
          </TouchableOpacity>
        </View>

        {renderOperationSelector()}
        {renderCsvInput()}
        {renderUpdateParams()}
        {renderCancelReasons()}
        {renderOptions()}
        {renderActions()}
        {renderProgress()}
        {renderResults()}

        <View style={styles.bottomPad} />
      </ScrollView>

      {renderFilterModal()}
      {renderCancelReasonModal()}
      {renderHistoryModal()}
    </SafeAreaView>
  );
};

// ════════════════════════════════════════════════════════════════
// Styles
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
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  historyLink: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  section: {
    padding: spacing.lg,
    paddingTop: 0,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: borderRadius.round,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.primary + '30',
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.primary,
  },
  textArea: {
    ...typography.body,
    minHeight: 140,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  csvActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  itemCount: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actionButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  actionButtonText: {
    ...typography.button,
    color: colors.onPrimary,
  },
  actionButtonOutline: {
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  actionButtonOutlineText: {
    ...typography.button,
    color: colors.primary,
  },
  paramRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  paramLabel: {
    ...typography.body,
    color: colors.textSecondary,
    width: 100,
  },
  paramInput: {
    ...typography.body,
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  paramActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  optionLabel: {
    ...typography.body,
    color: colors.text,
  },
  chunkInput: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    color: colors.text,
    backgroundColor: colors.surface,
    width: 80,
    textAlign: 'center',
  },
  gasEstimate: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typography.button,
    color: colors.onPrimary,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    ...typography.button,
    color: colors.text,
  },
  runningRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.round,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.round,
  },
  progressText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  stateBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  stateText: {
    ...typography.small,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.md,
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    ...typography.h2,
    color: colors.text,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  successText: {
    color: colors.success,
  },
  errorText: {
    color: colors.error,
  },
  warningText: {
    color: colors.warning,
  },
  rollbackBadge: {
    backgroundColor: colors.error + '30',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  rollbackText: {
    ...typography.caption,
    color: colors.error,
    fontWeight: '600',
  },
  exportRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  exportButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  exportButtonText: {
    ...typography.button,
    color: colors.primary,
  },
  resultItem: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
  },
  resultSuccess: {
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
  },
  resultFailed: {
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
  },
  resultSkipped: {
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  resultItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  resultIndex: {
    ...typography.small,
    color: colors.textSecondary,
    width: 30,
  },
  resultId: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  resultStatus: {
    ...typography.small,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  resultError: {
    ...typography.small,
    color: colors.error,
    marginTop: spacing.xs,
    paddingLeft: 30 + spacing.sm,
  },
  resultReason: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    paddingLeft: 30 + spacing.sm,
  },
  retryCount: {
    ...typography.small,
    color: colors.warning,
    marginTop: spacing.xs,
    paddingLeft: 30 + spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  moreText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  bottomPad: {
    height: spacing.xxl,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    ...typography.h2,
    color: colors.text,
  },
  modalClose: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  modalBody: {
    flex: 1,
    padding: spacing.lg,
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  filterLabel: {
    ...typography.body,
    color: colors.text,
  },
  filterInput: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    color: colors.text,
    backgroundColor: colors.surface,
    width: 120,
    textAlign: 'right',
  },
  reasonOption: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reasonOptionActive: {
    backgroundColor: colors.primary + '30',
    borderColor: colors.primary,
  },
  reasonOptionText: {
    ...typography.body,
    color: colors.text,
  },
  reasonOptionTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  reasonNotes: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface,
    minHeight: 80,
    marginVertical: spacing.md,
  },
  // History styles
  historyItem: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyOp: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  historyState: {
    ...typography.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  historySummary: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  historyTime: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});

export default BatchOperationsScreen;
