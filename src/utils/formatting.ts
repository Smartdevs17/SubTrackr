import { SubscriptionCategory, BillingCycle } from '../types/subscription';

export const formatCurrency = (amount: number, currency: string = 'USD'): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
};

export const formatCryptoAmount = (amount: number, decimals: number = 18): string => {
  return amount.toFixed(decimals);
};

export const formatAddress = (address: string, start: number = 6, end: number = 4): string => {
  if (!address || address.length < start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
};

export const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
};

export const formatRelativeDate = (date: Date): string => {
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
  
  if (diffInDays === 0) return 'Today';
  if (diffInDays === 1) return 'Yesterday';
  if (diffInDays === -1) return 'Tomorrow';
  if (diffInDays > 0) return `${diffInDays} days ago`;
  if (diffInDays < 0) return `In ${Math.abs(diffInDays)} days`;
  
  return formatDate(date);
};

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
  const daily = flowRateNum * 86400; // seconds in a day
  const monthly = daily * 30; // approximate days in a month
  
  if (monthly >= 1e18) {
    return `${(monthly / 1e18).toFixed(4)} ${token}/month`;
  } else if (daily >= 1e18) {
    return `${(daily / 1e18).toFixed(4)} ${token}/day`;
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
