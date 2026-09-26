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
  FlatList,
  Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import {
  parseCSV,
  parseJSON,
  validateImport,
  processImport,
  recordImport,
  getImportHistory,
  getCSVTemplate,
  getJSONTemplate,
  detectFormat,
  CSV_COLUMN_MAPPING,
  ImportMode,
  ImportResult,
  ValidationResult,
  ImportHistoryEntry,
  SubscriptionInput,
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
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, keyof SubscriptionInput | ''>>({});
  const [progress, setProgress] = useState<{ current: number; total: number; message?: string } | null>(null);

  const handleImport = useCallback(async () => {
    if (!importText.trim()) {
      Alert.alert('Error', 'Please enter data to import');
      return;
    }

    setIsProcessing(true);
    setValidationResult(null);
    setImportResult(null);

    try {
      const format = detectFormat(importText);
      let parsedData: SubscriptionInput[];

      if (format === 'csv') {
        // Detect headers for optional mapping
        const firstLine = importText.split(/\r?\n/).find((l) => l && l.trim());
        if (firstLine) {
          const rawHeaders = firstLine.split(',').map((h) => h.replace(/^\"|\"$/g, '').trim());
          setDetectedHeaders(rawHeaders);
        }

        // If a mapping exists, transform CSV using mapping, else use parseCSV fallback
        if (Object.keys(columnMapping).length > 0) {
          parsedData = parseCSVWithMapping(importText, columnMapping);
        } else {
          parsedData = parseCSV(importText);
        }
      } else if (format === 'json') {
        parsedData = parseJSON(importText);
      } else {
        Alert.alert('Error', 'Unable to detect file format. Please use CSV or JSON format.');
        setIsProcessing(false);
        return;
      }

      // Validate the data
      const validation = validateImport({ subscriptions: parsedData, mode: importMode });
      setValidationResult(validation);

      if (validation.validRows.length === 0) {
        Alert.alert(
          'Validation Failed',
          `Found ${validation.errors.length} error(s). Please fix them and try again.`
        );
        setIsProcessing(false);
        return;
      }

      // Show preview and ask for confirmation
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
              await executeImport(parsedData);
            },
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to parse import data');
    } finally {
      setIsProcessing(false);
    }
  }, [importText, importMode]);

  // Simple CSV line parser (handles quoted fields)
  function parseLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  function parseCSVWithMapping(content: string, mapping: Record<string, keyof SubscriptionInput | ''>): SubscriptionInput[] {
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const rawHeaders = parseLine(lines[0]);
    const headerIndex: Record<string, number> = {};
    rawHeaders.forEach((h, i) => (headerIndex[h.toLowerCase()] = i));

    const result: SubscriptionInput[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseLine(lines[i]);
      if (values.every((v) => !v)) continue;

      const row: Partial<SubscriptionInput> = {};

      for (const raw of Object.keys(mapping)) {
        const target = mapping[raw];
        if (!target) continue;
        const idx = headerIndex[raw.toLowerCase()];
        const rawValue = typeof idx === 'number' && values[idx] ? values[idx] : '';
        let value: unknown = rawValue;

        if (target === 'price' || target === 'cryptoAmount') {
          value = Number(rawValue) || 0;
        } else if (
          target === 'isActive' ||
          target === 'notificationsEnabled' ||
          target === 'isCryptoEnabled'
        ) {
          const normalized = rawValue.toString().trim().toLowerCase();
          value = normalized === 'true' || normalized === '1' || normalized === 'yes';
        }

        (row as any)[target] = value;
      }

      // ensure required defaults
      if (!row.name && values[0]) row.name = values[0];

      if (row.nextBillingDate && typeof row.nextBillingDate !== 'string') {
        row.nextBillingDate = String(row.nextBillingDate);
      }

      result.push(row as SubscriptionInput);
    }

    return result;
  }

  const openMappingModal = () => {
    if (detectedHeaders.length === 0) {
      Alert.alert('No headers detected', 'Please paste a CSV with headers first');
      return;
    }

    const initial: Record<string, keyof SubscriptionInput | ''> = {};
    detectedHeaders.forEach((h) => {
      initial[h] = columnMapping[h] ?? '';
    });
    setColumnMapping(initial);
    setShowMappingModal(true);
  };

  const cycleMappingFor = (header: string) => {
    const options = ['','name','description','category','price','currency','billingCycle','nextBillingDate','isActive','notificationsEnabled','isCryptoEnabled','cryptoToken','cryptoAmount','externalId','externalSource'] as (keyof SubscriptionInput | '')[];
    const current = columnMapping[header] ?? '';
    const idx = options.indexOf(current);
    const next = options[(idx + 1) % options.length];
    setColumnMapping((m) => ({ ...m, [header]: next }));
  };

  const executeImport = async (parsedData: SubscriptionInput[]) => {
    setIsProcessing(true);
    try {
      const result = processImport({ subscriptions: parsedData, mode: importMode }, subscriptions);
      setImportResult(result);

      const actions = result.actions ?? [];

      // Apply the import with progress and rollback support
      if (actions.length > 0) {
        const snapshot = useSubscriptionStore.getState().subscriptions.map((s) => ({ ...s }));
        let processed = 0;
        const appliedIds = new Set<string>();

        try {
          for (const action of actions) {
            const subscription = action.subscription;
            if (!subscription) continue;

            setProgress({ current: processed + 1, total: actions.length, message: `Processing ${subscription.name}` });

            if (action.type === 'update' && action.existingId) {
              await updateSubscription(action.existingId, {
                name: subscription.name,
                description: subscription.description,
                category: subscription.category as any,
                price: subscription.price,
                currency: subscription.currency,
                billingCycle: subscription.billingCycle as any,
                nextBillingDate: new Date(subscription.nextBillingDate),
                isActive: subscription.isActive,
                notificationsEnabled: subscription.notificationsEnabled,
                isCryptoEnabled: subscription.isCryptoEnabled,
                cryptoToken: subscription.cryptoToken,
                cryptoAmount: subscription.cryptoAmount,
                externalId: subscription.externalId,
                externalSource: subscription.externalSource,
              });
              appliedIds.add(action.existingId);
            } else if (action.type === 'create') {
              await addSubscription({
                id: subscription.id,
                name: subscription.name,
                description: subscription.description,
                category: subscription.category as any,
                price: subscription.price,
                currency: subscription.currency,
                billingCycle: subscription.billingCycle as any,
                nextBillingDate: new Date(subscription.nextBillingDate),
                notificationsEnabled: subscription.notificationsEnabled ?? true,
                isCryptoEnabled: subscription.isCryptoEnabled ?? false,
                cryptoToken: subscription.cryptoToken,
                cryptoAmount: subscription.cryptoAmount,
                externalId: subscription.externalId,
                externalSource: subscription.externalSource,
              });
              appliedIds.add(subscription.id);
            }

            processed += 1;
            setProgress({ current: processed, total: actions.length, message: `Processed ${processed}/${actions.length}` });
          }

          if (importMode === 'replace') {
            const currentSubscriptions = useSubscriptionStore.getState().subscriptions;
            const toDelete = currentSubscriptions.filter((sub) => !appliedIds.has(sub.id));
            for (const sub of toDelete) {
              await deleteSubscription(sub.id);
            }
          }
        } catch (applyErr) {
          // Rollback to snapshot on failure
          useSubscriptionStore.setState({ subscriptions: snapshot });
          useSubscriptionStore.getState().calculateStats();
          throw applyErr;
        }
      }

      // Record in history
      await recordImport('Manual Import', importMode, parsedData.length, result);

      Alert.alert(
        'Import Complete',
        `Imported: ${result.imported}\nUpdated: ${result.updated}\nFailed: ${result.failed}`
      );
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to complete import');
    } finally {
      setIsProcessing(false);
      setProgress(null);
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
        <FlatList
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

        {renderModeSelector()}

        <Card style={styles.inputCard}>
          <View style={styles.inputHeader}>
            <Text style={styles.sectionTitle}>Import Data</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => setShowTemplateModal(true)}>
                <Text style={styles.templateLink}>Load Template</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openMappingModal()}>
                <Text style={styles.templateLink}>Map Columns</Text>
              </TouchableOpacity>
            </View>
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

        {progress && (
          <Card style={[styles.resultCard, { marginHorizontal: spacing.lg }]}> 
            <Text style={styles.resultTitle}>Import Progress</Text>
            <Text style={styles.resultLabel}>{progress.message}</Text>
            <Text style={styles.resultValue}>{progress.current} / {progress.total}</Text>
          </Card>
        )}

        <TouchableOpacity style={styles.historyLink} onPress={loadHistory}>
          <Text style={styles.historyLinkText}>View Import History</Text>
        </TouchableOpacity>
      </ScrollView>

      {renderHistoryModal()}
      {renderTemplateModal()}
      {/* Column mapping modal */}
      <Modal
        visible={showMappingModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowMappingModal(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Map CSV Columns</Text>
            <TouchableOpacity onPress={() => setShowMappingModal(false)}>
              <Text style={styles.closeButton}>Close</Text>
            </TouchableOpacity>
          </View>
          <View style={{ padding: spacing.lg }}>
            <Text style={styles.sectionTitle}>Detected Headers</Text>
            <FlatList
              data={detectedHeaders}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={{ padding: spacing.md, borderBottomWidth: 1, borderColor: colors.border }}
                  onPress={() => cycleMappingFor(item)}>
                  <Text style={typography.body}>{item}</Text>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>Mapping: {String(columnMapping[item] || '(none)')}</Text>
                </TouchableOpacity>
              )}
            />
            <View style={{ marginTop: spacing.md }}>
              <Button title="Apply Mapping" onPress={() => setShowMappingModal(false)} />
            </View>
            <View style={{ marginTop: spacing.sm }}>
              <Text style={typography.caption}>Tap a header to cycle through target fields.</Text>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
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
});

export default ImportScreen;
