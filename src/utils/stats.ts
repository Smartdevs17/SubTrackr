import {
  BillingCycle,
  Subscription,
  SubscriptionCategory,
  SubscriptionStats,
} from '../types/subscription';
import { BILLING_CONVERSIONS } from './constants/values';

type PriceConverter = (amount: number, currency: string) => number;

const identityConverter: PriceConverter = (amount) => amount;

export const emptySubscriptionStats = (): SubscriptionStats => ({
  totalActive: 0,
  totalMonthlySpend: 0,
  totalYearlySpend: 0,
  categoryBreakdown: {} as Record<SubscriptionCategory, number>,
  totalGasSpent: 0,
});

export const getMonthlySubscriptionSpend = (
  subscription: Subscription,
  convertPrice: PriceConverter = identityConverter
): number => {
  const price = convertPrice(subscription.price, subscription.currency);

  if (subscription.billingCycle === BillingCycle.YEARLY) return price / 12;
  if (subscription.billingCycle === BillingCycle.WEEKLY)
    return price * BILLING_CONVERSIONS.WEEKS_PER_MONTH;
  return price;
};

export const getYearlySubscriptionSpend = (
  subscription: Subscription,
  convertPrice: PriceConverter = identityConverter
): number => {
  const price = convertPrice(subscription.price, subscription.currency);

  if (subscription.billingCycle === BillingCycle.YEARLY) return price;
  if (subscription.billingCycle === BillingCycle.WEEKLY)
    return price * BILLING_CONVERSIONS.WEEKS_PER_YEAR;
  return price * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
};

export const calculateSubscriptionStats = (
  subscriptions: Subscription[] | null | undefined,
  convertPrice: PriceConverter = identityConverter
): SubscriptionStats => {
  if (!Array.isArray(subscriptions)) {
    return emptySubscriptionStats();
  }

  const activeSubscriptions = subscriptions.filter((sub) => sub.isActive);

  return activeSubscriptions.reduce((stats, subscription) => {
    stats.totalActive += 1;
    stats.totalMonthlySpend += getMonthlySubscriptionSpend(subscription, convertPrice);
    stats.totalYearlySpend += getYearlySubscriptionSpend(subscription, convertPrice);
    stats.categoryBreakdown[subscription.category] =
      (stats.categoryBreakdown[subscription.category] || 0) + 1;
    stats.totalGasSpent = (stats.totalGasSpent || 0) + (subscription.totalGasSpent || 0);
    return stats;
  }, emptySubscriptionStats());
};
