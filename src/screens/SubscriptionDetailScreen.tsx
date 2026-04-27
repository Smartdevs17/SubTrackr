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

import { colors, spacing, typography } from '../utils/constants';
import { useSubscriptionStore } from '../store';
import { formatCurrency } from '../utils/formatting';
import { SubscriptionCategory } from '../types/subscription';
import { RootStackParamList } from '../navigation/types';

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

  const { subscriptions, toggleSubscriptionStatus, updateSubscription } = useSubscriptionStore();

  const subscription = useMemo(() => subscriptions?.find((s) => s.id === id), [id, subscriptions]);

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

  const categoryIcon = useMemo(() => {
    if (!subscription) return '📦';
    const icons: Record<string, string> = {
      [SubscriptionCategory.STREAMING]: '🎬',
      [SubscriptionCategory.SOFTWARE]: '💻',
      [SubscriptionCategory.GAMING]: '🎮',
      [SubscriptionCategory.PRODUCTIVITY]: '📊',
      [SubscriptionCategory.FITNESS]: '💪',
      [SubscriptionCategory.EDUCATION]: '📚',
      [SubscriptionCategory.FINANCE]: '💰',
      [SubscriptionCategory.OTHER]: '📦',
    };
    return icons[subscription.category] || '📦';
  }, [subscription?.category, subscription]);

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
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <Text style={styles.backIconText}>←</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Details</Text>
            <View style={styles.placeholder} />
          </View>

          {/* Main Identity */}
          <Card style={styles.mainCard}>
            <View style={styles.nameRow}>
              <Text style={styles.categoryIconText}>{categoryIcon}</Text>
              <View style={styles.nameContainer}>
                <SharedElement id={`subscription-${subscription.id}-name`}>
                  <Text style={styles.subscriptionName}>{subscription.name}</Text>
                </SharedElement>
                <Text style={styles.categoryText}>{subscription.category}</Text>
              </View>
              <View
                style={[
                  styles.statusIndicator,
                  subscription.isActive ? styles.bgSuccess : styles.bgPaused,
                ]}
              />
            </View>
          </Card>

          {/* Billing Info */}
          <View style={styles.sectionRow}>
            <Card style={[styles.flexCard, styles.marginRight]}>
              <Text style={styles.priceLabel}>Amount</Text>
              <Text style={styles.priceValue}>
                {formatCurrency(subscription.price, subscription.currency)}
              </Text>
            </Card>
            <Card style={styles.flexCard}>
              <Text style={styles.priceLabel}>Cycle</Text>
              <Text style={styles.priceValue}>{subscription.billingCycle}</Text>
            </Card>
          </View>

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

          {/* Notifications Toggle */}
          <Card style={styles.standardCard}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>Charge Alerts</Text>
                <Text style={styles.switchSubtext}>Get notified before contract execution</Text>
              </View>
              <Switch
                value={subscription.notificationsEnabled !== false}
                onValueChange={(value) =>
                  updateSubscription(subscription.id, {
                    notificationsEnabled: value,
                  })
                }
                trackColor={{ false: colors.border, true: colors.primary }}
              />
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
  priceLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  priceValue: {
    ...typography.h3,
    color: colors.text,
    marginTop: 4,
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
