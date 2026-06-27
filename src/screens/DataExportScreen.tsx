import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useThemeColors } from '../hooks/useThemeColors';
import { gdprService, PII_FIELDS } from '../services/gdpr';

const DataExportScreen = () => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);
  const [lastExport, setLastExport] = useState<{ url: string; timestamp: string } | null>(null);

  const handleExport = async () => {
    setLoading(true);
    try {
      const result = await gdprService.exportData();
      setLastExport({ url: result.url, timestamp: result.timestamp });
      await gdprService.downloadData(result);
    } catch {
      Alert.alert('Error', 'Could not prepare your data export. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const categoryGroups = Array.from(
    PII_FIELDS.reduce((acc, field) => {
      const list = acc.get(field.category) ?? [];
      list.push(field);
      acc.set(field.category, list);
      return acc;
    }, new Map<string, typeof PII_FIELDS>())
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      accessibilityLabel="Data Export screen">
      <Text style={styles.title}>Export Your Data</Text>
      <Text style={styles.subtitle}>
        Under GDPR Article 20, you have the right to receive a machine-readable copy of all personal
        data we hold about you.
      </Text>

      {/* Data categories included */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>What's included</Text>
        {categoryGroups.map(([category, fields]) => (
          <View key={category} style={styles.categoryRow}>
            <Text style={styles.categoryLabel}>{category.charAt(0).toUpperCase() + category.slice(1)}</Text>
            <Text style={styles.categoryFields}>{fields.map((f) => f.field).join(', ')}</Text>
          </View>
        ))}
      </View>

      {/* Export info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Export details</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Format</Text>
          <Text style={styles.infoValue}>JSON (machine-readable)</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Encryption</Text>
          <Text style={styles.infoValue}>AES-256, fields annotated</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Delivery</Text>
          <Text style={styles.infoValue}>Sent to registered email</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Processing time</Text>
          <Text style={styles.infoValue}>Within 72 hours</Text>
        </View>
      </View>

      {lastExport && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Last export</Text>
          <Text style={styles.infoValue}>
            Generated: {new Date(lastExport.timestamp).toLocaleString()}
          </Text>
          <Text style={styles.infoValue} numberOfLines={1}>
            URL: {lastExport.url}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.exportBtn, loading && styles.exportBtnDisabled]}
        onPress={handleExport}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel="Request data export"
        accessibilityState={{ disabled: loading, busy: loading }}>
        {loading ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.exportBtnText}>📦 Request Data Export</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.footer}>
        Your export request is logged in the Data Processing Activity register as required by GDPR
        Article 30.
      </Text>
    </ScrollView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    content: { padding: 16, paddingBottom: 40 },
    title: { fontSize: 24, fontWeight: '700', color: colors.text.primary, marginBottom: 8 },
    subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 20, lineHeight: 20 },
    card: {
      backgroundColor: colors.background.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary, marginBottom: 12 },
    categoryRow: {
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    categoryLabel: { fontSize: 13, fontWeight: '600', color: colors.text.primary, textTransform: 'capitalize' },
    categoryFields: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    infoLabel: { fontSize: 13, color: colors.textSecondary },
    infoValue: { fontSize: 13, color: colors.text.primary, maxWidth: '60%', textAlign: 'right' },
    exportBtn: {
      backgroundColor: colors.primary,
      padding: 16,
      borderRadius: 10,
      alignItems: 'center',
      marginBottom: 16,
    },
    exportBtnDisabled: { opacity: 0.6 },
    exportBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
    footer: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  });
}

export default DataExportScreen;
