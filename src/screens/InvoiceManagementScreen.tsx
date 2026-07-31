import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useInvoiceStore } from '../store/invoiceStore';
import type { Invoice, InvoiceStatus } from '../types/invoice';
import { useTheme } from '../theme/useTheme';

export default function InvoiceManagementScreen({ navigation }: any) {
  const { theme } = useTheme();
  const { invoices, isLoading, error, loadInvoices, deleteInvoice, generatePDF } = useInvoiceStore();
  const [filterStatus, setFilterStatus] = useState<InvoiceStatus | 'all'>('all');

  useEffect(() => {
    loadInvoices();
  }, []);

  const filteredInvoices = invoices.filter(
    inv => filterStatus === 'all' || inv.status === filterStatus
  );

  const handleDeleteInvoice = (id: string) => {
    Alert.alert(
      'Delete Invoice',
      'Are you sure you want to delete this invoice?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteInvoice(id);
              Alert.alert('Success', 'Invoice deleted successfully');
            } catch (err) {
              Alert.alert('Error', 'Failed to delete invoice');
            }
          },
        },
      ]
    );
  };

  const handleGeneratePDF = async (invoiceId: string) => {
    try {
      const pdfUrl = await generatePDF({ invoiceId });
      Alert.alert('Success', `PDF generated: ${pdfUrl}`);
    } catch (err) {
      Alert.alert('Error', 'Failed to generate PDF');
    }
  };

  const getStatusColor = (status: InvoiceStatus) => {
    switch (status) {
      case 'paid':
        return '#10B981';
      case 'pending':
        return '#F59E0B';
      case 'overdue':
        return '#EF4444';
      case 'cancelled':
        return '#6B7280';
      case 'draft':
        return '#3B82F6';
      default:
        return theme.colors.text;
    }
  };

  const renderInvoiceItem = ({ item }: { item: Invoice }) => (
    <TouchableOpacity
      style={[styles.invoiceCard, { backgroundColor: theme.colors.card }]}
      onPress={() => navigation.navigate('InvoiceDetail', { invoiceId: item.id })}
    >
      <View style={styles.invoiceHeader}>
        <Text style={[styles.invoiceNumber, { color: theme.colors.text }]}>
          {item.invoiceNumber}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
            {item.status.toUpperCase()}
          </Text>
        </View>
      </View>

      <Text style={[styles.subscriptionName, { color: theme.colors.text }]}>
        {item.subscriptionName}
      </Text>

      <View style={styles.invoiceDetails}>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>Amount:</Text>
          <Text style={[styles.detailValue, { color: theme.colors.text }]}>
            {item.currency} {item.totalAmount.toFixed(2)}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: theme.colors.textSecondary }]}>Due Date:</Text>
          <Text style={[styles.detailValue, { color: theme.colors.text }]}>
            {item.dueDate.toLocaleDateString()}
          </Text>
        </View>
      </View>

      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: theme.colors.primary }]}
          onPress={() => handleGeneratePDF(item.id)}
        >
          <Text style={styles.actionButtonText}>Generate PDF</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.deleteButton]}
          onPress={() => handleDeleteInvoice(item.id)}
        >
          <Text style={styles.actionButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const renderFilterButtons = () => {
    const filters: Array<InvoiceStatus | 'all'> = ['all', 'draft', 'pending', 'paid', 'overdue'];
    return (
      <View style={styles.filterContainer}>
        {filters.map(filter => (
          <TouchableOpacity
            key={filter}
            style={[
              styles.filterButton,
              { backgroundColor: theme.colors.card },
              filterStatus === filter && { backgroundColor: theme.colors.primary },
            ]}
            onPress={() => setFilterStatus(filter)}
          >
            <Text
              style={[
                styles.filterButtonText,
                { color: theme.colors.text },
                filterStatus === filter && { color: '#FFFFFF' },
              ]}
            >
              {filter.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  if (isLoading && invoices.length === 0) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.colors.background }]}>
        <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {renderFilterButtons()}

      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Invoices ({filteredInvoices.length})
        </Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: theme.colors.primary }]}
          onPress={() => navigation.navigate('CreateInvoice')}
        >
          <Text style={styles.addButtonText}>+ New Invoice</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredInvoices}
        renderItem={renderInvoiceItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
              No invoices found
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterContainer: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  filterButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  listContainer: {
    padding: 16,
  },
  invoiceCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  invoiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  invoiceNumber: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  subscriptionName: {
    fontSize: 16,
    marginBottom: 12,
  },
  invoiceDetails: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailLabel: {
    fontSize: 14,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  deleteButton: {
    backgroundColor: '#EF4444',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  emptyText: {
    fontSize: 16,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
  },
});
