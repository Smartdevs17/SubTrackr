import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { FormScreen } from '../components/common/ScreenTemplates';
import { useCreditStore } from '../store';
import { CreditNoteService, PrepaymentWalletService } from '../services/creditService';
import { CreditNoteReason, CreditNoteStatus } from '../types/credit';

const CreditsAndPrepaymentsScreen: React.FC = () => {
  const { creditNotes, prepaymentWallets, prepaymentTransactions } = useCreditStore();
  const [issueModalVisible, setIssueModalVisible] = useState(false);
  const [depositModalVisible, setDepositModalVisible] = useState(false);
  const [selectedWalletId, setSelectedWalletId] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState(CreditNoteReason.REFUND);
  const [expiryDays, setExpiryDays] = useState('30');
  const [notes, setNotes] = useState('');

  const outstandingCredit = useMemo(
    () => creditNotes.reduce((sum, c) => sum + c.remainingAmount, 0),
    [creditNotes]
  );

  const totalPrepaid = useMemo(
    () => prepaymentWallets.reduce((sum, w) => sum + w.balance, 0),
    [prepaymentWallets]
  );

  const handleIssueCredit = () => {
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    const days = parseInt(expiryDays, 10) || 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    CreditNoteService.create({
      subscriptionId: '',
      userId: 'current-user',
      reason,
      amount: parsedAmount,
      currency: 'USD',
      expiresAt,
      notes: notes || undefined,
      priority: 0,
    });

    CreditNoteService.expireExpiredNotes();
    setIssueModalVisible(false);
    setAmount('');
    setNotes('');
    Alert.alert('Success', 'Credit note issued successfully');
  };

  const handleDeposit = () => {
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    const wallet = PrepaymentWalletService.deposit(selectedWalletId, parsedAmount);
    if (!wallet) {
      Alert.alert('Error', 'Wallet not found or invalid amount');
      return;
    }
    setDepositModalVisible(false);
    setAmount('');
    Alert.alert('Success', `Deposited ${parsedAmount} into prepayment wallet`);
  };

  const handleWithdraw = (walletId: string) => {
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }
    const wallet = PrepaymentWalletService.withdraw(walletId, parsedAmount);
    if (!wallet) {
      Alert.alert('Error', 'Insufficient balance or wallet not found');
      return;
    }
    setAmount('');
    Alert.alert('Success', `Withdrew ${parsedAmount} from prepayment wallet`);
  };

  const handleAutoApply = (subscriptionId: string) => {
    const applied = CreditNoteService.autoApplyToNextInvoice(subscriptionId);
    if (applied) {
      Alert.alert('Applied', `Applied ${applied.remainingAmount} credit to next invoice`);
    } else {
      Alert.alert('No Action', 'No eligible credits or open invoices found');
    }
  };

  const getStatusColor = (status: CreditNoteStatus): string => {
    switch (status) {
      case CreditNoteStatus.ISSUED:
        return colors.primary;
      case CreditNoteStatus.PARTIALLY_APPLIED:
        return colors.warning;
      case CreditNoteStatus.APPLIED:
        return colors.success;
      case CreditNoteStatus.EXPIRED:
        return colors.error;
      case CreditNoteStatus.VOID:
        return colors.textSecondary;
      default:
        return colors.textSecondary;
    }
  };

  return (
    <FormScreen
      title="Credits & Prepayments"
      subtitle="Manage credit notes and prepayment wallets"
      analyticsName="CreditsAndPrepayments"
      rightAction={
        <Button
          title="Issue Credit"
          size="small"
          onPress={() => setIssueModalVisible(true)}
        />
      }
      testID="credits-prepayments-screen">
      <ScrollView style={styles.scrollView}>
        <View style={styles.metricsRow}>
          <Card style={styles.metricCard}>
            <Text style={styles.metricLabel}>Outstanding Credit</Text>
            <Text style={styles.metricValue}>${outstandingCredit.toFixed(2)}</Text>
          </Card>
          <Card style={styles.metricCard}>
            <Text style={styles.metricLabel}>Prepaid Balance</Text>
            <Text style={styles.metricValue}>${totalPrepaid.toFixed(2)}</Text>
          </Card>
        </View>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Prepayment Wallets</Text>
          {prepaymentWallets.length === 0 ? (
            <Text style={styles.emptyText}>No prepayment wallets yet</Text>
          ) : (
            prepaymentWallets.map((wallet) => (
              <View key={wallet.id} style={styles.walletRow}>
                <View style={styles.walletInfo}>
                  <Text style={styles.walletName}>Subscription: {wallet.subscriptionId}</Text>
                  <Text style={styles.walletDetail}>
                    Balance: ${wallet.balance.toFixed(2)} | Deposited: ${wallet.totalDeposited.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.walletActions}>
                  <Button
                    title="Deposit"
                    size="small"
                    variant="outline"
                    onPress={() => {
                      setSelectedWalletId(wallet.id);
                      setDepositModalVisible(true);
                    }}
                  />
                  <Button
                    title="Withdraw"
                    size="small"
                    variant="outline"
                    onPress={() => handleWithdraw(wallet.id)}
                  />
                </View>
              </View>
            ))
          )}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Credit Notes</Text>
          {creditNotes.length === 0 ? (
            <Text style={styles.emptyText}>No credit notes issued</Text>
          ) : (
            creditNotes
              .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
              .map((note) => (
                <View key={note.id} style={styles.creditRow}>
                  <View style={styles.creditInfo}>
                    <Text style={styles.creditReason}>
                      {note.reason.toUpperCase()} | ${note.amount.toFixed(2)}
                    </Text>
                    <Text style={styles.creditDetail}>
                      Remaining: ${note.remainingAmount.toFixed(2)} | Expires:{' '}
                      {note.expiresAt.toLocaleDateString()}
                    </Text>
                    <Text
                      style={[
                        styles.creditStatus,
                        { color: getStatusColor(note.status) },
                      ]}>
                      {note.status.replace('_', ' ').toUpperCase()}
                    </Text>
                  </View>
                  {note.status === CreditNoteStatus.ISSUED && (
                    <Button
                      title="Auto Apply"
                      size="small"
                      variant="outline"
                      onPress={() => handleAutoApply(note.subscriptionId)}
                    />
                  )}
                </View>
              ))
          )}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          {prepaymentTransactions.length === 0 ? (
            <Text style={styles.emptyText}>No transactions yet</Text>
          ) : (
            prepaymentTransactions
              .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
              .slice(0, 20)
              .map((tx) => (
                <View key={tx.id} style={styles.txRow}>
                  <Text style={styles.txType}>{tx.type.toUpperCase()}</Text>
                  <Text style={styles.txAmount}>${tx.amount.toFixed(2)}</Text>
                  <Text style={styles.txBalance}>Balance: ${tx.balanceAfter.toFixed(2)}</Text>
                </View>
              ))
          )}
        </Card>
      </ScrollView>

      <Modal
        visible={issueModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIssueModalVisible(false)}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Issue Credit Note</Text>
          <Text style={styles.label}>Reason</Text>
          <View style={styles.reasonRow}>
            {Object.values(CreditNoteReason).map((r) => (
              <TouchableOpacity
                key={r}
                style={[
                  styles.reasonChip,
                  reason === r && styles.reasonChipSelected,
                ]}
                onPress={() => setReason(r)}>
                <Text
                  style={[
                    styles.reasonChipText,
                    reason === r && styles.reasonChipTextSelected,
                  ]}>
                  {r}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>Amount</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            keyboardType="numeric"
          />
          <Text style={styles.label}>Expiry (days)</Text>
          <TextInput
            style={styles.input}
            value={expiryDays}
            onChangeText={setExpiryDays}
            placeholder="30"
            keyboardType="numeric"
          />
          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Reason for credit note"
            multiline
          />
          <View style={styles.modalActions}>
            <Button
              title="Cancel"
              variant="outline"
              onPress={() => setIssueModalVisible(false)}
            />
            <Button title="Issue" onPress={handleIssueCredit} />
          </View>
        </View>
      </Modal>

      <Modal
        visible={depositModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDepositModalVisible(false)}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Deposit to Prepayment Wallet</Text>
          <Text style={styles.label}>Amount</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            keyboardType="numeric"
          />
          <View style={styles.modalActions}>
            <Button
              title="Cancel"
              variant="outline"
              onPress={() => setDepositModalVisible(false)}
            />
            <Button title="Deposit" onPress={handleDeposit} />
          </View>
        </View>
      </Modal>
    </FormScreen>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  metricCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  metricLabel: {
    ...typography.body2,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  metricValue: {
    ...typography.h2,
    color: colors.primary,
  },
  card: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  walletRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  walletInfo: {
    flex: 1,
  },
  walletName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  walletDetail: {
    ...typography.body2,
    color: colors.textSecondary,
  },
  walletActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  creditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  creditInfo: {
    flex: 1,
  },
  creditReason: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  creditDetail: {
    ...typography.body2,
    color: colors.textSecondary,
  },
  creditStatus: {
    ...typography.caption,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  txRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  txType: {
    ...typography.body2,
    color: colors.textSecondary,
    flex: 1,
  },
  txAmount: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
  },
  txBalance: {
    ...typography.body2,
    color: colors.textSecondary,
    flex: 1,
    textAlign: 'right',
  },
  modalContainer: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.background.primary,
  },
  modalTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.body2,
    color: colors.text,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.md,
    backgroundColor: colors.background.secondary,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  reasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  reasonChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  reasonChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '20',
  },
  reasonChipText: {
    ...typography.body2,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  reasonChipTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
});

export default CreditsAndPrepaymentsScreen;
