import React, { useState, useEffect, useCallback } from 'react';
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
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSubscriptionStore } from '../store';
import { formatCurrency } from '../utils/formatting';
import { Subscription, SubscriptionCategory } from '../types/subscription';
import { RootStackParamList } from '../navigation/types';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';

type SubscriptionDetailRouteProp = RouteProp<RootStackParamList, 'SubscriptionDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const SubscriptionDetailScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<SubscriptionDetailRouteProp>();
  const { id } = route.params;

  const {
    subscriptions,
    toggleSubscriptionStatus,
    deleteSubscription,
    updateSubscription,
    recordBillingOutcome,
  } = useSubscriptionStore();

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const found = subscriptions?.find((s) => s.id === id);
    if (found) {
      setSubscription(found);
    }
    setLoading(false);
  }, [id, subscriptions]);

  const handlePauseResume = useCallback(async () => {
    if (!subscription) return;

    try {
      await toggleSubscriptionStatus(subscription.id);
      Alert.alert(
        'Success',
        subscription.isActive ? 'Subscription paused' : 'Subscription resumed'
      );
    } catch (error) {
      Alert.alert('Error', 'Failed to update subscription status');
    }
  }, [subscription, toggleSubscriptionStatus]);

  const handleCancel = useCallback(() => {
    Alert.alert(
      'Cancel Subscription',
      'Are you sure you want to cancel this subscription? This action cannot be undone.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            if (!subscription) return;
            try {
              await deleteSubscription(subscription.id);
              Alert.alert('Success', 'Subscription cancelled', [
                { text: 'OK', onPress: () => navigation.goBack() },
              ]);
            } catch (error) {
              Alert.alert('Error', 'Failed to cancel subscription');
            }
          },
        },
      ]
    );
  }, [subscription, deleteSubscription, navigation]);

  const handleCryptoPayment = useCallback(() => {
    if (subscription) {
      navigation.navigate('CryptoPayment', { subscriptionId: subscription.id });
    }
  }, [subscription, navigation]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!subscription) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Subscription not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const getCategoryIcon = (category: SubscriptionCategory): string => {
    const icons: Record<SubscriptionCategory, string> = {
      [SubscriptionCategory.STREAMING]: '🎬',
      [SubscriptionCategory.SOFTWARE]: '💻',
      [SubscriptionCategory.GAMING]: '🎮',
      [SubscriptionCategory.PRODUCTIVITY]: '📊',
      [SubscriptionCategory.FITNESS]: '💪',
      [SubscriptionCategory.EDUCATION]: '📚',
      [SubscriptionCategory.FINANCE]: '💰',
      [SubscriptionCategory.OTHER]: '📦',
    };
    return icons[category] || '📦';
  };

  return (
    <SafeAreaView style={styles.container} testID="subscription-detail-screen">
      <ScrollView style={styles.scrollView}>
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
              <Text style={styles.subscriptionName}>{subscription.name}</Text>
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
                {formatCurrency(subscription.price, subscription.currency)}
              </Text>
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

        {/* Status Card */}
        <Card style={styles.statusCard}>
          <Text style={styles.sectionTitle}>Status</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusBadge,
                subscription.isActive ? styles.statusActive : styles.statusInactive,
              ]}>
              <Text
                testID="subscription-status-badge"
                style={[
                  styles.statusText,
                  subscription.isActive ? styles.statusTextActive : styles.statusTextInactive,
                ]}>
                {subscription.isActive ? 'Active' : 'Paused'}
              </Text>
            </View>
            {subscription.isCryptoEnabled && (
              <View style={styles.cryptoBadge}>
                <Text style={styles.cryptoText}>Crypto Enabled</Text>
              </View>
            )}
          </View>
        </Card>

        {/* Crypto Details */}
        {subscription.isCryptoEnabled && subscription.cryptoStreamId && (
          <Card style={styles.cryptoCard}>
            <Text style={styles.sectionTitle}>Crypto Stream</Text>
            <View style={styles.cryptoDetailRow}>
              <Text style={styles.cryptoLabel}>Stream ID</Text>
              <Text style={styles.cryptoValue} numberOfLines={1}>
                {subscription.cryptoStreamId}
              </Text>
            </View>
            {subscription.cryptoToken && (
              <View style={styles.cryptoDetailRow}>
                <Text style={styles.cryptoLabel}>Token</Text>
                <Text style={styles.cryptoValue}>{subscription.cryptoToken}</Text>
              </View>
            )}
            {subscription.cryptoAmount && (
              <View style={styles.cryptoDetailRow}>
                <Text style={styles.cryptoLabel}>Amount</Text>
                <Text style={styles.cryptoValue}>
                  {subscription.cryptoAmount} {subscription.cryptoToken}
                </Text>
              </View>
            )}
            <Button
              title="Make Crypto Payment"
              onPress={handleCryptoPayment}
              variant="primary"
              style={styles.paymentButton}
            />
          </Card>
        )}

        {/* Gas Tracking Section */}
        <Card style={styles.statusCard}>
          <Text style={styles.sectionTitle}>Gas Budget Tracking</Text>
          <View style={styles.priceRow}>
            <View style={styles.priceItem}>
              <Text style={styles.priceLabel}>Avg Gas Cost</Text>
              <Text style={styles.priceValue}>
                {subscription.chargeCount && subscription.chargeCount > 0
                  ? (subscription.totalGasSpent! / subscription.chargeCount).toFixed(4)
                  : '0.0000'}{' '}
                XLM
              </Text>
            </View>
            <View style={styles.priceItem}>
              <Text style={styles.priceLabel}>Total Gas Spent</Text>
              <Text style={styles.priceValue}>
                {subscription.totalGasSpent?.toFixed(4) || '0.0000'} XLM
              </Text>
            </View>
          </View>

          <View style={styles.nextBillingRow}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
              <Text style={styles.priceLabel}>Gas Budget per Charge</Text>
              <Text style={[styles.priceValue, { fontSize: 16 }]}>
                {subscription.gasBudget?.toFixed(4) || '0.0500'} XLM
              </Text>
            </View>
          </View>

          {subscription.lastGasCost &&
            subscription.chargeCount &&
            subscription.chargeCount > 1 &&
            subscription.lastGasCost >
              (subscription.totalGasSpent! / subscription.chargeCount) * 1.5 && (
              <View
                style={[
                  styles.statusBadge,
                  styles.statusInactive,
                  { marginTop: spacing.md, backgroundColor: colors.error + '20' },
                ]}>
                <Text style={[styles.statusText, { color: colors.error }]}>
                  ⚠️ Gas cost spike detected! ({subscription.lastGasCost.toFixed(4)} XLM)
                </Text>
              </View>
            )}
        </Card>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <Button
            title={subscription.isActive ? 'Pause Subscription' : 'Resume Subscription'}
            onPress={handlePauseResume}
            variant="secondary"
            style={styles.actionButton}
            testID="pause-resume-subscription-button"
          />
          <Button
            title="Cancel Subscription"
            onPress={handleCancel}
            variant="danger"
            style={styles.actionButton}
            testID="cancel-subscription-button"
          />
        </View>
      </ScrollView>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  backButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.md,
  },
  backButtonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  backIcon: {
    padding: spacing.sm,
  },
  backIconText: {
    fontSize: 24,
    color: colors.text,
  },
  title: {
    ...typography.h2,
    color: colors.text,
  },
  placeholder: {
    width: 40,
  },
  mainCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryIcon: {
    fontSize: 48,
    marginRight: spacing.md,
  },
  nameContainer: {
    flex: 1,
  },
  subscriptionName: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  categoryText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  priceCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  priceItem: {
    flex: 1,
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
  statusCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  notificationSubtext: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  simulateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  simulateLink: {
    paddingVertical: spacing.xs,
  },
  simulateLinkText: {
    ...typography.caption,
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  simulateLinkTextDanger: {
    ...typography.caption,
    color: colors.error,
    textDecorationLine: 'underline',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  statusActive: {
    backgroundColor: colors.success + '20',
  },
  statusInactive: {
    backgroundColor: colors.textSecondary + '20',
  },
  statusText: {
    ...typography.body,
    fontWeight: '600',
  },
  statusTextActive: {
    color: colors.success,
  },
  statusTextInactive: {
    color: colors.textSecondary,
  },
  cryptoBadge: {
    backgroundColor: colors.accent + '20',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  cryptoText: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '600',
  },
  cryptoCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  cryptoDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cryptoLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  cryptoValue: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
    marginLeft: spacing.md,
  },
  paymentButton: {
    marginTop: spacing.md,
  },
  actionsContainer: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  actionButton: {
    width: '100%',
  },
});

export default SubscriptionDetailScreen;
