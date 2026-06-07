import {
  Subscription,
  SubscriptionCategory,
  SubscriptionStats,
  BillingCycle,
} from '../types/subscription';
import { BILLING_CONVERSIONS } from './constants/values';

/**
 * Optional price converter for currency-aware calculations.
 * When omitted, raw subscription prices are used as-is.
 */
export type PriceConverter = (price: number, currency: string) => number;

/**
 * Converts a subscription's price to a monthly equivalent.
 */
export const toMonthlyPrice = (price: number, billingCycle: BillingCycle): number => {
  switch (billingCycle) {
    case BillingCycle.YEARLY:
      return price / BILLING_CONVERSIONS.MONTHS_PER_YEAR;
    case BillingCycle.WEEKLY:
      return price * BILLING_CONVERSIONS.WEEKS_PER_MONTH;
    case BillingCycle.MONTHLY:
    case BillingCycle.CUSTOM:
    default:
      return price;
  }
};

/**
 * Converts a subscription's price to a yearly equivalent.
 */
export const toYearlyPrice = (price: number, billingCycle: BillingCycle): number => {
  switch (billingCycle) {
    case BillingCycle.YEARLY:
      return price;
    case BillingCycle.WEEKLY:
      return price * BILLING_CONVERSIONS.WEEKS_PER_YEAR;
    case BillingCycle.MONTHLY:
    case BillingCycle.CUSTOM:
    default:
      return price * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
  }
};

/**
 * Calculates subscription stats from a list of subscriptions.
 *
 * @param subscriptions - Array of subscriptions to calculate stats for.
 * @param convertPrice - Optional currency converter. Receives (price, currency) and returns
 *                       the price in the preferred currency. Defaults to identity (no conversion).
 */
export const calculateSubscriptionStats = (
  subscriptions: Subscription[],
  convertPrice: PriceConverter = (price) => price
): SubscriptionStats => {
  const empty: SubscriptionStats = {
    totalActive: 0,
    totalMonthlySpend: 0,
    totalYearlySpend: 0,
    categoryBreakdown: {} as Record<SubscriptionCategory, number>,
  };

  if (!subscriptions || !Array.isArray(subscriptions) || subscriptions.length === 0) {
    return empty;
  }

  const activeSubs = subscriptions.filter((sub) => sub.isActive);

  const totalMonthlySpend = activeSubs.reduce((total, sub) => {
    const converted = convertPrice(sub.price, sub.currency);
    return total + toMonthlyPrice(converted, sub.billingCycle);
  }, 0);

  const totalYearlySpend = activeSubs.reduce((total, sub) => {
    const converted = convertPrice(sub.price, sub.currency);
    return total + toYearlyPrice(converted, sub.billingCycle);
  }, 0);

  const categoryBreakdown = activeSubs.reduce(
    (acc, sub) => {
      acc[sub.category] = (acc[sub.category] || 0) + 1;
      return acc;
    },
    {} as Record<SubscriptionCategory, number>
  );

  const totalGasSpent = activeSubs.reduce((total, sub) => total + (sub.totalGasSpent || 0), 0);

  return {
    totalActive: activeSubs.length,
    totalMonthlySpend,
    totalYearlySpend,
    categoryBreakdown,
    totalGasSpent,
  };
};
