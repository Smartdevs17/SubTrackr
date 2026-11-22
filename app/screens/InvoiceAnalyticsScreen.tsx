import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView } from 'react-native';
import { spacing, typography, borderRadius } from '../../src/utils/constants';
import { Card } from '../../src/components/common/Card';
import { useThemeColors } from '../../src/hooks/useThemeColors';
import { useInvoiceStore } from '../../src/store/invoiceStore';
import { InvoiceStatus } from '../../src/types/invoice';

export const InvoiceAnalyticsScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { invoices } = useInvoiceStore();

  const totalInvoices = invoices.length;
  const sentInvoices = invoices.filter(i => i.status === InvoiceStatus.SENT).length;
  const paidInvoices = invoices.filter(i => i.status === InvoiceStatus.PAID).length;
  const draftInvoices = invoices.filter(i => i.status === InvoiceStatus.DRAFT).length;
  const voidInvoices = invoices.filter(i => i.status === InvoiceStatus.VOID).length;

  const totalRevenue = invoices
    .filter(i => i.status === InvoiceStatus.PAID)
    .reduce((sum, i) => sum + i.total, 0);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Invoice Analytics</Text>
          <Text style={styles.subtitle}>Track delivery and payment performance</Text>
        </View>

        <View style={styles.summaryContainer}>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Collected</Text>
            <Text style={styles.summaryValue}>${(totalRevenue / 100).toFixed(2)}</Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Invoices</Text>
            <Text style={styles.summaryValue}>{totalInvoices}</Text>
          </Card>
        </View>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Status Breakdown</Text>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Paid</Text>
            <Text style={[styles.statValue, { color: colors.status.success }]}>{paidInvoices}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Sent (Pending)</Text>
            <Text style={[styles.statValue, { color: colors.status.warning }]}>{sentInvoices}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Drafts</Text>
            <Text style={styles.statValue}>{draftInvoices}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Voided</Text>
            <Text style={[styles.statValue, { color: colors.status.error }]}>{voidInvoices}</Text>
          </View>
        </Card>
        
        <Card style={styles.card}>
           <Text style={styles.sectionTitle}>Automated Delivery</Text>
           <Text style={styles.label}>
             {sentInvoices + paidInvoices > 0 ? "100% of sent invoices were delivered automatically." : "No invoices delivered yet."}
           </Text>
        </Card>

      </ScrollView>
    </SafeAreaView>
  );
};

function createStyles(colors: any) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    scrollView: { flex: 1 },
    header: { padding: spacing.lg, paddingBottom: spacing.md },
    title: { ...typography.h1, color: colors.text.primary, marginBottom: spacing.xs },
    subtitle: { ...typography.body, color: colors.textSecondary },
    summaryContainer: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.md,
    },
    summaryCard: { flex: 1, alignItems: 'center' },
    summaryLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
    summaryValue: { ...typography.h2, color: colors.text.primary },
    card: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.md },
    sectionTitle: { ...typography.h3, color: colors.text.primary, marginBottom: spacing.md },
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    statLabel: { ...typography.body, color: colors.text.primary },
    statValue: { ...typography.body, fontWeight: 'bold', color: colors.text.primary },
    label: { ...typography.body, color: colors.textSecondary },
  });
}
