import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Invoice } from '../../types/invoice';
import { useThemeColors } from '../../hooks/useThemeColors';
import { formatCurrency, formatDate } from '../../utils/formatting';
import { spacing, borderRadius } from '../../utils/constants';

interface InvoicePrintViewProps {
  invoice: Invoice;
  onPrint?: () => void;
}

export const InvoicePrintView: React.FC<InvoicePrintViewProps> = ({ invoice, onPrint }) => {
  const colors = useThemeColors();

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border.default }]}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.brandTitle, { color: colors.brand.primary }]}>SubTrackr</Text>
            <Text style={[styles.invoiceNumber, { color: colors.text.primary }]}>
              INVOICE: {invoice.invoiceNumber}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: colors.brand.primary + '20' }]}>
            <Text style={[styles.statusText, { color: colors.brand.primary }]}>
              {invoice.status.toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCol}>
            <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>MERCHANT / PROVIDER</Text>
            <Text style={[styles.metaValue, { color: colors.text.primary }]}>{invoice.merchantName}</Text>
            <Text style={[styles.metaSub, { color: colors.textSecondary }]}>{invoice.subscriptionName}</Text>
          </View>
          <View style={[styles.metaCol, { alignItems: 'flex-end' }]}>
            <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>INVOICE DATES</Text>
            <Text style={[styles.metaSub, { color: colors.textSecondary }]}>
              Created: {formatDate(invoice.createdAt)}
            </Text>
            <Text style={[styles.metaSub, { color: colors.textSecondary }]}>
              Due Date: {formatDate(invoice.dueDate)}
            </Text>
          </View>
        </View>

        <View style={[styles.tableHeader, { backgroundColor: colors.surfaceVariant }]}>
          <Text style={[styles.th, { flex: 2, color: colors.text.primary }]}>Description</Text>
          <Text style={[styles.th, { flex: 1, textAlign: 'center', color: colors.text.primary }]}>Qty</Text>
          <Text style={[styles.th, { flex: 1, textAlign: 'right', color: colors.text.primary }]}>Unit Price</Text>
          <Text style={[styles.th, { flex: 1, textAlign: 'right', color: colors.text.primary }]}>Total</Text>
        </View>

        {invoice.lineItems.map((item, idx) => (
          <View key={idx} style={[styles.tableRow, { borderBottomColor: colors.border.default }]}>
            <Text style={[styles.td, { flex: 2, color: colors.text.primary }]}>{item.description}</Text>
            <Text style={[styles.td, { flex: 1, textAlign: 'center', color: colors.textSecondary }]}>
              {item.quantity}
            </Text>
            <Text style={[styles.td, { flex: 1, textAlign: 'right', color: colors.textSecondary }]}>
              {formatCurrency(item.unitPrice, item.currency)}
            </Text>
            <Text style={[styles.td, { flex: 1, textAlign: 'right', color: colors.text.primary, fontWeight: '600' }]}>
              {formatCurrency(item.lineTotal, item.currency)}
            </Text>
          </View>
        ))}

        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>Subtotal:</Text>
            <Text style={[styles.totalVal, { color: colors.text.primary }]}>
              {formatCurrency(invoice.subtotal, invoice.currency)}
            </Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>Tax:</Text>
            <Text style={[styles.totalVal, { color: colors.text.primary }]}>
              {formatCurrency(invoice.tax, invoice.currency)}
            </Text>
          </View>
          <View style={[styles.totalRow, styles.grandTotalRow, { borderTopColor: colors.border.default }]}>
            <Text style={[styles.grandLabel, { color: colors.text.primary }]}>Total Due:</Text>
            <Text style={[styles.grandVal, { color: colors.brand.primary }]}>
              {formatCurrency(invoice.total, invoice.currency)}
            </Text>
          </View>
        </View>

        {invoice.notes && (
          <View style={[styles.notesBox, { backgroundColor: colors.surfaceVariant }]}>
            <Text style={[styles.notesTitle, { color: colors.text.primary }]}>Notes:</Text>
            <Text style={[styles.notesText, { color: colors.textSecondary }]}>{invoice.notes}</Text>
          </View>
        )}

        {onPrint && (
          <TouchableOpacity
            style={[styles.printButton, { backgroundColor: colors.brand.primary }]}
            onPress={onPrint}
            testID="print-invoice-button"
          >
            <Text style={styles.printButtonText}>Print / Download PDF</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md },
  card: { padding: spacing.lg, borderRadius: borderRadius.lg, borderWidth: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  brandTitle: { fontSize: 22, fontWeight: '800' },
  invoiceNumber: { fontSize: 16, fontWeight: '600', marginTop: 4 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.sm },
  statusText: { fontSize: 12, fontWeight: '700' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg },
  metaCol: { flex: 1 },
  metaLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  metaValue: { fontSize: 15, fontWeight: '600' },
  metaSub: { fontSize: 12, marginTop: 2 },
  tableHeader: { flexDirection: 'row', padding: spacing.xs, borderRadius: borderRadius.xs, marginBottom: spacing.xs },
  th: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', paddingVertical: spacing.sm, borderBottomWidth: 1 },
  td: { fontSize: 13 },
  totalsSection: { marginTop: spacing.lg, width: 220, alignSelf: 'flex-end' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { fontSize: 13 },
  totalVal: { fontSize: 13, fontWeight: '600' },
  grandTotalRow: { borderTopWidth: 1, marginTop: spacing.xs, paddingTop: spacing.xs },
  grandLabel: { fontSize: 15, fontWeight: '700' },
  grandVal: { fontSize: 16, fontWeight: '800' },
  notesBox: { marginTop: spacing.lg, padding: spacing.md, borderRadius: borderRadius.md },
  notesTitle: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  notesText: { fontSize: 12 },
  printButton: { marginTop: spacing.xl, paddingVertical: spacing.md, borderRadius: borderRadius.md, alignItems: 'center' },
  printButtonText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
});

export default InvoicePrintView;
