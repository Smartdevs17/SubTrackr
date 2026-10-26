import React, { useCallback, useMemo } from 'react';
import {
  FlatList,
  RefreshControl,
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import useRefresh from '../hooks/useRefresh';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInvoiceStore } from '../store';
import { spacing, typography, borderRadius, colors as baseColors } from '../utils/constants';
import { formatCurrency, formatDate } from '../utils/formatting';
import { InvoiceStatus, Invoice } from '../types/invoice';
import { RootStackParamList } from '../navigation/types';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { useThemeColors } from '../hooks/useThemeColors';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const statusLabel: Record<InvoiceStatus, string> = {
  [InvoiceStatus.DRAFT]: 'Draft',
  [InvoiceStatus.SENT]: 'Sent',
  [InvoiceStatus.PARTIAL]: 'Partial',
  [InvoiceStatus.PAID]: 'Paid',
  [InvoiceStatus.VOID]: 'Void',
  [InvoiceStatus.PENDING]: 'Pending',
  [InvoiceStatus.OVERDUE]: 'Overdue',
  [InvoiceStatus.CANCELLED]: 'Cancelled',
  [InvoiceStatus.REFUNDED]: 'Refunded',
};

const statusColors: Record<InvoiceStatus, string> = {
  [InvoiceStatus.DRAFT]: baseColors.textSecondary,
  [InvoiceStatus.SENT]: baseColors.primary,
  [InvoiceStatus.PARTIAL]: baseColors.warning,
  [InvoiceStatus.PAID]: baseColors.success,
  [InvoiceStatus.VOID]: baseColors.error,
  [InvoiceStatus.PENDING]: baseColors.warning,
  [InvoiceStatus.OVERDUE]: baseColors.error,
  [InvoiceStatus.CANCELLED]: baseColors.textSecondary,
  [InvoiceStatus.REFUNDED]: baseColors.primary,
};

interface InvoiceRowProps {
  invoice: Invoice;
  onPress: (invoice: Invoice) => void;
}

/**
 * One invoice row. Kept outside the screen component and memoised so the
 * virtualised list does not re-render every row when unrelated state changes.
 */
const InvoiceRow = React.memo(
  function InvoiceRow({ invoice, onPress }: InvoiceRowProps) {
    const handlePress = useCallback(() => onPress(invoice), [onPress, invoice]);

    return (
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.85}
        testID={`invoice-row-${invoice.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Invoice ${invoice.invoiceNumber} from ${invoice.subscriptionName}, total ${formatCurrency(invoice.total, invoice.currency)}, ${statusLabel[invoice.status]}`}
        accessibilityHint="Opens the invoice detail">
        <Card style={rowStyles.invoiceCard}>
          <View style={rowStyles.row}>
            <View style={rowStyles.meta}>
              <Text style={rowStyles.invoiceNumber}>{invoice.invoiceNumber}</Text>
              <Text style={rowStyles.invoiceName}>{invoice.subscriptionName}</Text>
            </View>
            <View
              style={[rowStyles.statusBadge, { backgroundColor: statusColors[invoice.status] }]}>
              <Text style={rowStyles.statusText}>{statusLabel[invoice.status]}</Text>
            </View>
          </View>

          <View style={rowStyles.detailsRow}>
            <Text style={rowStyles.detailLabel}>Total</Text>
            <Text style={rowStyles.totalValue}>
              {formatCurrency(invoice.total, invoice.currency)}
            </Text>
          </View>
          <View style={rowStyles.detailsRow}>
            <Text style={rowStyles.detailLabel}>Due</Text>
            <Text style={rowStyles.detailValue}>{formatDate(invoice.dueDate)}</Text>
          </View>
        </Card>
      </TouchableOpacity>
    );
  },
  (prev, next) => prev.invoice === next.invoice && prev.onPress === next.onPress
);

const InvoiceListScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const colors = useThemeColors();
  const invoices = useInvoiceStore((state) => state.invoices);
  const styles = useMemo(() => createStyles(colors), [colors]);

  const sortedInvoices = useMemo(
    () => [...invoices].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [invoices]
  );

  const { refreshing, refresh } = useRefresh();

  const onRefresh = async () => {
    await refresh({
      clearBefore: () => {
        useInvoiceStore.setState({ invoices: [] });
      },
      fetcher: async () => {
        // invoiceStore has no remote fetcher in this build; keep UX smooth
        await new Promise((r) => setTimeout(r, 350));
      },
    });
  };

  const handleInvoicePress = useCallback(
    (invoice: Invoice) => navigation.navigate('InvoiceDetail', { id: invoice.id }),
    [navigation]
  );

  const keyExtractor = useCallback((item: Invoice) => item.id, []);
  const renderItem = useCallback(
    ({ item }: { item: Invoice }) => <InvoiceRow invoice={item} onPress={handleInvoicePress} />,
    [handleInvoicePress]
  );

  const ListHeader = (
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header">
        Invoices
      </Text>
      <Text style={styles.subtitle}>Track generated billing records and delivery status.</Text>
    </View>
  );

  const ListEmpty = (
    <EmptyState
      title="No invoices yet"
      message="Invoices are created automatically after successful billing events."
      icon="🧾"
    />
  );

  return (
    <SafeAreaView
      style={styles.container}
      testID="invoice-list-screen"
      accessibilityLabel="Invoice list screen">
      <FlatList
        data={sortedInvoices}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={styles.content}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
    </SafeAreaView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    content: { padding: spacing.lg, gap: spacing.md },
    header: { marginBottom: spacing.xs },
    title: { ...typography.h1, color: colors.textPrimary },
    subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  });
}

const rowStyles = StyleSheet.create({
  invoiceCard: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meta: { flex: 1, paddingRight: spacing.md },
  invoiceNumber: { ...typography.h3, color: baseColors.text },
  invoiceName: { ...typography.body, color: baseColors.textSecondary, marginTop: 2 },
  statusBadge: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  statusText: { ...typography.caption, color: baseColors.text, fontWeight: '700' },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  detailLabel: {
    ...typography.caption,
    color: baseColors.textSecondary,
    textTransform: 'uppercase',
  },
  detailValue: { ...typography.body, color: baseColors.text },
  totalValue: { ...typography.h3, color: baseColors.accent },
});

export default InvoiceListScreen;
