import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import {
  parseCSV,
  parseCSVWithMapping,
  parseJSON,
  validateImport,
  processImport,
  recordImport,
  getImportHistory,
  getCSVTemplate,
  getJSONTemplate,
  detectFormat,
  takeImportSnapshot,
  ImportMode,
  ImportResult,
  ValidationResult,
  ImportHistoryEntry,
  SubscriptionInput,
  ImportPlatform,
  ImportProgress,
  PLATFORM_COLUMN_MAPPINGS,
  PlatformColumnMapping,
} from '../utils/importExport';
import { useSubscriptionStore } from '../store';

const ImportScreen: React.FC = () => {
  const { subscriptions, addSubscription, updateSubscription, deleteSubscription } = useSubscriptionStore();
  const navigation = useNavigation<any>();

  const [importMode, setImportMode] = useState<ImportMode>('upsert');
  const [importText, setImportText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [importHistory, setImportHistory] = useState<ImportHistoryEntry[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [platform, setPlatform] = useState<ImportPlatform>('generic');
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  const handleImport = useCallback(async () => {
    if (!importText.trim()) {
      Alert.alert('Error', 'Please enter data to import');
      return;
    }

    setIsProcessing(true);
    setValidationResult(null);
    setImportResult(null);
    setImportProgress(null);

    const snapshot = takeImportSnapshot(subscriptions);

    try {
      const format = detectFormat(importText);
      let parsedData: SubscriptionInput[];
      const selectedMapping = PLATFORM_COLUMN_MAPPINGS.find((m) => m.platform === platform)!;

      if (format === 'csv') {
        parsedData =
          platform === 'generic' ? parseCSV(importText) : parseCSVWithMapping(importText, selectedMapping);
      } else if (format === 'json') {
        parsedData = parseJSON(importText);
      } else {
        Alert.alert('Error', 'Unable to detect file format. Please use CSV or JSON format.');
        setIsProcessing(false);
        return;
      }

      setImportProgress({ step: 'parsing', totalRows: parsedData.length, processedRows: parsedData.length, percentage: 33 });

      const validation = validateImport({ subscriptions: parsedData, mode: importMode });
      setValidationResult(validation);
      setImportProgress({ step: 'validating', totalRows: parsedData.length, processedRows: validation.validRows.length, percentage: 66 });

      if (validation.validRows.length === 0) {
        Alert.alert(
          'Validation Failed',
          `Found ${validation.errors.length} error(s). Please fix them and try again.`
        );
        setIsProcessing(false);
        return;
      }

      Alert.alert(
        'Import Preview',
        `Found ${validation.validRows.length} valid subscription(s).\n\n${
          validation.warnings.length > 0 ? `Warnings: ${validation.warnings.length}\n` : ''
        }Do you want to proceed with the import?`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => setIsProcessing(false),
          },
          {
            text: 'Import',
            onPress: async () => {
              await executeImport(parsedData, snapshot);
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to parse import data');
      setIsProcessing(false);
    }
  }, [importText, importMode, platform, subscriptions]);

  const executeImport = async (parsedData: SubscriptionInput[], _snapshot: ReturnType<typeof takeImportSnapshot>) => {
    setIsProcessing(true);
    const preImportIds = new Set(subscriptions.map((s) => s.id));

    try {
      const result = processImport({ subscriptions: parsedData, mode: importMode }, subscriptions);

      setImportResult(result);

      if (result.imported > 0 || result.updated > 0) {
        for (const sub of parsedData) {
          const existing = subscriptions.find(
            (s) => s.name.toLowerCase() === sub.name.toLowerCase()
          );

          if (existing) {
            await updateSubscription(existing.id, {
              name: sub.name,
              description: sub.description,
              category: sub.category as any,
              price: sub.price,
              currency: sub.currency,
              billingCycle: sub.billingCycle as any,
              nextBillingDate: new Date(sub.nextBillingDate),
              isActive: sub.isActive ?? true,
              notificationsEnabled: sub.notificationsEnabled ?? true,
              isCryptoEnabled: sub.isCryptoEnabled ?? false,
              cryptoToken: sub.cryptoToken,
              cryptoAmount: sub.cryptoAmount,
            });
          } else {
            await addSubscription({
              name: sub.name,
              description: sub.description,
              category: sub.category as any,
              price: sub.price,
              currency: sub.currency,
              billingCycle: sub.billingCycle as any,
              nextBillingDate: new Date(sub.nextBillingDate),
              notificationsEnabled: sub.notificationsEnabled ?? true,
              isCryptoEnabled: sub.isCryptoEnabled ?? false,
              cryptoToken: sub.cryptoToken,
              cryptoAmount: sub.cryptoAmount,
            });
          }
        }
      }

      setImportProgress({ step: 'done', totalRows: parsedData.length, processedRows: result.imported + result.updated, percentage: 100 });

      const sourceName = platform === 'generic' ? 'Manual Import' : `${platform.charAt(0).toUpperCase() + platform.slice(1)} Import`;
      await recordImport(sourceName, importMode, parsedData.length, result);

      Alert.alert(
        'Import Complete',
        `Imported: ${result.imported}\nUpdated: ${result.updated}\nFailed: ${result.failed}`
      );
    } catch (error) {
      // Rollback: remove subscriptions added during this import
      const currentSubs = useSubscriptionStore.getState().subscriptions;
      const toRemove = currentSubs.filter((s) => !preImportIds.has(s.id));
      for (const sub of toRemove) {
        await deleteSubscription(sub.id);
      }
      setImportProgress({ step: 'error', totalRows: 0, processedRows: 0, percentage: 0 });
      Alert.alert(
        'Import Failed',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}. Changes have been rolled back.`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const loadHistory = useCallback(async () => {
    const history = await getImportHistory();
    setImportHistory(history);
    setShowHistory(true);
  }, []);

  const clearData = useCallback(() => {
    setImportText('');
    setValidationResult(null);
    setImportResult(null);
  }, []);

  const loadTemplate = useCallback((type: 'csv' | 'json') => {
    setImportText(type === 'csv' ? getCSVTemplate() : getJSONTemplate());
    setShowTemplateModal(false);
  }, []);

  const renderPlatformSelector = () => (
    <View style={styles.modeContainer}>
      <Text style={styles.sectionTitle}>Source Platform</Text>
      <View style={styles.modeButtons}>
        {PLATFORM_COLUMN_MAPPINGS.map((mapping: PlatformColumnMapping) => (
          <TouchableOpacity
            key={mapping.platform}
            style={[styles.modeButton, platform === mapping.platform && styles.modeButtonActive]}
            onPress={() => setPlatform(mapping.platform)}>
            <Text
              style={[
                styles.modeButtonText,
                platform === mapping.platform && styles.modeButtonTextActive,
              ]}>
              {mapping.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderProgressBar = () => {
    if (!importProgress || importProgress.step === 'idle') return null;
    return (
      <View style={styles.progressContainer}>
        <Text style={styles.progressLabel}>
          {importProgress.step === 'parsing' && 'Parsing data...'}
          {importProgress.step === 'validating' && 'Validating rows...'}
          {importProgress.step === 'processing' && 'Processing...'}
          {importProgress.step === 'done' &&
            `Done: ${importProgress.processedRows} rows processed`}
          {importProgress.step === 'error' && 'Import failed — changes rolled back'}
        </Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${importProgress.percentage}%` as any,
                backgroundColor:
                  importProgress.step === 'error' ? colors.error : colors.primary,
              },
            ]}
          />
        </View>
      </View>
    );
  };

  const renderModeSelector = () => (
    <View style={styles.modeContainer}>
      <Text style={styles.sectionTitle}>Import Mode</Text>
      <View style={styles.modeButtons}>
        {(['create', 'upsert', 'replace'] as ImportMode[]).map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.modeButton, importMode === mode && styles.modeButtonActive]}
            onPress={() => setImportMode(mode)}>
            <Text
              style={[styles.modeButtonText, importMode === mode && styles.modeButtonTextActive]}>
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.modeDescription}>
        {importMode === 'create'
          ? 'Add new subscriptions only (skip duplicates)'
          : importMode === 'upsert'
            ? 'Update existing or add new subscriptions'
            : 'Replace all existing subscriptions'}
      </Text>
    </View>
  );

  const renderValidationResults = () => {
    if (!validationResult) return null;

    return (
      <Card style={styles.resultCard}>
        <Text style={styles.resultTitle}>Validation Results</Text>
        <View style={styles.resultRow}>
          <Text style={styles.resultLabel}>Valid Rows:</Text>
          <Text style={styles.resultValue}>{validationResult.validRows.length}</Text>
        </View>
        {validationResult.errors.length > 0 && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorTitle}>Errors:</Text>
            {validationResult.errors.slice(0, 5).map((error, index) => (
              <Text key={index} style={styles.errorDetailText}>
                Row {error.row}: {error.message}
              </Text>
            ))}
            {validationResult.errors.length > 5 && (
              <Text style={styles.moreText}>...and {validationResult.errors.length - 5} more</Text>
            )}
          </View>
        )}
        {validationResult.warnings.length > 0 && (
          <View style={styles.warningContainer}>
            <Text style={styles.warningTitle}>Warnings:</Text>
            {validationResult.warnings.slice(0, 3).map((warning, index) => (
              <Text key={index} style={styles.warningDetailText}>
                Row {warning.row}: {warning.message}
              </Text>
            ))}
          </View>
        )}
      </Card>
    );
  };

  const renderImportResults = () => {
    if (!importResult) return null;

    return (
      <Card style={styles.resultCard}>
        <Text style={styles.resultTitle}>Import Results</Text>
        <View style={styles.resultRow}>
          <Text style={styles.resultLabel}>Imported:</Text>
          <Text style={[styles.resultValue, styles.successText]}>{importResult.imported}</Text>
        </View>
        <View style={styles.resultRow}>
          <Text style={styles.resultLabel}>Updated:</Text>
          <Text style={[styles.resultValue, styles.successText]}>{importResult.updated}</Text>
        </View>
        <View style={styles.resultRow}>
          <Text style={styles.resultLabel}>Failed:</Text>
          <Text
            style={[
              styles.resultValue,
              importResult.failed > 0 ? styles.errorText : styles.successText,
            ]}>
            {importResult.failed}
          </Text>
        </View>
      </Card>
    );
  };

  const renderHistoryModal = () => (
    <Modal
      visible={showHistory}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowHistory(false)}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Import History</Text>
          <TouchableOpacity onPress={() => setShowHistory(false)}>
            <Text style={styles.closeButton}>Close</Text>
          </TouchableOpacity>
        </View>
        <FlashList
          data={importHistory}
          keyExtractor={(item: ImportHistoryEntry) => item.id}
          renderItem={({ item }: { item: ImportHistoryEntry }) => (
            <Card style={styles.historyCard}>
              <View style={styles.historyRow}>
                <Text style={styles.historyFile}>{item.fileName}</Text>
                <Text
                  style={[
                    styles.historyStatus,
                    item.status === 'success' && styles.successText,
                    item.status === 'partial' && styles.warningText,
                    item.status === 'failed' && styles.errorText,
                  ]}>
                  {item.status}
                </Text>
              </View>
              <Text style={styles.historyDate}>{new Date(item.timestamp).toLocaleString()}</Text>
              <Text style={styles.historyStats}>
                Imported: {item.imported} | Updated: {item.updated} | Failed: {item.failed}
              </Text>
            </Card>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No import history</Text>}
        />
      </SafeAreaView>
    </Modal>
  );

  const renderTemplateModal = () => (
    <Modal
      visible={showTemplateModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowTemplateModal(false)}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Load Template</Text>
          <TouchableOpacity onPress={() => setShowTemplateModal(false)}>
            <Text style={styles.closeButton}>Close</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.templateButtons}>
          <TouchableOpacity style={styles.templateButton} onPress={() => loadTemplate('csv')}>
            <Text style={styles.templateButtonText}>CSV Template</Text>
            <Text style={styles.templateButtonSubtext}>Sample CSV with column headers</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.templateButton} onPress={() => loadTemplate('json')}>
            <Text style={styles.templateButtonText}>JSON Template</Text>
            <Text style={styles.templateButtonSubtext}>Sample JSON export format</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Import Subscriptions</Text>
          <Text style={styles.subtitle}>Import subscription data from CSV or JSON</Text>
        </View>

        <TouchableOpacity
          style={styles.batchBanner}
          onPress={() => navigation.navigate('BatchOperations')}>
          <Text style={styles.batchBannerTitle}>Batch Operations</Text>
          <Text style={styles.batchBannerSubtext}>
            Bulk create, update, cancel, or charge multiple subscriptions at once
          </Text>
        </TouchableOpacity>

        {renderPlatformSelector()}

        {renderModeSelector()}

        <Card style={styles.inputCard}>
          <View style={styles.inputHeader}>
            <Text style={styles.sectionTitle}>Import Data</Text>
            <TouchableOpacity onPress={() => setShowTemplateModal(true)}>
              <Text style={styles.templateLink}>Load Template</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.textArea}
            multiline
            numberOfLines={10}
            placeholder={`Paste your CSV or JSON data here...\n\nExample CSV:\nname,description,category,price,currency,billingCycle,nextBillingDate\nNetflix,Streaming,streaming,15.99,USD,monthly,2026-05-01`}
            placeholderTextColor={colors.textSecondary}
            value={importText}
            onChangeText={setImportText}
            textAlignVertical="top"
          />
        </Card>

        {renderProgressBar()}
        {renderValidationResults()}
        {renderImportResults()}

        <View style={styles.buttonContainer}>
          <Button
            title={isProcessing ? 'Processing...' : 'Import Data'}
            onPress={handleImport}
            disabled={isProcessing || !importText.trim()}
            loading={isProcessing}
          />
          <Button
            title="Clear"
            onPress={clearData}
            variant="secondary"
            disabled={isProcessing || !importText}
          />
        </View>

        <TouchableOpacity style={styles.historyLink} onPress={loadHistory}>
          <Text style={styles.historyLinkText}>View Import History</Text>
        </TouchableOpacity>
      </ScrollView>

      {renderHistoryModal()}
      {renderTemplateModal()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  modeContainer: {
    padding: spacing.lg,
    paddingTop: 0,
  },
  modeButtons: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  modeButton: {
    flex: 1,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  modeButtonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: colors.onPrimary,
  },
  modeDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  inputCard: {
    margin: spacing.lg,
    marginTop: 0,
  },
  inputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  templateLink: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  textArea: {
    ...typography.body,
    minHeight: 200,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  buttonContainer: {
    padding: spacing.lg,
    paddingTop: 0,
    gap: spacing.md,
  },
  resultCard: {
    margin: spacing.lg,
    marginTop: spacing.md,
  },
  resultTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  resultLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  resultValue: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
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
  errorContainer: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.error + '20',
    borderRadius: borderRadius.md,
  },
  errorTitle: {
    ...typography.body,
    color: colors.error,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  warningContainer: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.warning + '20',
    borderRadius: borderRadius.md,
  },
  warningTitle: {
    ...typography.body,
    color: colors.warning,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  errorDetailText: {
    ...typography.caption,
    color: colors.error,
  },
  warningDetailText: {
    ...typography.caption,
    color: colors.warning,
  },
  moreText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  historyLink: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  historyLinkText: {
    ...typography.body,
    color: colors.primary,
  },
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
  closeButton: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  historyCard: {
    margin: spacing.md,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyFile: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  historyStatus: {
    ...typography.caption,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  historyDate: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  historyStats: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  templateButtons: {
    padding: spacing.lg,
  },
  templateButton: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  templateButtonText: {
    ...typography.h3,
    color: colors.text,
  },
  templateButtonSubtext: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  batchBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.primary + '20',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  batchBannerTitle: {
    ...typography.h3,
    color: colors.primary,
  },
  batchBannerSubtext: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  progressContainer: {
    margin: spacing.lg,
    marginTop: 0,
  },
  progressLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: borderRadius.full,
  },
});

export default ImportScreen;
