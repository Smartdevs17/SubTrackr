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
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSubscriptionStore, useSettingsStore } from '../store';
import { currencyService } from '../services/currencyService';
import { formatCurrency } from '../utils/formatting';
import { colors, spacing, typography } from '../utils/constants';
import { getCategoryIcon } from '../utils/subscriptionHelpers';
import { RootStackParamList } from '../navigation/types';
import { useGroupStore } from '../store/groupStore';

// Components
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { ScreenTransition, SharedElement } from '../components/common/SharedElement';

type SubscriptionDetailRouteProp = RouteProp<RootStackParamList, 'SubscriptionDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const SubscriptionDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<SubscriptionDetailRouteProp>();
  const { id } = route.params;

  const { subscriptions, toggleSubscriptionStatus, updateSubscription, recordBillingOutcome } =
    useSubscriptionStore();
  const { groups } = useGroupStore();
  const { preferredCurrency, exchangeRates } = useSettingsStore();
  const rates = exchangeRates?.rates || {};

  const subscription = useMemo(() => subscriptions?.find((s) => s.id === id), [id, subscriptions]);
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
    <SafeAreaView style={styles.container}>
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
            />

            <Button
              title="Cancel Subscription"
              variant="danger"
              onPress={handleStartCancellation}
              style={styles.cancelButton}
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
