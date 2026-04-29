import React, { useMemo } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInvoiceStore } from '../store';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { formatCurrency, formatDate } from '../utils/formatting';
import { InvoiceStatus } from '../types/invoice';
import { RootStackParamList } from '../navigation/types';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const statusLabel: Record<InvoiceStatus, string> = {
  [InvoiceStatus.DRAFT]: 'Draft',
  [InvoiceStatus.SENT]: 'Sent',
  [InvoiceStatus.PARTIAL]: 'Partial',
  [InvoiceStatus.PAID]: 'Paid',
  [InvoiceStatus.VOID]: 'Void',
};

const statusStyles: Record<InvoiceStatus, object> = {
  [InvoiceStatus.DRAFT]: { backgroundColor: '#4B5563' },
  [InvoiceStatus.SENT]: { backgroundColor: colors.primary },
  [InvoiceStatus.PARTIAL]: { backgroundColor: '#CA8A04' },
  [InvoiceStatus.PAID]: { backgroundColor: '#16A34A' },
  [InvoiceStatus.VOID]: { backgroundColor: '#DC2626' },
};

const InvoiceListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const invoices = useInvoiceStore((state) => state.invoices);

  const sortedInvoices = useMemo(
    () => [...invoices].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [invoices]
  );

  return (
    <SafeAreaView style={styles.container} testID="invoice-list-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Invoices</Text>
          <Text style={styles.subtitle}>Track generated billing records and delivery status.</Text>
        </View>

        {sortedInvoices.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            message="Invoices are created automatically after successful billing events."
            icon="🧾"
          />
        ) : (
          sortedInvoices.map((invoice) => (
            <TouchableOpacity
              key={invoice.id}
              onPress={() => navigation.navigate('InvoiceDetail', { id: invoice.id })}
              activeOpacity={0.85}>
              <Card style={styles.invoiceCard}>
                <View style={styles.row}>
                  <View style={styles.meta}>
                    <Text style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
                    <Text style={styles.invoiceName}>{invoice.subscriptionName}</Text>
                  </View>
                  <View style={[styles.statusBadge, statusStyles[invoice.status]]}>
                    <Text style={styles.statusText}>{statusLabel[invoice.status]}</Text>
                  </View>
                </View>

                <View style={styles.detailsRow}>
                  <Text style={styles.detailLabel}>Total</Text>
                  <Text style={styles.totalValue}>
                    {formatCurrency(invoice.total, invoice.currency)}
                  </Text>
                </View>
                <View style={styles.detailsRow}>
                  <Text style={styles.detailLabel}>Due</Text>
                  <Text style={styles.detailValue}>{formatDate(invoice.dueDate)}</Text>
                </View>
              </Card>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  header: { marginBottom: spacing.xs },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  invoiceCard: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meta: { flex: 1, paddingRight: spacing.md },
  invoiceNumber: { ...typography.h3, color: colors.text },
  invoiceName: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  statusBadge: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  statusText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  detailLabel: { ...typography.caption, color: colors.textSecondary, textTransform: 'uppercase' },
  detailValue: { ...typography.body, color: colors.text },
  totalValue: { ...typography.h3, color: colors.accent },
});

export default InvoiceListScreen;
