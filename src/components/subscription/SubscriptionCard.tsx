import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows } from '../../utils/constants';
import { Subscription, SubscriptionCategory } from '../../types/subscription';
import { formatCurrency, formatCategory, formatBillingCycle, formatRelativeDate } from '../../utils/formatting';

export interface SubscriptionCardProps {
  subscription: Subscription;
  onPress: (subscription: Subscription) => void;
  onToggleStatus?: (id: string) => void;
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
    [SubscriptionCategory.OTHER]: '📱',
  };
  return icons[category];
};

const getStatusColor = (isActive: boolean): string => {
  return isActive ? colors.success : colors.warning;
};

const getBillingCycleColor = (billingCycle: string): string => {
  switch (billingCycle) {
    case 'yearly':
      return colors.accent;
    case 'weekly':
      return colors.secondary;
    default:
      return colors.primary;
  }
};

export const SubscriptionCard: React.FC<SubscriptionCardProps> = ({
  subscription,
  onPress,
  onToggleStatus,
}) => {
  const handleToggleStatus = () => {
    if (onToggleStatus) {
      Alert.alert(
        subscription.isActive ? 'Pause Subscription' : 'Activate Subscription',
        `Are you sure you want to ${subscription.isActive ? 'pause' : 'activate'} ${subscription.name}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Confirm', onPress: () => onToggleStatus(subscription.id) },
        ]
      );
    }
  };

  const isUpcoming = () => {
    const today = new Date();
    const billingDate = new Date(subscription.nextBillingDate);
    const diffTime = billingDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 7;
  };

  return (
    <TouchableOpacity
      style={[styles.container, isUpcoming() && styles.upcomingContainer]}
      onPress={() => onPress(subscription)}
      activeOpacity={0.8}
    >
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>{getCategoryIcon(subscription.category)}</Text>
        </View>
        
        <View style={styles.titleContainer}>
          <Text style={styles.name} numberOfLines={1}>
            {subscription.name}
          </Text>
          <Text style={styles.category} numberOfLines={1}>
            {formatCategory(subscription.category)}
          </Text>
        </View>
        
        <View style={styles.statusContainer}>
          <View style={[styles.statusIndicator, { backgroundColor: getStatusColor(subscription.isActive) }]} />
          {subscription.isCryptoEnabled && (
            <View style={styles.cryptoBadge}>
              <Text style={styles.cryptoText}>₿</Text>
            </View>
          )}
        </View>
      </View>
      
      <View style={styles.details}>
        <View style={styles.priceContainer}>
          <Text style={styles.price}>
            {formatCurrency(subscription.price, subscription.currency)}
          </Text>
          <Text style={[styles.billingCycle, { color: getBillingCycleColor(subscription.billingCycle) }]}>
            /{formatBillingCycle(subscription.billingCycle)}
          </Text>
        </View>
        
        <View style={styles.billingInfo}>
          <Text style={styles.billingLabel}>Next billing:</Text>
          <Text style={[styles.billingDate, isUpcoming() && styles.upcomingDate]}>
            {formatRelativeDate(new Date(subscription.nextBillingDate))}
          </Text>
        </View>
      </View>
      
      {subscription.description && (
        <Text style={styles.description} numberOfLines={2}>
          {subscription.description}
        </Text>
      )}
      
      {onToggleStatus && (
        <TouchableOpacity
          style={styles.toggleButton}
          onPress={handleToggleStatus}
          activeOpacity={0.7}
        >
          <Text style={styles.toggleText}>
            {subscription.isActive ? 'Pause' : 'Activate'}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

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
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  icon: {
    fontSize: 24,
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
});
