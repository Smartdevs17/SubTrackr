import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSubscriptionStore } from '../store/subscriptionStore';
import {
  AccountingFieldMapping,
  AccountingFormat,
  AccountingSourceField,
  ExportAnalytics,
  ExportFrequency,
  ExportHistoryEntry,
  ExportSchedule,
  delete_export_schedule,
  export_to_accounting,
  get_export_analytics,
  get_export_history,
  get_export_schedules,
  getAccountingDefaultMapping,
  record_export_download,
  run_due_exports,
  run_export_schedule,
  schedule_export,
  toggle_export_schedule,
} from '../services/accountingExport';

const sourceFields: AccountingSourceField[] = [
  'merchantId',
  'subscriptionId',
  'subscriptionName',
  'description',
  'category',
  'price',
  'currency',
  'billingCycle',
  'nextBillingDate',
  'status',
  'createdAt',
  'updatedAt',
  'custom:accountCode',
  'custom:taxType',
  'custom:quantity',
];

const formatLabels: Record<AccountingFormat, string> = {
  csv: 'CSV',
  json: 'JSON',
  quickbooks: 'QuickBooks',
  xero: 'Xero',
  pdf: 'PDF',
};

const frequencyLabels: Record<ExportFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function formatTimestamp(value: number | undefined): string {
  if (!value) return 'Not run yet';
  return new Date(value).toLocaleString();
}

function nextSourceField(current: AccountingSourceField): AccountingSourceField {
  const index = sourceFields.indexOf(current);
  return sourceFields[(index + 1) % sourceFields.length];
}

const EMPTY_ANALYTICS: ExportAnalytics = {
  totalExports: 0,
  totalDownloads: 0,
  successCount: 0,
  failedCount: 0,
  totalItemsExported: 0,
  formatBreakdown: { csv: 0, json: 0, quickbooks: 0, xero: 0, pdf: 0 },
};

