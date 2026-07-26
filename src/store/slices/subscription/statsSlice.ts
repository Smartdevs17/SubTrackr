import { Subscription, SubscriptionStats, ChainSpendBreakdown } from '../../../types/subscription';
import { useSettingsStore } from '../../settingsStore';
import { currencyService } from '../../../services/currencyService';
import { BILLING_CONVERSIONS } from '../../../utils/constants/values';
import { ChainType } from '../../../types/wallet';

export const initialSubscriptionStatsState = {
  stats: {
    totalActive: 0,
    totalMonthlySpend: 0,
    totalYearlySpend: 0,
    categoryBreakdown: {} as Record<string, number>,
    chainBreakdown: { stellar: 0, evm: {} } as ChainSpendBreakdown,
    crossChainTotalMonthlySpend: 0,
    crossChainTotalYearlySpend: 0,
    totalGasSpent: 0,
  } as SubscriptionStats,
};

export function createSubscriptionStatsSlice(set: any, get: any) {
  return {
    ...initialSubscriptionStatsState,

    calculateStats: () => {
      const subscriptions = get().subscriptions;

      if (!subscriptions || !Array.isArray(subscriptions)) {
        set({
          stats: {
            totalActive: 0,
            totalMonthlySpend: 0,
            totalYearlySpend: 0,
            categoryBreakdown: {},
            chainBreakdown: { stellar: 0, evm: {} },
            crossChainTotalMonthlySpend: 0,
            crossChainTotalYearlySpend: 0,
            totalGasSpent: 0,
          },
        });
        return;
      }

      const activeSubs = subscriptions.filter((sub: Subscription) => sub.isActive);
      const { preferredCurrency, exchangeRates } = useSettingsStore.getState();
      const rates = exchangeRates?.rates || {};

      let totalMonthlySpend = 0;
      let totalYearlySpend = 0;
      const chainBreakdown: ChainSpendBreakdown = { stellar: 0, evm: {} };

      for (const sub of activeSubs) {
        const priceInPreferred = currencyService.convert(
          sub.price,
          sub.currency,
          preferredCurrency,
          rates
        );

        let monthlyAmount = 0;
        let yearlyAmount = 0;

        if (sub.billingCycle === 'monthly') {
          monthlyAmount = priceInPreferred;
          yearlyAmount = priceInPreferred * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
        } else if (sub.billingCycle === 'yearly') {
          monthlyAmount = priceInPreferred / 12;
          yearlyAmount = priceInPreferred;
        } else if (sub.billingCycle === 'weekly') {
          monthlyAmount = priceInPreferred * BILLING_CONVERSIONS.WEEKS_PER_MONTH;
          yearlyAmount = priceInPreferred * BILLING_CONVERSIONS.WEEKS_PER_YEAR;
        } else {
          monthlyAmount = priceInPreferred;
          yearlyAmount = priceInPreferred * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
        }

        totalMonthlySpend += monthlyAmount;
        totalYearlySpend += yearlyAmount;

        const chainType = sub.chainType ?? ChainType.EVM;
        const chainId = sub.chainId ?? 1;
        if (chainType === ChainType.STELLAR) {
          chainBreakdown.stellar += monthlyAmount;
        } else {
          if (!chainBreakdown.evm[chainId]) {
            chainBreakdown.evm[chainId] = 0;
          }
          chainBreakdown.evm[chainId] += monthlyAmount;
        }
      }

      const categoryBreakdown = activeSubs.reduce(
        (acc: Record<string, number>, sub: Subscription) => {
          acc[sub.category] = (acc[sub.category] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      const totalGasSpent = activeSubs.reduce(
        (total: number, sub: Subscription) => total + (sub.totalGasSpent || 0),
        0
      );

      set({
        stats: {
          totalActive: activeSubs.length,
          totalMonthlySpend,
          totalYearlySpend,
          categoryBreakdown: categoryBreakdown as Record<string, number>,
          totalGasSpent,
          chainBreakdown,
          crossChainTotalMonthlySpend: totalMonthlySpend,
          crossChainTotalYearlySpend: totalYearlySpend,
        } as SubscriptionStats,
      });
    },
  };
}
