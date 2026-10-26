import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows } from '../../utils/constants';
import { formatCurrency, formatRelativeDate } from '../../utils/formatting';

export interface Invoice {
  id: string;
  subscriptionName: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  dueDate: Date;
  status: 'paid' | 'pending' | 'overdue' | 'failed';
  paidAt?: Date;
}

interface InvoiceListItemProps {
  invoice: Invoice;
  onPress: (invoice: Invoice) => void;
}

const areEqual = (prev: InvoiceListItemProps, next: InvoiceListItemProps): boolean => {
  const p = prev.invoice;
  const n = next.invoice;
  return (
    p.id === n.id &&
    p.amount === n.amount &&
    p.status === n.status &&
    p.dueDate === n.dueDate &&
    p.subscriptionName === n.subscriptionName &&
    p.paidAt === n.paidAt
  );
};

const getStatusColor = (status: Invoice['status']) => {
  switch (status) {
    case 'paid':
      return colors.success;
    case 'pending':
      return colors.warning;
    case 'overdue':
      return colors.error;
    case 'failed':
      return colors.error;
  }
};

const getStatusLabel = (status: Invoice['status']) => {
  switch (status) {
    case 'paid':
      return 'Paid';
    case 'pending':
      return 'Pending';
    case 'overdue':
      return 'Overdue';
    case 'failed':
      return 'Failed';
  }
};

export const InvoiceListItem = React.memo(({ invoice, onPress }: InvoiceListItemProps) => {
  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress(invoice)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${invoice.subscriptionName}, ${formatCurrency(invoice.amount, invoice.currency)}, ${getStatusLabel(invoice.status)}`}>
      <View style={styles.leftSection}>
        <Text style={styles.name} numberOfLines={1}>
          {invoice.subscriptionName}
        </Text>
        <Text style={styles.date}>Due {formatRelativeDate(new Date(invoice.dueDate))}</Text>
      </View>
      <View style={styles.rightSection}>
        <Text style={styles.amount}>{formatCurrency(invoice.amount, invoice.currency)}</Text>
        <View
          style={[styles.statusBadge, { backgroundColor: getStatusColor(invoice.status) + '20' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(invoice.status) }]}>
            {getStatusLabel(invoice.status)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}, areEqual);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  leftSection: {
    flex: 1,
    marginRight: spacing.md,
  },
  name: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  date: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  rightSection: {
    alignItems: 'flex-end',
  },
  amount: {
    ...typography.h3,
    color: colors.text,
    fontWeight: 'bold',
    marginBottom: spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  statusText: {
    ...typography.small,
    fontWeight: '600',
  },
});
