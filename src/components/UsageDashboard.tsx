import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../hooks/useThemeColors';

export const UsageDashboard = () => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Usage & Billing</Text>

      <View style={styles.card}>
        <Text style={styles.metricTitle}>API Calls</Text>
        <Text style={styles.metricValue}>85,000 / 100,000</Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: '85%' }]} />
        </View>
        <Text style={styles.alertText}>Warning: Approaching 100% threshold</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.metricTitle}>Compute (Hours)</Text>
        <Text style={styles.metricValue}>120 / 500</Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: '24%' }]} />
        </View>
      </View>
    </View>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { padding: 16 },
    title: { fontSize: 22, fontWeight: 'bold', marginBottom: 16, color: colors.text },
    card: { padding: 16, backgroundColor: colors.surface, borderRadius: 8, marginBottom: 12 },
    metricTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
    metricValue: { fontSize: 14, marginVertical: 8, color: colors.text },
    progressBar: {
      height: 8,
      backgroundColor: colors.border,
      borderRadius: 4,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', backgroundColor: colors.primary },
    alertText: { color: colors.status.warning, fontSize: 12, marginTop: 8 },
  });
}
