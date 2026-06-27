import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  Share,
  Clipboard,
  Platform,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { generateCSV, exportToJSON } from '../utils/importExport';
import { useStore } from '../store';

type ExportFormat = 'json' | 'csv';

const ExportScreen: React.FC = () => {
  const { subscriptions } = useStore();

  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');
  const [isExporting, setIsExporting] = useState(false);
  const [exportedData, setExportedData] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handleExport = useCallback(async () => {
    if (subscriptions.length === 0) {
      Alert.alert('No Data', 'There are no subscriptions to export.');
      return;
    }

    setIsExporting(true);

    try {
      let data: string;

      if (exportFormat === 'json') {
        data = exportToJSON(subscriptions);
      } else {
        data = generateCSV(subscriptions);
      }

      setExportedData(data);
      setShowPreview(true);

      Alert.alert(
        'Export Ready',
        `Exported ${subscriptions.length} subscription(s) as ${exportFormat.toUpperCase()}.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Share',
            onPress: () => shareData(data),
          },
          {
            text: 'Copy to Clipboard',
            onPress: () => copyToClipboard(data),
          },
        ]
      );
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to export data');
    } finally {
      setIsExporting(false);
    }
  }, [subscriptions, exportFormat]);

  const shareData = async (data: string) => {
    try {
      await Share.share({
        message: data,
        title: `SubTrackr Export (${exportFormat.toUpperCase()})`,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to share data');
    }
  };

  const copyToClipboard = (data: string) => {
    Clipboard.setString(data);
    Alert.alert('Copied', `${exportFormat.toUpperCase()} data copied to clipboard`);
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
        <TouchableOpacity
          style={[styles.formatButton, exportFormat === 'json' && styles.formatButtonActive]}
          onPress={() => setExportFormat('json')}>
          <Text
            style={[
              styles.formatButtonText,
              exportFormat === 'json' && styles.formatButtonTextActive,
            ]}>
            JSON
          </Text>
          <Text style={styles.formatButtonSubtext}>Full data with metadata</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.formatButton, exportFormat === 'csv' && styles.formatButtonActive]}
          onPress={() => setExportFormat('csv')}>
          <Text
            style={[
              styles.formatButtonText,
              exportFormat === 'csv' && styles.formatButtonTextActive,
            ]}>
            CSV
          </Text>
          <Text style={styles.formatButtonSubtext}>Spreadsheet compatible</Text>
        </TouchableOpacity>
      </View>
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
        title={isExporting ? 'Exporting...' : `Export as ${exportFormat.toUpperCase()}`}
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
          <TouchableOpacity style={styles.actionButton} onPress={downloadFile}>
            <Text style={styles.actionButtonText}>Download</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderInfo = () => (
    <Card style={styles.infoCard}>
      <Text style={styles.infoTitle}>Export Information</Text>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>JSON Format:</Text>
        <Text style={styles.infoValue}>
          Full export with version, timestamp, and all subscription data
        </Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>CSV Format:</Text>
        <Text style={styles.infoValue}>
          Tabular format compatible with Excel, Google Sheets, etc.
        </Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Data Included:</Text>
        <Text style={styles.infoValue}>
          Name, description, category, price, currency, billing cycle, dates, and settings
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
