import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useInvoiceStore } from '../store';
import { formatCurrency, formatDate } from '../utils/formatting';
import { RootStackParamList } from '../navigation/types';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { generateInvoicePdfPreview } from '../utils/invoice';

type RoutePropType = RouteProp<RootStackParamList, 'InvoiceDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const InvoiceDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RoutePropType>();
  const invoice = useInvoiceStore((state) => state.invoices.find((entry) => entry.id === route.params.id));
  const sendInvoice = useInvoiceStore((state) => state.sendInvoice);
  const voidInvoice = useInvoiceStore((state) => state.voidInvoice);
  const markInvoicePaid = useInvoiceStore((state) => state.markInvoicePaid);

  const preview = useMemo(() => (invoice ? generateInvoicePdfPreview(invoice) : ''), [invoice]);

  if (!invoice) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Invoice not found</Text>
          <Button title="Go back" onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  const handleEmail = async () => {
    const recipient = invoice.recipientEmail ?? '';
    if (!recipient) {
      Alert.alert('Missing recipient', 'This invoice does not have a recipient email yet.');
      return;
    }

    const subject = encodeURIComponent(`Invoice ${invoice.invoiceNumber}`);
    const body = encodeURIComponent(
      `Invoice ${invoice.invoiceNumber}\nTotal: ${formatCurrency(invoice.total, invoice.currency)}\nDue: ${formatDate(invoice.dueDate)}`
    );
    const url = `mailto:${recipient}?subject=${subject}&body=${body}`;
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert('Email unavailable', 'No email client is configured on this device.');
      return;
    }

    await sendInvoice(invoice.id, recipient);
    await Linking.openURL(url);
  };

  return (
    <SafeAreaView style={styles.container} testID="invoice-detail-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{invoice.invoiceNumber}</Text>
            <Text style={styles.subtitle}>{invoice.subscriptionName}</Text>
          </View>
        </View>

        <Card style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Status</Text>
            <Text style={styles.summaryValue}>{invoice.status.toUpperCase()}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Due date</Text>
            <Text style={styles.summaryValue}>{formatDate(invoice.dueDate)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total</Text>
            <Text style={styles.totalValue}>
              {formatCurrency(invoice.total, invoice.currency)}
            </Text>
          </View>
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Line items</Text>
          {invoice.lineItems.map((item) => (
            <View key={`${item.description}-${item.unitPrice}`} style={styles.lineItem}>
              <View style={styles.lineItemCopy}>
                <Text style={styles.lineItemTitle}>{item.description}</Text>
                <Text style={styles.lineItemSubtext}>
                  Qty {item.quantity} · Tax {item.taxRateBps / 100}% · FX {item.exchangeRate}
                </Text>
              </View>
              <Text style={styles.lineItemTotal}>
                {formatCurrency(item.lineTotal, item.currency)}
              </Text>
            </View>
          ))}
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Subtotal</Text>
            <Text style={styles.breakdownValue}>
              {formatCurrency(invoice.subtotal, invoice.currency)}
            </Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Tax</Text>
            <Text style={styles.breakdownValue}>{formatCurrency(invoice.tax, invoice.currency)}</Text>
          </View>
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Delivery</Text>
          <Text style={styles.deliveryText}>
            Recipient: {invoice.recipientEmail ?? 'Not set'}
          </Text>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionButton} onPress={handleEmail}>
              <Text style={styles.actionButtonText}>Email invoice</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void markInvoicePaid(invoice.id)}>
              <Text style={styles.secondaryButtonText}>Mark paid</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void voidInvoice(invoice.id)}>
              <Text style={styles.secondaryButtonTextDanger}>Void invoice</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() =>
                Alert.alert('PDF preview', preview, [{ text: 'Close', style: 'cancel' }])
              }>
              <Text style={styles.secondaryButtonText}>Preview PDF</Text>
            </TouchableOpacity>
          </View>
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Accounting details</Text>
          <Text style={styles.metaText}>Region: {invoice.region}</Text>
          <Text style={styles.metaText}>Period start: {formatDate(invoice.period.start)}</Text>
          <Text style={styles.metaText}>Period end: {formatDate(invoice.period.end)}</Text>
          <Text style={styles.metaText}>Created: {formatDate(invoice.createdAt)}</Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  backButtonText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  headerCopy: { flex: 1 },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  summaryCard: { gap: spacing.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { ...typography.body, color: colors.textSecondary },
  summaryValue: { ...typography.body, color: colors.text, fontWeight: '700' },
  totalValue: { ...typography.h2, color: colors.accent },
  sectionCard: { gap: spacing.sm },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.xs },
  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
  },
  lineItemCopy: { flex: 1, paddingRight: spacing.md },
  lineItemTitle: { ...typography.body, color: colors.text },
  lineItemSubtext: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  lineItemTotal: { ...typography.body, color: colors.text, fontWeight: '700' },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  breakdownLabel: { ...typography.body, color: colors.textSecondary },
  breakdownValue: { ...typography.body, color: colors.text },
  deliveryText: { ...typography.body, color: colors.textSecondary },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionButton: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  actionButtonText: { ...typography.body, color: colors.text, fontWeight: '700' },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { ...typography.body, color: colors.text, fontWeight: '700' },
  secondaryButtonTextDanger: { ...typography.body, color: colors.error, fontWeight: '700' },
  metaText: { ...typography.body, color: colors.textSecondary },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { ...typography.h2, color: colors.text, marginBottom: spacing.md },
});

export default InvoiceDetailScreen;
