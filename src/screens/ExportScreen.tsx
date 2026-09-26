import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  Share,
  Platform,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { generateCSV, exportToJSON } from '../utils/importExport';
import { useSubscriptionStore } from '../store';
import { export_to_accounting, AccountingFormat } from '../services/accountingExport';

type ExportFormat = 'json' | 'csv' | 'pdf' | 'quickbooks' | 'xero';

const FORMAT_LABELS: Record<ExportFormat, string> = {
  json: 'JSON',
  csv: 'CSV',
  pdf: 'PDF',
  quickbooks: 'QuickBooks',
  xero: 'Xero',
};

const FORMAT_DESCRIPTIONS: Record<ExportFormat, string> = {
  json: 'Full data with metadata. Optionally includes JSON schema envelope.',
  csv: 'Spreadsheet compatible (Excel, Google Sheets, etc.)',
  pdf: 'Formatted PDF report for printing and archival.',
  quickbooks: 'QuickBooks-compatible CSV (Customer, Product/Service, Amount…)',
  xero: 'Xero-compatible CSV (ContactName, InvoiceNumber, UnitAmount…)',
};

const ExportScreen: React.FC = () => {
  const { subscriptions } = useSubscriptionStore();

  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');
  const [isExporting, setIsExporting] = useState(false);
  const [exportedData, setExportedData] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [includeSchema, setIncludeSchema] = useState(false);

  const handleExport = useCallback(async () => {
    if (subscriptions.length === 0) {
      Alert.alert('No Data', 'There are no subscriptions to export.');
      return;
    }

    setIsExporting(true);

    try {
      let data: string;

      if (exportFormat === 'json' || exportFormat === 'csv') {
        // Basic utility exports (preserving existing behaviour)
        if (exportFormat === 'json') {
          data = exportToJSON(subscriptions);
        } else {
          data = generateCSV(subscriptions);
        }
      } else {
        // Accounting-format exports (pdf, quickbooks, xero)
        const result = await export_to_accounting('default-merchant', exportFormat as AccountingFormat, {
          subscriptions,
          includeSchema: exportFormat === 'json' ? includeSchema : undefined,
        });
        data = result.content;
      }

      setExportedData(data);
      setShowPreview(true);

      Alert.alert(
        'Export Ready',
        `Exported ${subscriptions.length} subscription(s) as ${FORMAT_LABELS[exportFormat]}.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Share',
            onPress: () => shareData(data),
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to export data');
    } finally {
      setIsExporting(false);
    }
  }, [subscriptions, exportFormat, includeSchema]);

  const shareData = async (data: string) => {
    try {
      await Share.share({
        message: data,
        title: `SubTrackr Export (${FORMAT_LABELS[exportFormat]})`,
      });
    } catch {
      Alert.alert('Error', 'Failed to share data');
    }
  };

  const copyToClipboard = async (data: string) => {
    try {
      const { default: Clipboard } = await import('expo-clipboard');
      await Clipboard.setStringAsync(data);
      Alert.alert('Copied', `${FORMAT_LABELS[exportFormat]} data copied to clipboard`);
    } catch {
      Alert.alert('Copy failed', 'Could not copy to clipboard.');
    }
  };

  const downloadFile = () => {
    if (!exportedData) return;

    // In a real implementation, this would use a file system library
    // like expo-file-system to save the file
    Alert.alert(
      'Download',
      'In a production app, this would save the file to the device storage.',
      [{ text: 'OK' }]
    );
  };

  const renderFormatSelector = () => (
    <View style={styles.formatContainer}>
      <Text style={styles.sectionTitle}>Export Format</Text>
      <View style={styles.formatButtons}>
        {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((fmt) => (
          <TouchableOpacity
            key={fmt}
            style={[styles.formatButton, exportFormat === fmt && styles.formatButtonActive]}
            onPress={() => setExportFormat(fmt)}>
            <Text
              style={[
                styles.formatButtonText,
                exportFormat === fmt && styles.formatButtonTextActive,
              ]}>
              {FORMAT_LABELS[fmt]}
            </Text>
            <Text style={styles.formatButtonSubtext}>{FORMAT_DESCRIPTIONS[fmt]}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {exportFormat === 'json' && (
        <View style={styles.schemaRow}>
          <View style={styles.schemaCopy}>
            <Text style={styles.schemaLabel}>Include JSON schema envelope</Text>
            <Text style={styles.schemaDescription}>
              Wraps output with `$schema`, `schemaVersion`, `merchantId` per Draft-07.
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
    </View>
  );

  const renderSubscriptionStats = () => (
    <Card style={styles.statsCard}>
      <Text style={styles.sectionTitle}>Export Summary</Text>
      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{subscriptions.length}</Text>
          <Text style={styles.statLabel}>Total Subscriptions</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{subscriptions.filter((s) => s.isActive).length}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{subscriptions.filter((s) => !s.isActive).length}</Text>
          <Text style={styles.statLabel}>Paused</Text>
        </View>
      </View>
      <View style={styles.categoryBreakdown}>
        <Text style={styles.categoryTitle}>By Category</Text>
        {getCategoryStats().map((cat) => (
          <View key={cat.name} style={styles.categoryRow}>
            <Text style={styles.categoryName}>{cat.name}</Text>
            <Text style={styles.categoryCount}>{cat.count}</Text>
          </View>
        ))}
      </View>
    </Card>
  );

  const getCategoryStats = () => {
    const categoryMap = new Map<string, number>();
    subscriptions.forEach((sub) => {
      const count = categoryMap.get(sub.category) || 0;
      categoryMap.set(sub.category, count + 1);
    });

    return Array.from(categoryMap.entries())
      .map(([name, count]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), count }))
      .sort((a, b) => b.count - a.count);
  };

  const renderPreview = () => {
    if (!showPreview || !exportedData) return null;

    const previewText =
      exportedData.length > 500 ? exportedData.substring(0, 500) + '...' : exportedData;

    return (
      <Card style={styles.previewCard}>
        <View style={styles.previewHeader}>
          <Text style={styles.sectionTitle}>Preview</Text>
          <TouchableOpacity onPress={() => setShowPreview(false)}>
            <Text style={styles.hidePreview}>Hide</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.previewContent}>
          <Text style={styles.previewText}>{previewText}</Text>
        </View>
      </Card>
    );
  };

  const renderActions = () => (
    <View style={styles.actionsContainer}>
      <Button
        title={isExporting ? 'Exporting...' : `Export as ${FORMAT_LABELS[exportFormat]}`}
        onPress={handleExport}
        disabled={isExporting || subscriptions.length === 0}
        loading={isExporting}
      />

      {exportedData && (
        <View style={styles.actionButtons}>
          <TouchableOpacity style={styles.actionButton} onPress={() => shareData(exportedData)}>
            <Text style={styles.actionButtonText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => copyToClipboard(exportedData)}>
            <Text style={styles.actionButtonText}>Copy</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderInfo = () => (
    <Card style={styles.infoCard}>
      <Text style={styles.infoTitle}>Export Information</Text>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>JSON:</Text>
        <Text style={styles.infoValue}>
          Full export with version, timestamp, and all subscription data. Supports optional JSON
          Schema Draft-07 envelope for integration validation.
        </Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>CSV:</Text>
        <Text style={styles.infoValue}>
          Tabular format compatible with Excel, Google Sheets, etc.
        </Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>PDF:</Text>
        <Text style={styles.infoValue}>
          Formatted table report ready for printing or archival storage.
        </Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>QuickBooks / Xero:</Text>
        <Text style={styles.infoValue}>
          Accounting-ready CSVs with standard column names (Customer, UnitAmount, etc.).
          For advanced column mapping, use the Accounting Export screen.
        </Text>
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Export Subscriptions</Text>
          <Text style={styles.subtitle}>Export your subscription data for backup or migration</Text>
        </View>

        {renderSubscriptionStats()}
        {renderFormatSelector()}
        {renderInfo()}
        {renderPreview()}
        {renderActions()}

        {subscriptions.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No Subscriptions</Text>
            <Text style={styles.emptyText}>Add some subscriptions first before exporting.</Text>
          </View>
        )}
      </ScrollView>
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
  statsCard: {
    margin: spacing.lg,
    marginTop: 0,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.lg,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    ...typography.h1,
    color: colors.primary,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  categoryBreakdown: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  categoryTitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  categoryName: {
    ...typography.body,
    color: colors.text,
  },
  categoryCount: {
    ...typography.body,
    color: colors.textSecondary,
  },
  formatContainer: {
    padding: spacing.lg,
    paddingTop: 0,
  },
  formatButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  formatButton: {
    flex: 1,
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  formatButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '20',
  },
  formatButtonText: {
    ...typography.h3,
    color: colors.text,
  },
  formatButtonTextActive: {
    color: colors.primary,
  },
  formatButtonSubtext: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  schemaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  schemaCopy: { flex: 1, marginRight: spacing.md },
  schemaLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  schemaDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  infoCard: {
    margin: spacing.lg,
    marginTop: 0,
  },
  infoTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  infoRow: {
    marginBottom: spacing.md,
  },
  infoLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  infoValue: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  previewCard: {
    margin: spacing.lg,
    marginTop: 0,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hidePreview: {
    ...typography.body,
    color: colors.primary,
  },
  previewContent: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    maxHeight: 200,
  },
  previewText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  actionsContainer: {
    padding: spacing.lg,
    paddingTop: 0,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.lg,
  },
  actionButton: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 100,
    alignItems: 'center',
  },
  actionButtonText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.text,
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});

export default ExportScreen;
