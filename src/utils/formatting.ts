import { SubscriptionCategory, BillingCycle } from '../types/subscription';
import { TIME_CONSTANTS, CRYPTO_CONSTANTS, FORMATTING_CONSTANTS } from './constants/values';
import {
  DEFAULT_DATE_OPTIONS,
  formatDate as formatLocalizedDate,
  formatRelativeDay,
} from '../../packages/i18n-dates';

export const formatCurrency = (amount: number, currency: string = 'USD'): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
};

export const formatCurrencyCompact = (amount: number, currency: string = 'USD'): string => {
  if (amount >= 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: FORMATTING_CONSTANTS.COMPACT_MAX_FRACTION_DIGITS,
    }).format(amount);
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: FORMATTING_CONSTANTS.REGULAR_MAX_FRACTION_DIGITS,
  }).format(amount);
};

export const formatCryptoAmount = (
  amount: number,
  decimals: number = FORMATTING_CONSTANTS.DEFAULT_CRYPTO_DECIMALS
): string => {
  return amount.toFixed(decimals);
};

export const formatAddress = (
  address: string,
  start: number = FORMATTING_CONSTANTS.ADDRESS_START_CHARS,
  end: number = FORMATTING_CONSTANTS.ADDRESS_END_CHARS
): string => {
  if (!address || address.length < start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
};

/**
 * Calendar date for the portal. Delegates to `packages/i18n-dates` so the
 * portal and the mobile app share one implementation (issue #2259).
 */
export const formatDate = (date: Date, locale: string = 'en-US'): string =>
  formatLocalizedDate(date, locale, DEFAULT_DATE_OPTIONS);

/** `Today`, `Yesterday`, `3 days ago`, `In 2 days`, then a calendar date. */
export const formatRelativeDate = (date: Date, locale: string = 'en-US'): string =>
  formatRelativeDay(date, { locale });

export const formatCategory = (category: SubscriptionCategory): string => {
  return category.charAt(0).toUpperCase() + category.slice(1);
};

export const formatBillingCycle = (cycle: BillingCycle): string => {
  return cycle.charAt(0).toUpperCase() + cycle.slice(1);
};

export const formatFlowRate = (flowRate: string, token: string = 'ETH'): string => {
  // Convert flow rate from wei per second to human readable
  const flowRateNum = parseFloat(flowRate);
  if (isNaN(flowRateNum)) return '0';

  // Assuming flow rate is in wei per second
  const daily = flowRateNum * TIME_CONSTANTS.SECONDS_PER_DAY;
  const monthly = daily * TIME_CONSTANTS.DAYS_PER_MONTH;

  if (monthly >= CRYPTO_CONSTANTS.WEI_TO_ETHER) {
    return `${(monthly / CRYPTO_CONSTANTS.WEI_TO_ETHER).toFixed(4)} ${token}/month`;
  } else if (daily >= CRYPTO_CONSTANTS.WEI_TO_ETHER) {
    return `${(daily / CRYPTO_CONSTANTS.WEI_TO_ETHER).toFixed(4)} ${token}/day`;
  } else {
    return `${flowRateNum} wei/s`;
  }
};

export const capitalizeFirst = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
};

export const getCurrencySymbol = (currency: string): string => {
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CAD: '$',
    AUD: '$',
    INR: '₹',
    BTC: '₿',
    ETH: 'Ξ',
  };
  return symbols[currency] || currency;
};
