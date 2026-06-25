import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows } from '../../utils/constants';
import { Subscription } from '../../types/subscription';
import {
  formatCurrency,
  formatCategory,
  formatBillingCycle,
  formatRelativeDate,
} from '../../utils/formatting';
import {
  getCategoryIcon,
  getStatusColor,
  getBillingCycleColor,
  isUpcomingBilling,
} from '../../utils/subscriptionHelpers';
import { useSettingsStore } from '../../store/settingsStore';
import { currencyService } from '../../services/currencyService';
import { SubscriptionIcon } from './SubscriptionIcon';
import { useAccessibilityAnnouncement } from '../../hooks/useAccessibilityAnnouncement';

export interface SubscriptionCardProps {
  subscription: Subscription;
  onPress: (subscription: Subscription) => void;
  onToggleStatus?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export const SubscriptionCard: React.FC<SubscriptionCardProps> = React.memo(
  ({ subscription, onPress, onToggleStatus, onDelete }) => {
    const { announce } = useAccessibilityAnnouncement();

    const handleToggleStatus = () => {
      if (onToggleStatus) {
        const newStatus = subscription.isActive ? 'paused' : 'activated';
        announce(`${subscription.name} has been ${newStatus}`);
        
        Alert.alert(
          subscription.isActive ? 'Pause Subscription' : 'Activate Subscription',
          `Are you sure you want to ${subscription.isActive ? 'pause' : 'activate'} ${subscription.name}?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Confirm', 
              onPress: () => {
                onToggleStatus(subscription.id);
                announce(`${subscription.name} ${newStatus} successfully`);
              }
            },
          ]
        );
      }
    };

    const handleDelete = () => {
      if (onDelete) {
        const cryptoWarning = subscription.isCryptoEnabled
          ? '\n\nThis subscription has an active crypto stream. On-chain cancellation cannot be undone.'
          : '';
        announce(`Deleting ${subscription.name}`);
        
        Alert.alert(
          'Delete Subscription',
          `Remove "${subscription.name}" from your subscriptions?${cryptoWarning}`,
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Delete', 
              style: 'destructive', 
              onPress: () => {
                onDelete(subscription.id);
                announce(`${subscription.name} deleted successfully`);
              }
            },
          ]
        );
      }
    };

    const upcoming = isUpcomingBilling(subscription.nextBillingDate);
    const { preferredCurrency, exchangeRates } = useSettingsStore();
    const rates = exchangeRates?.rates || {};

    const convertedPrice = currencyService.convert(
      subscription.price,
      subscription.currency,
      preferredCurrency,
      rates
    );

    return (
      <TouchableOpacity
        testID={`subscription-card-${subscription.id}`}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`${subscription.name}, ${formatCurrency(
          subscription.price,
          subscription.currency
        )} per ${formatBillingCycle(subscription.billingCycle)}, ${
          subscription.isActive ? 'Active' : 'Paused'
        }`}
        style={[styles.container, upcoming && styles.upcomingContainer]}
        onPress={() => onPress(subscription)}
        activeOpacity={0.8}>
        <View style={styles.header}>
          <View style={styles.iconContainer}>
            <SubscriptionIcon
              iconUrl={subscription.iconUrl}
              fallbackIcon={getCategoryIcon(subscription.category)}
              size={48}
              accessibilityLabel={`${subscription.name} icon`}
            />
          </View>

          <View style={styles.titleContainer}>
            <Text
              testID={`subscription-name-${subscription.id}`}
              style={styles.name}
              numberOfLines={1}
              maxFontSizeMultiplier={1.5}
              allowFontScaling={true}>
              {subscription.name}
            </Text>
            <Text 
              style={styles.category} 
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              allowFontScaling={true}>
              {formatCategory(subscription.category)}
            </Text>
          </View>

          <View
            accessible={true}
            accessibilityLabel={
              subscription.isActive ? 'Subscription active' : 'Subscription paused'
            }
            style={styles.statusContainer}>
            <View
              style={[
                styles.statusIndicator,
                { backgroundColor: getStatusColor(subscription.isActive) },
              ]}
            />
            {subscription.isCryptoEnabled && (
              <View style={styles.cryptoBadge}>
                <Text style={styles.cryptoText}>₿</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.details}>
          <View
            accessible={true}
            accessibilityLabel={`Price ${formatCurrency(
              convertedPrice,
              preferredCurrency
            )} per ${formatBillingCycle(subscription.billingCycle)}`}
            style={styles.priceContainer}>
            <Text 
              style={styles.price}
              maxFontSizeMultiplier={1.5}
              allowFontScaling={true}>
              {formatCurrency(convertedPrice, preferredCurrency)}
            </Text>
            {subscription.currency !== preferredCurrency && (
              <Text 
                style={styles.originalPrice}
                maxFontSizeMultiplier={1.2}
                allowFontScaling={true}>
                ({formatCurrency(subscription.price, subscription.currency)})
              </Text>
            )}
            <Text
              style={[
                styles.billingCycle,
                { color: getBillingCycleColor(subscription.billingCycle) },
              ]}
              maxFontSizeMultiplier={1.3}
              allowFontScaling={true}>
              /{formatBillingCycle(subscription.billingCycle)}
            </Text>
          </View>

          <View style={styles.billingInfo}>
            <Text 
              style={styles.billingLabel}
              maxFontSizeMultiplier={1.2}
              allowFontScaling={true}>
              Next billing:
            </Text>
            <Text
              style={[styles.billingDate, upcoming && styles.upcomingDate]}
              accessibilityLabel={`Next billing date ${formatRelativeDate(
                new Date(subscription.nextBillingDate)
              )}`}
              maxFontSizeMultiplier={1.3}
              allowFontScaling={true}>
              {formatRelativeDate(new Date(subscription.nextBillingDate))}
            </Text>
          </View>
        </View>

        {subscription.description && (
          <Text style={styles.description} numberOfLines={2}>
            {subscription.description}
          </Text>
        )}

        <View style={styles.actionsRow}>
          {onToggleStatus && (
            <TouchableOpacity
              style={styles.toggleButton}
              onPress={handleToggleStatus}
              activeOpacity={0.7}
              testID={`subscription-toggle-${subscription.id}`}
              accessibilityRole="button"
              accessibilityLabel={
                subscription.isActive
                  ? `Pause ${subscription.name}`
                  : `Activate ${subscription.name}`
              }>
              <Text style={styles.toggleText}>{subscription.isActive ? 'Pause' : 'Activate'}</Text>
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={handleDelete}
              activeOpacity={0.7}
              testID={`subscription-delete-${subscription.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${subscription.name}`}>
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  upcomingContainer: {
    borderColor: colors.accent,
    borderWidth: 2,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  iconContainer: {
    marginRight: spacing.md,
  },
  titleContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  name: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  category: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  statusContainer: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: borderRadius.full,
  },
  cryptoBadge: {
    backgroundColor: colors.accent,
    borderRadius: borderRadius.full,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cryptoText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  details: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: spacing.sm,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  price: {
    ...typography.h2,
    color: colors.text,
    fontWeight: 'bold',
  },
  originalPrice: {
    ...typography.caption,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
    alignSelf: 'center',
  },
  billingCycle: {
    ...typography.body,
    marginLeft: spacing.xs,
  },

  billingInfo: {
    alignItems: 'flex-end',
  },
  billingLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  billingDate: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
  },
  upcomingDate: {
    color: colors.accent,
    fontWeight: 'bold',
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  toggleButton: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '500',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  deleteButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  deleteText: {
    ...typography.caption,
    color: colors.error,
    fontWeight: '500',
  },
});
