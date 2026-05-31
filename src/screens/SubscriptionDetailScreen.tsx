import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Switch,
  TextInput,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSubscriptionStore, useSettingsStore, useInvoiceStore, useUserStore } from '../store';
import { currencyService } from '../services/currencyService';
import { formatCurrency } from '../utils/formatting';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { getCategoryIcon } from '../utils/subscriptionHelpers';
import { RootStackParamList } from '../navigation/types';
import { CreditPaymentMethod } from '../types/credit';
import { useGroupStore } from '../store/groupStore';

// Components
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { ScreenTransition, SharedElement } from '../components/common/SharedElement';

type SubscriptionDetailRouteProp = RouteProp<RootStackParamList, 'SubscriptionDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const CREDIT_METHODS: { label: string; value: CreditPaymentMethod; hint: string }[] = [
  { label: 'Card', value: 'card', hint: 'Visa, Mastercard, or Amex' },
  { label: 'Bank', value: 'bank_transfer', hint: 'ACH or wire transfer' },
  { label: 'Wallet', value: 'wallet', hint: 'Stored wallet balance' },
  { label: 'Manual', value: 'manual', hint: 'Manual admin adjustment' },
  { label: 'Crypto', value: 'crypto', hint: 'On-chain top-up' },
];

const SubscriptionDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<SubscriptionDetailRouteProp>();
  const { id } = route.params;

  const {
    subscriptions,
    toggleSubscriptionStatus,
    updateSubscription,
    recordBillingOutcome,
    getCreditAccount,
    purchaseCredit,
    transferCredit,
    applyCreditToInvoice,
    expireCredits,
    setCreditPolicy,
  } = useSubscriptionStore();
  const { subscriptions, toggleSubscriptionStatus, updateSubscription, recordBillingOutcome } =
    useSubscriptionStore();
  const { groups } = useGroupStore();
  const { preferredCurrency, exchangeRates } = useSettingsStore();
  const { user } = useUserStore();
  const invoices = useInvoiceStore((state) => state.invoices);
  const rates = exchangeRates?.rates || {};

  const subscription = useMemo(() => subscriptions?.find((s) => s.id === id), [id, subscriptions]);
  const accountId = user?.id ?? user?.email ?? 'local-user';
  const creditAccount = useMemo(() => getCreditAccount(accountId), [accountId, getCreditAccount]);

  const [creditAmount, setCreditAmount] = useState('25');
  const [creditMethod, setCreditMethod] = useState<CreditPaymentMethod>('card');
  const [creditExpiryDays, setCreditExpiryDays] = useState(
    String(creditAccount.policy.expirationDays)
  );
  const [transferRecipient, setTransferRecipient] = useState('');
  const [transferAmount, setTransferAmount] = useState('10');
  const [creditReference, setCreditReference] = useState('');
  const subscriptionGroup = useMemo(
    () => groups.find((group) => group.groupId === subscription?.groupId),
    [groups, subscription?.groupId]
  );

  const [loading, setLoading] = useState(!subscription);

  useEffect(() => {
    if (subscription) {
      setLoading(false);
    }
  }, [subscription]);

  useEffect(() => {
    setCreditExpiryDays(String(creditAccount.policy.expirationDays));
  }, [creditAccount.policy.expirationDays]);

  const handlePauseResume = useCallback(async () => {
    if (!subscription) return;
    try {
      await toggleSubscriptionStatus(subscription.id);
      Alert.alert(
        'Status Updated',
        `Subscription is now ${!subscription.isActive ? 'active' : 'paused'}.`
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to update contract status');
    }
  }, [subscription, toggleSubscriptionStatus]);

  const handleStartCancellation = useCallback(() => {
    if (subscription) {
      navigation.navigate('CancellationFlow', {
        subscriptionId: subscription.id,
      });
    }
  }, [subscription, navigation]);

  const handleCryptoPayment = useCallback(() => {
    if (subscription) {
      navigation.navigate('CryptoPayment', {
        subscriptionId: subscription.id,
      });
    }
  }, [subscription, navigation]);

  const latestOpenInvoice = useMemo(() => {
    return invoices
      .filter((invoice) => invoice.subscriptionId === subscription?.id && invoice.status !== 'paid')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }, [invoices, subscription?.id]);

  const handlePurchaseCredit = useCallback(async () => {
    if (!subscription) return;
    const amount = Number(creditAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive credit amount.');
      return;
    }

    await purchaseCredit(
      {
        amount,
        paymentMethod: creditMethod,
        currency: subscription.currency,
        subscriptionId: subscription.id,
        reference: creditReference.trim() || `credit:${subscription.id}`,
        note: `Prepaid credit for ${subscription.name}`,
        expiresAt:
          Number(creditExpiryDays) > 0
            ? new Date(Date.now() + Number(creditExpiryDays) * 24 * 60 * 60 * 1000)
            : null,
      },
      accountId
    );

    Alert.alert('Credit purchased', 'The balance has been added and will auto-apply to invoices.');
  }, [
    accountId,
    creditAmount,
    creditExpiryDays,
    creditMethod,
    creditReference,
    purchaseCredit,
    subscription,
  ]);

  const handleApplyCredit = useCallback(async () => {
    if (!subscription || !latestOpenInvoice) {
      Alert.alert('No open invoice', 'There is no open invoice to apply credit to yet.');
      return;
    }

    await applyCreditToInvoice(latestOpenInvoice.id, subscription.id, accountId);
    Alert.alert(
      'Credit applied',
      `Applied credit to ${latestOpenInvoice.invoiceNumber}. Any remainder stays on the balance.`
    );
  }, [accountId, applyCreditToInvoice, latestOpenInvoice, subscription]);

  const handleTransferCredit = useCallback(async () => {
    const amount = Number(transferAmount);
    if (!transferRecipient.trim()) {
      Alert.alert('Missing recipient', 'Enter the recipient account or email.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive transfer amount.');
      return;
    }

    await transferCredit(
      {
        amount,
        currency: subscription?.currency,
        reference: `transfer:${subscription?.id ?? 'subscription'}`,
        note: `Transfer from ${accountId} to ${transferRecipient.trim()}`,
      },
      transferRecipient.trim(),
      accountId
    );

    Alert.alert('Credit transferred', 'The recipient balance was updated.');
  }, [
    accountId,
    subscription?.currency,
    subscription?.id,
    transferAmount,
    transferCredit,
    transferRecipient,
  ]);

  const handleExpireCredit = useCallback(async () => {
    await expireCredits(accountId);
    Alert.alert('Expiration checked', 'Expired credits were archived and notifications were sent.');
  }, [accountId, expireCredits]);

  const handleUpdatePolicy = useCallback(async () => {
    const expirationDays = Number(creditExpiryDays);
    await setCreditPolicy(
      {
        expirationDays: Number.isFinite(expirationDays) ? expirationDays : 365,
        transferable: true,
        autoApplyToUpcomingInvoices: true,
        allowPartialApplication: true,
      },
      accountId
    );
    Alert.alert('Policy updated', 'Credit expiration and application rules were saved.');
  }, [accountId, creditExpiryDays, setCreditPolicy]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!subscription) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Subscription Record Missing</Text>
          <Button title="Go Back" onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} testID="subscription-detail-screen">
      <ScreenTransition type="slide" duration={400}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backIcon}
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.backIconText}>←</Text>
            </TouchableOpacity>
            <Text style={styles.title} accessibilityRole="header">
              Subscription Details
            </Text>
            <View style={styles.placeholder} />
          </View>

          {/* Main Info Card */}
          <Card style={styles.mainCard}>
            <View style={styles.nameRow}>
              <Text style={styles.categoryIcon}>{getCategoryIcon(subscription.category)}</Text>
              <View style={styles.nameContainer}>
                <SharedElement id={`subscription-${subscription.id}-name`}>
                  <Text style={styles.subscriptionName}>{subscription.name}</Text>
                </SharedElement>
                <Text style={styles.categoryText}>
                  {subscription.category.charAt(0).toUpperCase() + subscription.category.slice(1)}
                </Text>
              </View>
            </View>

            {subscription.description && (
              <Text style={styles.description}>{subscription.description}</Text>
            )}
          </Card>

          {/* Price Card */}
          <Card style={styles.priceCard}>
            <Text style={styles.sectionTitle}>Pricing</Text>
            <View style={styles.priceRow}>
              <View style={styles.priceItem}>
                <Text style={styles.priceLabel}>Amount</Text>
                <Text style={styles.priceValue}>
                  {formatCurrency(
                    currencyService.convert(
                      subscription.price,
                      subscription.currency,
                      preferredCurrency,
                      rates
                    ),
                    preferredCurrency
                  )}
                </Text>
                {subscription.currency !== preferredCurrency && (
                  <Text style={styles.originalPriceDetail}>
                    Original: {formatCurrency(subscription.price, subscription.currency)}
                  </Text>
                )}
              </View>

              <View style={styles.priceItem}>
                <Text style={styles.priceLabel}>Billing Cycle</Text>
                <Text style={styles.priceValue} testID="subscription-billing-cycle-value">
                  {subscription.billingCycle.charAt(0).toUpperCase() +
                    subscription.billingCycle.slice(1)}
                </Text>
              </View>
            </View>
            <View style={styles.nextBillingRow}>
              <Text style={styles.priceLabel}>Next Billing Date</Text>
              <Text style={styles.nextBillingDate}>
                {new Date(subscription.nextBillingDate).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </Text>
            </View>
          </Card>

          {subscriptionGroup ? (
            <Card style={styles.standardCard}>
              <Text style={styles.sectionTitle}>Group plan</Text>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Group</Text>
                <Text style={styles.dataValue}>{subscriptionGroup.name}</Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Seats</Text>
                <Text style={styles.dataValue}>
                  {subscriptionGroup.members.length}/{subscriptionGroup.planSharingRules.seatLimit}
                </Text>
              </View>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>Billing</Text>
                <Text style={styles.dataValue}>
                  {subscriptionGroup.planSharingRules.ownerPaysForMembers
                    ? 'Consolidated'
                    : 'Member split'}
                </Text>
              </View>
            </Card>
          ) : null}

          {/* Notifications */}
          <Card style={styles.statusCard}>
            <Text style={styles.sectionTitle}>Billing notifications</Text>
            <Text style={styles.notificationSubtext}>
              Renewal reminders (1 day before, or 1 hour if due sooner) and charge alerts
            </Text>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Enabled for this subscription</Text>
              <Switch
                value={subscription.notificationsEnabled !== false}
                onValueChange={(value) =>
                  updateSubscription(subscription.id, { notificationsEnabled: value })
                }
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.text}
              />
            </View>
            <Text style={styles.simulateSectionTitle}>Test charge alerts (local only)</Text>
            <View style={styles.simulateRow}>
              <TouchableOpacity
                onPress={() => void recordBillingOutcome(subscription.id, 'success')}
                style={styles.simulateLink}
                testID="simulate-charge-success-button">
                <Text style={styles.simulateLinkText}>Simulate successful charge</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void recordBillingOutcome(subscription.id, 'failed')}
                style={styles.simulateLink}
                testID="simulate-charge-failed-button">
                <Text style={styles.simulateLinkTextDanger}>Simulate failed charge</Text>
              </TouchableOpacity>
            </View>
          </Card>

          {/* Credit Balance */}
          <Card style={styles.statusCard}>
            <Text style={styles.sectionTitle}>Credit balance</Text>
            <Text style={styles.notificationSubtext}>
              Prepay funds, apply them to invoices automatically, and keep a running ledger with
              expiry and transfer controls.
            </Text>

            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>Account</Text>
              <Text style={styles.dataValue}>{creditAccount.accountId}</Text>
            </View>
            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>Available</Text>
              <Text style={styles.dataValue}>
                {formatCurrency(creditAccount.balance, creditAccount.currency)}
              </Text>
            </View>
            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>Running total</Text>
              <Text style={styles.dataValue}>{creditAccount.runningTotal.toFixed(2)}</Text>
            </View>
            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>Next expiration</Text>
              <Text style={styles.dataValue}>
                {creditAccount.nextExpirationAt
                  ? creditAccount.nextExpirationAt.toLocaleDateString()
                  : 'No expiry set'}
              </Text>
            </View>

            <Text style={styles.inlineSectionLabel}>Purchase credits</Text>
            <View style={styles.inlineInputs}>
              <TextInput
                style={[styles.input, styles.inlineInput]}
                value={creditAmount}
                onChangeText={setCreditAmount}
                placeholder="Amount"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.input, styles.inlineInput]}
                value={creditExpiryDays}
                onChangeText={setCreditExpiryDays}
                placeholder="Expiry days"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
              />
            </View>
            <TextInput
              style={styles.input}
              value={creditReference}
              onChangeText={setCreditReference}
              placeholder="Payment reference"
              placeholderTextColor={colors.textSecondary}
            />
            <View style={styles.methodRow}>
              {CREDIT_METHODS.map((method) => {
                const active = creditMethod === method.value;
                return (
                  <TouchableOpacity
                    key={method.value}
                    style={[styles.methodPill, active && styles.methodPillActive]}
                    onPress={() => setCreditMethod(method.value)}>
                    <Text style={[styles.methodPillLabel, active && styles.methodPillLabelActive]}>
                      {method.label}
                    </Text>
                    <Text style={styles.methodPillHint}>{method.hint}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.creditActionsRow}>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => void handlePurchaseCredit()}>
                <Text style={styles.primaryButtonText}>Purchase credit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => void handleApplyCredit()}>
                <Text style={styles.secondaryButtonText}>Apply to invoice</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inlineSectionLabel}>Transfer credits</Text>
            <View style={styles.inlineInputs}>
              <TextInput
                style={[styles.input, styles.inlineInput]}
                value={transferRecipient}
                onChangeText={setTransferRecipient}
                placeholder="Recipient account"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
              />
              <TextInput
                style={[styles.input, styles.inlineInput]}
                value={transferAmount}
                onChangeText={setTransferAmount}
                placeholder="Transfer amount"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.creditActionsRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => void handleTransferCredit()}>
                <Text style={styles.secondaryButtonText}>Transfer credit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.ghostButton}
                onPress={() => void handleExpireCredit()}>
                <Text style={styles.ghostButtonText}>Expire now</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.creditActionsRow}>
              <TouchableOpacity
                style={styles.ghostButton}
                onPress={() => void handleUpdatePolicy()}>
                <Text style={styles.ghostButtonText}>Save policy</Text>
              </TouchableOpacity>
              <View style={styles.helperChip}>
                <Text style={styles.helperChipText}>
                  Auto-apply: {creditAccount.policy.autoApplyToUpcomingInvoices ? 'On' : 'Off'}
                </Text>
              </View>
            </View>

            {latestOpenInvoice && (
              <View style={styles.invoicePreview}>
                <Text style={styles.inlineSectionLabel}>Next open invoice</Text>
                <Text style={styles.invoicePreviewTitle}>{latestOpenInvoice.invoiceNumber}</Text>
                <Text style={styles.invoicePreviewBody}>
                  {formatCurrency(latestOpenInvoice.total, latestOpenInvoice.currency)} due on{' '}
                  {latestOpenInvoice.dueDate.toLocaleDateString()}
                </Text>
              </View>
            )}

            <Text style={styles.inlineSectionLabel}>Ledger history</Text>
            {creditAccount.ledger.length > 0 ? (
              creditAccount.ledger
                .slice()
                .reverse()
                .slice(0, 6)
                .map((entry) => (
                  <View key={entry.id} style={styles.ledgerRow}>
                    <View style={styles.ledgerRowHeader}>
                      <Text style={styles.ledgerType}>{entry.type.replace('_', ' ')}</Text>
                      <Text style={styles.ledgerAmount}>
                        {entry.amount >= 0 ? '+' : ''}
                        {formatCurrency(Math.abs(entry.amount), entry.currency)}
                      </Text>
                    </View>
                    <Text style={styles.ledgerMeta}>
                      Balance {formatCurrency(entry.balanceAfter, entry.currency)} ·{' '}
                      {new Date(entry.createdAt).toLocaleString()}
                    </Text>
                    {entry.reference && (
                      <Text style={styles.ledgerMeta}>Ref {entry.reference}</Text>
                    )}
                  </View>
                ))
            ) : (
              <Text style={styles.emptyNote}>No credit ledger entries yet.</Text>
            )}

            <Text style={styles.inlineSectionLabel}>Invoice applications</Text>
            {creditAccount.applications.length > 0 ? (
              creditAccount.applications
                .slice()
                .reverse()
                .slice(0, 4)
                .map((application) => (
                  <View key={application.id} style={styles.applicationRow}>
                    <Text style={styles.ledgerType}>
                      {application.invoiceId} · {application.status}
                    </Text>
                    <Text style={styles.ledgerMeta}>
                      Applied {formatCurrency(application.appliedAmount, creditAccount.currency)} of{' '}
                      {formatCurrency(application.invoiceTotal, creditAccount.currency)}
                    </Text>
                    <Text style={styles.ledgerMeta}>
                      Remaining {formatCurrency(application.remainingDue, creditAccount.currency)} ·{' '}
                      {new Date(application.createdAt).toLocaleString()}
                    </Text>
                  </View>
                ))
            ) : (
              <Text style={styles.emptyNote}>No invoice applications yet.</Text>
            )}
          </Card>

          {/* Gas & Network Status (Stellar/Soroban specific) */}
          <Card style={styles.standardCard}>
            <Text style={styles.sectionTitle}>Network & Gas</Text>
            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>Gas Budget</Text>
              <Text style={styles.dataValue}>
                {subscription.gasBudget?.toFixed(4) || '0.0500'} XLM
              </Text>
            </View>
            <View style={styles.dataRow}>
              <Text style={styles.dataLabel}>Total Spent</Text>
              <Text style={styles.dataValue}>
                {subscription.totalGasSpent?.toFixed(4) || '0.0000'} XLM
              </Text>
            </View>
          </Card>

          {/* Action Management */}
          <View style={styles.actionsContainer}>
            <Text style={styles.actionSectionTitle}>Subscription Management</Text>

            {subscription.isCryptoEnabled && (
              <Button
                title="Crypto Payment"
                onPress={handleCryptoPayment}
                variant="primary"
                style={styles.actionButton}
              />
            )}

            <Button
              title={subscription.isActive ? 'Pause Subscription' : 'Resume Subscription'}
              onPress={handlePauseResume}
              variant="secondary"
              style={styles.actionButton}
              testID="pause-resume-subscription-button"
            />

            <Button
              title="Cancel Subscription"
              variant="danger"
              onPress={handleStartCancellation}
              style={styles.cancelButton}
              testID="cancel-subscription-button"
            />
          </View>
        </ScrollView>
      </ScreenTransition>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  backButton: {
    padding: spacing.sm,
  },
  backIconText: {
    fontSize: 24,
    color: colors.text,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  placeholder: {
    width: 40,
  },
  backIcon: {
    padding: spacing.sm,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
  categoryIcon: {
    fontSize: 32,
    marginRight: spacing.md,
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  priceCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.lg,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  priceItem: {
    flex: 1,
  },
  statusCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.lg,
  },
  notificationSubtext: {
    ...typography.body2,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  switchLabel: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    marginRight: spacing.md,
  },
  simulateSectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  simulateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  simulateLink: {
    paddingVertical: spacing.sm,
  },
  simulateLinkText: {
    ...typography.body,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  simulateLinkTextDanger: {
    ...typography.body,
    color: colors.error,
    textDecorationLine: 'underline',
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    marginTop: spacing.sm,
  },
  inlineInputs: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inlineInput: {
    flex: 1,
  },
  inlineSectionLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  methodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  methodPill: {
    flexGrow: 1,
    minWidth: '30%',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  methodPillActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(6, 182, 212, 0.14)',
  },
  methodPillLabel: {
    ...typography.body2,
    color: colors.text,
    fontWeight: '700',
  },
  methodPillLabelActive: {
    color: colors.accent,
  },
  methodPillHint: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: 2,
  },
  creditActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minWidth: 150,
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typography.button,
    color: colors.onPrimary,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minWidth: 150,
    alignItems: 'center',
  },
  secondaryButtonText: {
    ...typography.button,
    color: colors.onSecondary,
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minWidth: 150,
    alignItems: 'center',
  },
  ghostButtonText: {
    ...typography.button,
    color: colors.text,
  },
  helperChip: {
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignSelf: 'center',
  },
  helperChipText: {
    ...typography.small,
    color: colors.textSecondary,
  },
  invoicePreview: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  invoicePreviewTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  invoicePreviewBody: {
    ...typography.body2,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  emptyNote: {
    ...typography.body2,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  ledgerRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  ledgerRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ledgerType: {
    ...typography.body2,
    color: colors.text,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  ledgerAmount: {
    ...typography.body2,
    color: colors.accent,
    fontWeight: '700',
  },
  ledgerMeta: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: 2,
  },
  applicationRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  mainCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.lg,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryIconText: {
    fontSize: 40,
    marginRight: spacing.md,
  },
  nameContainer: {
    flex: 1,
  },
  subscriptionName: {
    ...typography.h2,
    color: colors.text,
  },
  categoryText: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  bgSuccess: {
    backgroundColor: colors.success,
  },
  bgPaused: {
    backgroundColor: colors.warning,
  },
  sectionRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  flexCard: {
    flex: 1,
    padding: spacing.md,
    alignItems: 'center',
  },
  priceLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  priceValue: {
    ...typography.h3,
    color: colors.text,
  },
  originalPriceDetail: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  nextBillingRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  nextBillingDate: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  marginRight: {
    marginRight: spacing.sm,
  },
  standardCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    fontWeight: 'bold',
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  dataLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  dataValue: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchTitle: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  switchSubtext: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actionsContainer: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  actionSectionTitle: {
    ...typography.h3,
    marginBottom: spacing.md,
    color: colors.text,
  },
  actionButton: {
    marginBottom: spacing.sm,
  },
  cancelButton: {
    marginTop: spacing.md,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorText: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.lg,
  },
});

export default SubscriptionDetailScreen;
