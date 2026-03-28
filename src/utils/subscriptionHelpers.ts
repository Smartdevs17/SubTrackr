import { colors } from './constants';
import { SubscriptionCategory } from '../types/subscription';

/**
 * Returns the emoji icon for a given subscription category.
 */
export const getCategoryIcon = (category: SubscriptionCategory): string => {
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

/**
 * Returns the color for a subscription's active/paused status.
 */
export const getStatusColor = (isActive: boolean): string => {
  return isActive ? colors.success : colors.warning;
};

/**
 * Returns the color for a billing cycle badge.
 */
export const getBillingCycleColor = (billingCycle: string): string => {
  switch (billingCycle) {
    case 'yearly':
      return colors.accent;
    case 'weekly':
      return colors.secondary;
    default:
      return colors.primary;
  }
};

/**
 * Checks if a billing date is within the next 7 days (upcoming).
 */
export const isUpcomingBilling = (nextBillingDate: Date): boolean => {
  const today = new Date();
  const billingDate = new Date(nextBillingDate);
  const diffTime = billingDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 7;
};
