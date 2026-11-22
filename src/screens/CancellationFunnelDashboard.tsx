import React, { useMemo } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '../components/common/Card';
import { getCancellationFunnelAnalytics } from '../../backend/services/analytics/retentionService';
import { borderRadius, colors, spacing, typography } from '../utils/constants';

const REASON_LABELS: Record<string, string> = {
  price: 'Too Expensive',
  competitor: 'Switching to Competitor',
  technical: 'Technical Issues',
  missing_feature: 'Missing Features',
  not_using: 'Not Using It',
  payment_failure: 'Payment Failure',
  other: 'Other',
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: colors.success,
  neutral: colors.textSecondary,
  negative: colors.error,
};

const CancellationFunnelDashboard: React.FC = () => {
  const navigation = useNavigation();
  const analytics = useMemo(() => getCancellationFunnelAnalytics(), []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Cancellation Funnel</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.summaryRow}>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{analytics.totalCancellations}</Text>
            <Text style={styles.summaryLabel}>Total</Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{(analytics.saveRate * 100).toFixed(1)}%</Text>
            <Text style={styles.summaryLabel}>Save Rate</Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryValue}>
              {(analytics.reactivationRate * 100).toFixed(1)}%
            </Text>
            <Text style={styles.summaryLabel}>Reactivation</Text>
          </Card>
        </View>

        <Text style={styles.sectionLabel}>Voluntary vs Involuntary</Text>
        <Card style={styles.row}>
          <Text style={styles.rowLabel}>Voluntary</Text>
          <Text style={styles.rowValue}>{analytics.voluntaryCount}</Text>
        </Card>
        <Card style={styles.row}>
          <Text style={styles.rowLabel}>Involuntary (payment failure)</Text>
          <Text style={styles.rowValue}>{analytics.involuntaryCount}</Text>
        </Card>

        <Text style={styles.sectionLabel}>Reason Distribution</Text>
        {Object.entries(analytics.reasonDistribution).map(([reason, count]) => (
          <Card key={reason} style={styles.row}>
            <Text style={styles.rowLabel}>{REASON_LABELS[reason] ?? reason}</Text>
            <Text style={styles.rowValue}>{count}</Text>
          </Card>
        ))}

        <Text style={styles.sectionLabel}>Feedback Sentiment</Text>
        {Object.entries(analytics.sentimentDistribution).map(([sentiment, count]) => (
          <Card key={sentiment} style={styles.row}>
            <Text style={[styles.rowLabel, { color: SENTIMENT_COLORS[sentiment] }]}>
              {sentiment[0].toUpperCase() + sentiment.slice(1)}
            </Text>
            <Text style={styles.rowValue}>{count}</Text>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { marginRight: spacing.md },
  title: { ...typography.h3, color: colors.text },
  scrollContent: { padding: spacing.md },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  summaryCard: { flex: 1, alignItems: 'center', paddingVertical: spacing.md },
  summaryValue: { ...typography.h2, color: colors.primary },
  summaryLabel: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  sectionLabel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  rowLabel: { ...typography.body, color: colors.text },
  rowValue: { ...typography.body, fontWeight: '700', color: colors.text },
});

export default CancellationFunnelDashboard;