const AccountingExportScreen: React.FC = () => {
  const { subscriptions } = useSubscriptionStore();
  const [merchantId, setMerchantId] = useState('default-merchant');
  const [format, setFormat] = useState<AccountingFormat>('quickbooks');
  const [frequency, setFrequency] = useState<ExportFrequency>('monthly');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [includeSchema, setIncludeSchema] = useState(false);
  const [fieldMappings, setFieldMappings] = useState<AccountingFieldMapping[]>(
    getAccountingDefaultMapping('quickbooks')
  );
  const [customFields, setCustomFields] = useState<Record<string, string>>({
    accountCode: '400',
    taxType: 'NONE',
    quantity: '1',
  });
  const [history, setHistory] = useState<ExportHistoryEntry[]>([]);
  const [schedules, setSchedules] = useState<ExportSchedule[]>([]);
  const [analytics, setAnalytics] = useState<ExportAnalytics>(EMPTY_ANALYTICS);
  const [latestPreview, setLatestPreview] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const exportableSubscriptions = useMemo(
    () =>
      includeInactive
        ? subscriptions
        : subscriptions.filter((subscription) => subscription.isActive),
    [includeInactive, subscriptions]
  );

  const loadExportState = useCallback(async () => {
    const [nextHistory, nextSchedules, nextAnalytics] = await Promise.all([
      get_export_history(merchantId),
      get_export_schedules(),
      get_export_analytics(merchantId),
    ]);
    setHistory(nextHistory);
    setSchedules(nextSchedules.filter((schedule) => schedule.merchantId === merchantId));
    setAnalytics(nextAnalytics);
  }, [merchantId]);

  useEffect(() => {
    setFieldMappings(getAccountingDefaultMapping(format));
  }, [format]);

  useEffect(() => {
    void loadExportState();
  }, [loadExportState]);

  const updateMappingTarget = useCallback((index: number, targetField: string) => {
    setFieldMappings((current) =>
      current.map((mapping, mappingIndex) =>
        mappingIndex === index ? { ...mapping, targetField } : mapping
      )
    );
  }, []);

  const cycleMappingSource = useCallback((index: number) => {
    setFieldMappings((current) =>
      current.map((mapping, mappingIndex) =>
        mappingIndex === index
          ? { ...mapping, sourceField: nextSourceField(mapping.sourceField) }
          : mapping
      )
    );
  }, []);

  const updateCustomField = useCallback((key: string, value: string) => {
    setCustomFields((current) => ({ ...current, [key]: value }));
  }, []);

  const handleExportNow = useCallback(async () => {
    setIsExporting(true);
    try {
      const result = await export_to_accounting(merchantId, format, {
        subscriptions,
        includeInactive,
        fieldMappings,
        customFields,
        includeSchema: format === 'json' ? includeSchema : undefined,
      });
      setLatestPreview(result.content.slice(0, 1200));
      await Clipboard.setStringAsync(result.content);
      await loadExportState();
      Alert.alert(
        'Export ready',
        `${result.itemCount} subscriptions exported to ${result.fileName}. Content copied to clipboard.`
      );
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : String(error));
    } finally {
      setIsExporting(false);
    }
  }, [
    customFields,
    fieldMappings,
    format,
    includeInactive,
    includeSchema,
    loadExportState,
    merchantId,
    subscriptions,
  ]);

  const handleScheduleExport = useCallback(async () => {
    const sched = await schedule_export({
      merchantId,
      format,
      frequency,
      includeInactive,
      fieldMappings,
      customFields,
      destination: 'download',
    });
    await loadExportState();
    Alert.alert(
      'Export scheduled',
      `Next ${formatLabels[format]} export: ${formatTimestamp(sched.nextRunAt)}`
    );
  }, [
    customFields,
    fieldMappings,
    format,
    frequency,
    includeInactive,
    loadExportState,
    merchantId,
  ]);

  const handleRunDueSchedules = useCallback(async () => {
    const runs = await run_due_exports(subscriptions);
    await loadExportState();
    Alert.alert('Scheduled exports checked', `${runs.length} due export(s) completed.`);
  }, [loadExportState, subscriptions]);

  const handleToggleSchedule = useCallback(
    async (scheduleId: string, enabled: boolean) => {
      await toggle_export_schedule(scheduleId, enabled);
      await loadExportState();
    },
    [loadExportState]
  );

  const handleDeleteSchedule = useCallback(
    async (scheduleId: string) => {
      Alert.alert('Delete schedule', 'Remove this scheduled export permanently?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await delete_export_schedule(scheduleId);
            await loadExportState();
          },
        },
      ]);
    },
    [loadExportState]
  );

  const handleRunScheduleNow = useCallback(
    async (scheduleId: string) => {
      const run = await run_export_schedule(scheduleId, subscriptions);
      if (!run) {
        Alert.alert('Not found', 'Schedule not found.');
        return;
      }
      await loadExportState();
      Alert.alert('Done', `${run.result.itemCount} items exported immediately.`);
    },
    [loadExportState, subscriptions]
  );

  const handleRedownload = useCallback(async (entry: ExportHistoryEntry) => {
    if (!entry.content) {
      Alert.alert('Not available', 'Content was not stored for this export.');
      return;
    }
    await Clipboard.setStringAsync(entry.content);
    await record_export_download(entry.id);
    Alert.alert('Re-downloaded', `${entry.fileName ?? 'Export'} copied to clipboard.`);
  }, []);

  const successRate =
    analytics.totalExports > 0
      ? Math.round((analytics.successCount / analytics.totalExports) * 100)
      : 0;

  const topFormat = (
    Object.entries(analytics.formatBreakdown) as [AccountingFormat, number][]
  ).sort((a, b) => b[1] - a[1])[0];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Accounting systems</Text>
          <Text style={styles.title}>Subscription export</Text>
          <Text style={styles.subtitle}>
            Generate accounting-ready exports in CSV, JSON, PDF, QuickBooks, or Xero format. Map
            fields, schedule repeat exports, and track download analytics.
          </Text>
        </View>

        {/* ── Analytics dashboard ── */}
        <View style={styles.analyticsHeader}>
          <Text style={styles.sectionTitle}>Export analytics</Text>
        </View>
        <View style={styles.analyticsGrid}>
          <Card style={styles.analyticsCard}>
            <Text style={styles.analyticsValue}>{analytics.totalExports}</Text>
            <Text style={styles.analyticsLabel}>Total exports</Text>
          </Card>
          <Card style={styles.analyticsCard}>
            <Text style={styles.analyticsValue}>{analytics.totalDownloads}</Text>
            <Text style={styles.analyticsLabel}>Downloads</Text>
          </Card>
          <Card style={styles.analyticsCard}>
            <Text style={[styles.analyticsValue, analytics.failedCount > 0 && styles.errorText]}>
              {successRate}%
            </Text>
            <Text style={styles.analyticsLabel}>Success rate</Text>
          </Card>
          <Card style={styles.analyticsCard}>
            <Text style={styles.analyticsValue}>{analytics.totalItemsExported}</Text>
            <Text style={styles.analyticsLabel}>Records exported</Text>
          </Card>
        </View>
        {topFormat && topFormat[1] > 0 && (
          <Card style={styles.analyticsTopFormat}>
            <Text style={styles.analyticsTopFormatText}>
              Most used format:{' '}
              <Text style={styles.analyticsFormatBadge}>
                {formatLabels[topFormat[0]]} ({topFormat[1]})
              </Text>
            </Text>
          </Card>
        )}

        {/* ── Subscription summary ── */}
        <View style={styles.summaryRow}>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Exportable</Text>
            <Text style={styles.summaryValue}>{exportableSubscriptions.length}</Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Schedules</Text>
            <Text style={styles.summaryValue}>{schedules.length}</Text>
          </Card>
        </View>

        {/* ── Export setup ── */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Export setup</Text>
          <Text style={styles.inputLabel}>Merchant ID</Text>
          <TextInput
            style={styles.input}
            value={merchantId}
            onChangeText={setMerchantId}
            autoCapitalize="none"
            placeholder="merchant_123"
            placeholderTextColor={colors.textSecondary}
          />

          <Text style={styles.inputLabel}>Format</Text>
          <View style={styles.optionRow}>
            {(['csv', 'json', 'quickbooks', 'xero', 'pdf'] as AccountingFormat[]).map((item) => (
              <TouchableOpacity
                key={item}
                style={[styles.optionButton, format === item && styles.optionButtonActive]}
                onPress={() => setFormat(item)}>
                <Text
                  style={[
                    styles.optionButtonText,
                    format === item && styles.optionButtonTextActive,
                  ]}>
                  {formatLabels[item]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* JSON schema toggle */}
          {format === 'json' && (
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingLabel}>Include JSON schema envelope</Text>
                <Text style={styles.settingDescription}>
                  Wraps output with `$schema`, `schemaVersion`, `merchantId`, `exportedAt`, and
                  `recordCount` per Draft-07.
                </Text>
              </View>
              <Switch
                value={includeSchema}
                onValueChange={setIncludeSchema}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>
          )}

          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingLabel}>Include inactive subscriptions</Text>
              <Text style={styles.settingDescription}>
                Include cancelled or paused records for audit imports.
              </Text>
            </View>
            <Switch
              value={includeInactive}
              onValueChange={setIncludeInactive}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
        </Card>

        {/* ── Custom field values ── */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Custom field values</Text>
          {Object.entries(customFields).map(([key, value]) => (
            <View key={key} style={styles.customFieldRow}>
              <Text style={styles.customFieldLabel}>{key}</Text>
              <TextInput
                style={[styles.input, styles.customFieldInput]}
                value={value}
                onChangeText={(nextValue) => updateCustomField(key, nextValue)}
                placeholderTextColor={colors.textSecondary}
              />
            </View>
          ))}
        </Card>

        {/* ── Field mapping (hidden for PDF) ── */}
        {format !== 'pdf' && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Field mapping</Text>
            <Text style={styles.helperText}>
              Edit target column names, or tap a source field to cycle through subscription fields.
            </Text>
            {fieldMappings.map((mapping, index) => (
              <View key={`${mapping.targetField}-${index}`} style={styles.mappingRow}>
                <TextInput
                  style={[styles.input, styles.mappingInput]}
                  value={mapping.targetField}
                  onChangeText={(targetField) => updateMappingTarget(index, targetField)}
                  placeholder="Target column"
                  placeholderTextColor={colors.textSecondary}
                />
                <TouchableOpacity
                  style={styles.sourceButton}
                  onPress={() => cycleMappingSource(index)}>
                  <Text style={styles.sourceButtonText} numberOfLines={1}>
                    {mapping.sourceField}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </Card>
        )}

        {/* ── Schedule ── */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule</Text>
          <View style={styles.optionRow}>
            {(['daily', 'weekly', 'monthly'] as ExportFrequency[]).map((item) => (
              <TouchableOpacity
                key={item}
                style={[styles.optionButton, frequency === item && styles.optionButtonActive]}
                onPress={() => setFrequency(item)}>
                <Text
                  style={[
                    styles.optionButtonText,
                    frequency === item && styles.optionButtonTextActive,
                  ]}>
                  {frequencyLabels[item]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={handleScheduleExport}>
            <Text style={styles.primaryButtonText}>Schedule export</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleRunDueSchedules}>
            <Text style={styles.secondaryButtonText}>Run due schedules</Text>
          </TouchableOpacity>
        </Card>

        {/* ── Export now ── */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Export now</Text>
          <TouchableOpacity
            style={[styles.primaryButton, isExporting && styles.disabledButton]}
            onPress={handleExportNow}
            disabled={isExporting}>
            <Text style={styles.primaryButtonText}>
              {isExporting ? 'Exporting…' : `Export ${formatLabels[format]}`}
            </Text>
          </TouchableOpacity>
          {latestPreview.length > 0 && (
            <View style={styles.previewBox}>
              <Text style={styles.previewTitle}>Latest export preview</Text>
              <Text style={styles.previewText} numberOfLines={10}>
                {latestPreview}
              </Text>
            </View>
          )}
        </Card>

        {/* ── Scheduled exports list ── */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Scheduled exports</Text>
          {schedules.length === 0 ? (
            <Text style={styles.emptyText}>No schedules configured for this merchant.</Text>
          ) : (
            schedules.map((sched) => (
              <View key={sched.id} style={styles.recordRow}>
                <View style={styles.recordCopy}>
                  <Text style={styles.recordTitle}>{formatLabels[sched.format]}</Text>
                  <Text style={styles.recordMeta}>
                    {frequencyLabels[sched.frequency]} — next {formatTimestamp(sched.nextRunAt)}
                  </Text>
                  {sched.lastRunAt != null && (
                    <Text style={styles.recordMeta}>
                      Last run: {formatTimestamp(sched.lastRunAt)}
                    </Text>
                  )}
                </View>
                <View style={styles.scheduleActions}>
                  <Switch
                    value={sched.enabled}
                    onValueChange={(val) => handleToggleSchedule(sched.id, val)}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.surface}
                    style={styles.scheduleSwitch}
                  />
                  <TouchableOpacity
                    style={styles.iconButton}
                    onPress={() => handleRunScheduleNow(sched.id)}>
                    <Text style={styles.iconButtonText}>▶</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.iconButton, styles.iconButtonDestructive]}
                    onPress={() => handleDeleteSchedule(sched.id)}>
                    <Text style={[styles.iconButtonText, styles.iconButtonTextDestructive]}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </Card>

        {/* ── Export history ── */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Export history</Text>
          {history.length === 0 ? (
            <Text style={styles.emptyText}>No exports have been recorded yet.</Text>
          ) : (
            history.map((entry) => (
              <TouchableOpacity
                key={entry.id}
                style={styles.recordRow}
                onPress={() => handleRedownload(entry)}>
                <View style={styles.recordCopy}>
                  <Text style={styles.recordTitle}>
                    {formatLabels[entry.format]} — {entry.itemCount} item(s)
                  </Text>
                  <Text style={styles.recordMeta}>
                    {formatTimestamp(entry.createdAt)}
                    {entry.fileName ? ` · ${entry.fileName}` : ''}
                  </Text>
                  {(entry.downloadCount ?? 0) > 0 && (
                    <Text style={styles.recordMeta}>
                      Downloaded {entry.downloadCount} time{entry.downloadCount !== 1 ? 's' : ''}
                    </Text>
                  )}
                </View>
                <Text
                  style={[styles.statusPill, entry.status === 'failed' && styles.statusPillError]}>
                  {entry.status}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  header: { padding: spacing.lg, paddingBottom: spacing.md },
  eyebrow: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },

  // Analytics dashboard
  analyticsHeader: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  analyticsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  analyticsCard: {
    width: '47%',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  analyticsValue: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '700',
  },
  analyticsLabel: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  analyticsTopFormat: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  analyticsTopFormatText: { ...typography.caption, color: colors.textSecondary },
  analyticsFormatBadge: { color: colors.primary, fontWeight: '700' },
  errorText: { color: colors.error },

  // Summary row
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  summaryCard: { flex: 1, alignItems: 'center' },
  summaryLabel: { ...typography.caption, color: colors.textSecondary },
  summaryValue: { ...typography.h2, color: colors.text, fontWeight: '700' },

  section: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  optionButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  optionButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionButtonText: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
  optionButtonTextActive: { color: colors.text },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  settingCopy: { flex: 1, marginRight: spacing.md },
  settingLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  settingDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  helperText: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md },
  customFieldRow: { marginBottom: spacing.sm },
  customFieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  customFieldInput: { flex: 1 },
  mappingRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  mappingInput: { flex: 1.1 },
  sourceButton: {
    flex: 0.9,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    backgroundColor: colors.primary + '12',
  },
  sourceButtonText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryButtonText: { ...typography.body, color: colors.text, fontWeight: '700' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  secondaryButtonText: { ...typography.body, color: colors.textSecondary, fontWeight: '700' },
  disabledButton: { opacity: 0.6 },
  previewBox: {
    marginTop: spacing.md,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  previewTitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  previewText: { ...typography.caption, color: colors.text, lineHeight: 18 },

  // Schedule row
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  recordCopy: { flex: 1, marginRight: spacing.sm },
  recordTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  recordMeta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  scheduleActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  scheduleSwitch: { marginRight: spacing.xs },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonDestructive: { borderColor: colors.error + '80' },
  iconButtonText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  iconButtonTextDestructive: { color: colors.error },
  statusPill: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  statusPillError: { color: colors.error },
  emptyText: { ...typography.body, color: colors.textSecondary },
});

export default AccountingExportScreen;
