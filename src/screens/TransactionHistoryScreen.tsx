import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useTransactionStore } from '../store/transactionStore';
import { Transaction, TransactionStatus, TransactionType } from '../types/transaction';
import { colors, spacing, typography, borderRadius } from '../utils/constants';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<TransactionStatus, string> = {
  [TransactionStatus.CONFIRMED]: colors.success,
  [TransactionStatus.PENDING]: colors.warning,
  [TransactionStatus.FAILED]: colors.error,
  [TransactionStatus.CANCELLED]: colors.textSecondary,
};

const STATUS_LABEL: Record<TransactionStatus, string> = {
  [TransactionStatus.CONFIRMED]: 'Confirmed',
  [TransactionStatus.PENDING]: 'Pending',
  [TransactionStatus.FAILED]: 'Failed',
  [TransactionStatus.CANCELLED]: 'Cancelled',
};

const TYPE_LABEL: Record<TransactionType, string> = {
  [TransactionType.FIAT]: 'Fiat',
  [TransactionType.CRYPTO]: 'Crypto',
  [TransactionType.REFUND]: 'Refund',
};

const FILTERS: Array<TransactionStatus | 'all'> = [
  'all',
  TransactionStatus.CONFIRMED,
  TransactionStatus.PENDING,
  TransactionStatus.FAILED,
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

// ─── Transaction row ──────────────────────────────────────────────────────────

interface RowProps {
  tx: Transaction;
  onPress: (tx: Transaction) => void;
}

const TransactionRow: React.FC<RowProps> = ({ tx, onPress }) => (
  <TouchableOpacity
    style={styles.row}
    onPress={() => onPress(tx)}
    accessibilityRole="button"
    accessibilityLabel={`${tx.subscriptionName} transaction, ${tx.amount} ${tx.currency}, ${STATUS_LABEL[tx.status]}`}>
    <View style={styles.rowLeft}>
      <Text style={styles.rowName} numberOfLines={1}>
        {tx.subscriptionName}
      </Text>
      <Text style={styles.rowMeta}>
        {formatDate(tx.date)} · {TYPE_LABEL[tx.type]}
      </Text>
      {tx.txHash ? <Text style={styles.rowHash}>{shortHash(tx.txHash)}</Text> : null}
    </View>
    <View style={styles.rowRight}>
      <Text style={styles.rowAmount}>
        {tx.type === TransactionType.REFUND ? '+' : '-'}
        {tx.amount.toFixed(2)} {tx.currency}
      </Text>
      <View style={[styles.badge, { backgroundColor: STATUS_COLOR[tx.status] + '22' }]}>
        <Text style={[styles.badgeText, { color: STATUS_COLOR[tx.status] }]}>
          {STATUS_LABEL[tx.status]}
        </Text>
      </View>
    </View>
  </TouchableOpacity>
);

// ─── Detail modal ─────────────────────────────────────────────────────────────

interface DetailProps {
  tx: Transaction;
  onClose: () => void;
}

const TransactionDetail: React.FC<DetailProps> = ({ tx, onClose }) => {
  const explorerLink = tx.txHash && tx.explorerUrl ? `${tx.explorerUrl}/tx/${tx.txHash}` : null;

  const openExplorer = async () => {
    if (!explorerLink) return;
    const supported = await Linking.canOpenURL(explorerLink);
    if (supported) {
      await Linking.openURL(explorerLink);
    } else {
      Alert.alert('Cannot open link', explorerLink);
    }
  };

  return (
    <View style={styles.detailOverlay}>
      <View style={styles.detailCard}>
        <View style={styles.detailHeader}>
          <Text style={styles.detailTitle}>Transaction Details</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.detailClose}>✕</Text>
          </TouchableOpacity>
        </View>

        <DetailRow label="Subscription" value={tx.subscriptionName} />
        <DetailRow label="Amount" value={`${tx.amount.toFixed(2)} ${tx.currency}`} />
        <DetailRow label="Date" value={formatDate(tx.date)} />
        <DetailRow label="Type" value={TYPE_LABEL[tx.type]} />
        <DetailRow
          label="Status"
          value={STATUS_LABEL[tx.status]}
          valueColor={STATUS_COLOR[tx.status]}
        />
        {tx.txHash ? <DetailRow label="Tx Hash" value={tx.txHash} mono /> : null}
        {tx.chainId ? <DetailRow label="Chain ID" value={String(tx.chainId)} /> : null}
        {tx.failureReason ? (
          <DetailRow label="Failure Reason" value={tx.failureReason} valueColor={colors.error} />
        ) : null}
        {tx.notes ? <DetailRow label="Notes" value={tx.notes} /> : null}

        {explorerLink ? (
          <TouchableOpacity
            style={styles.explorerBtn}
            onPress={openExplorer}
            accessibilityRole="link"
            accessibilityLabel="View on block explorer">
            <Text style={styles.explorerBtnText}>🔗 View on Block Explorer</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

interface DetailRowProps {
  label: string;
  value: string;
  valueColor?: string;
  mono?: boolean;
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value, valueColor, mono }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text
      style={[
        styles.detailValue,
        valueColor ? { color: valueColor } : null,
        mono ? styles.detailMono : null,
      ]}
      numberOfLines={mono ? 1 : undefined}
      ellipsizeMode="middle">
      {value}
    </Text>
  </View>
);

// ─── Screen ───────────────────────────────────────────────────────────────────

const TransactionHistoryScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { transactions } = useTransactionStore();
  const [activeFilter, setActiveFilter] = useState<TransactionStatus | 'all'>('all');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const filtered = useMemo(
    () =>
      activeFilter === 'all'
        ? transactions
        : transactions.filter((tx) => tx.status === activeFilter),
    [transactions, activeFilter]
  );

  const renderEmpty = () => (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>📋</Text>
      <Text style={styles.emptyTitle}>No transactions yet</Text>
      <Text style={styles.emptyBody}>
        Your payment history will appear here once you make your first transaction.
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} testID="transaction-history-screen">
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Transaction History</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Filter chips */}
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, activeFilter === f && styles.chipActive]}
            onPress={() => setActiveFilter(f)}
            accessibilityRole="radio"
            accessibilityState={{ checked: activeFilter === f }}
            accessibilityLabel={f === 'all' ? 'All transactions' : STATUS_LABEL[f]}>
            <Text style={[styles.chipText, activeFilter === f && styles.chipTextActive]}>
              {f === 'all' ? 'All' : STATUS_LABEL[f]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Count */}
      {filtered.length > 0 && (
        <Text style={styles.count}>
          {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
        </Text>
      )}

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TransactionRow tx={item} onPress={(tx) => setSelectedTx(tx)} />}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={filtered.length === 0 ? styles.listEmpty : styles.list}
        showsVerticalScrollIndicator={false}
      />

      {/* Detail overlay */}
      {selectedTx ? (
        <TransactionDetail tx={selectedTx} onClose={() => setSelectedTx(null)} />
      ) : null}
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: { padding: spacing.sm },
  backText: { ...typography.body, color: colors.primary, fontWeight: '500' },
  title: { ...typography.h2, color: colors.text, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 60 },
  filters: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: { ...typography.caption, color: colors.textSecondary },
  chipTextActive: { color: colors.text, fontWeight: '600' },
  count: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  listEmpty: { flex: 1 },
  // Row
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowLeft: { flex: 1, marginRight: spacing.md },
  rowName: { ...typography.body, color: colors.text, fontWeight: '600' },
  rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowHash: { ...typography.small, color: colors.accent, marginTop: 2, fontFamily: 'monospace' },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { ...typography.body, color: colors.text, fontWeight: '700' },
  badge: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  badgeText: { ...typography.small, fontWeight: '600' },
  // Empty
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.sm },
  emptyBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  // Detail overlay
  detailOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  detailCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  detailTitle: { ...typography.h3, color: colors.text },
  detailClose: { ...typography.h3, color: colors.textSecondary, padding: spacing.sm },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: { ...typography.body, color: colors.textSecondary, flex: 1 },
  detailValue: { ...typography.body, color: colors.text, flex: 2, textAlign: 'right' },
  detailMono: { fontFamily: 'monospace', fontSize: 12 },
  explorerBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  explorerBtnText: { ...typography.body, color: colors.text, fontWeight: '700' },
});

export default TransactionHistoryScreen;
