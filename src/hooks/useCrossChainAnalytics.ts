import { useMemo } from 'react';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { ChainType } from '../types/wallet';
import { SubscriptionCategory } from '../types/subscription';

interface ChainAnalytics {
  stellar: {
    totalMonthlySpend: number;
    totalYearlySpend: number;
    activeCount: number;
    categoryBreakdown: Record<string, number>;
  };
  evm: {
    totalMonthlySpend: number;
    totalYearlySpend: number;
    activeCount: number;
    categoryBreakdown: Record<string, number>;
    byChainId: Record<
      number,
      {
        name: string;
        totalMonthlySpend: number;
        activeCount: number;
      }
    >;
  };
  unified: {
    totalMonthlySpend: number;
    totalYearlySpend: number;
    totalActive: number;
    stellarPercentage: number;
    evmPercentage: number;
  };
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  137: 'Polygon',
  42161: 'Arbitrum',
  10: 'Optimism',
  8453: 'Base',
};

export function useCrossChainAnalytics(): ChainAnalytics {
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);
  const stats = useSubscriptionStore((state) => state.stats);

  return useMemo(() => {
    const stellarSubs = subscriptions.filter(
      (s) => s.chainType === ChainType.STELLAR && s.isActive
    );
    const evmSubs = subscriptions.filter((s) => s.chainType === ChainType.EVM && s.isActive);

    const calculateSpend = (subs: typeof subscriptions) => {
      let monthly = 0;
      let yearly = 0;
      for (const sub of subs) {
        if (sub.billingCycle === 'monthly') {
          monthly += sub.price;
          yearly += sub.price * 12;
        } else if (sub.billingCycle === 'yearly') {
          monthly += sub.price / 12;
          yearly += sub.price;
        } else if (sub.billingCycle === 'weekly') {
          monthly += sub.price * 4.33;
          yearly += sub.price * 52;
        } else {
          monthly += sub.price;
          yearly += sub.price * 12;
        }
      }
      return { monthly, yearly };
    };

    const stellarSpend = calculateSpend(stellarSubs);
    const evmSpend = calculateSpend(evmSubs);

    const stellarCategoryBreakdown = stellarSubs.reduce(
      (acc, sub) => {
        acc[sub.category] = (acc[sub.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const evmCategoryBreakdown = evmSubs.reduce(
      (acc, sub) => {
        acc[sub.category] = (acc[sub.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const evmByChainId: Record<
      number,
      { name: string; totalMonthlySpend: number; activeCount: number }
    > = {};
    for (const sub of evmSubs) {
      if (!evmByChainId[sub.chainId]) {
        evmByChainId[sub.chainId] = {
          name: CHAIN_NAMES[sub.chainId] || `Chain ${sub.chainId}`,
          totalMonthlySpend: 0,
          activeCount: 0,
        };
      }
      evmByChainId[sub.chainId].activeCount += 1;
      if (sub.billingCycle === 'monthly') {
        evmByChainId[sub.chainId].totalMonthlySpend += sub.price;
      } else if (sub.billingCycle === 'yearly') {
        evmByChainId[sub.chainId].totalMonthlySpend += sub.price / 12;
      } else if (sub.billingCycle === 'weekly') {
        evmByChainId[sub.chainId].totalMonthlySpend += sub.price * 4.33;
      }
    }

    const totalActive = subscriptions.filter((s) => s.isActive).length;
    const totalMonthly = stellarSpend.monthly + evmSpend.monthly;
    const totalYearly = stellarSpend.yearly + evmSpend.yearly;

    return {
      stellar: {
        totalMonthlySpend: stellarSpend.monthly,
        totalYearlySpend: stellarSpend.yearly,
        activeCount: stellarSubs.length,
        categoryBreakdown: stellarCategoryBreakdown,
      },
      evm: {
        totalMonthlySpend: evmSpend.monthly,
        totalYearlySpend: evmSpend.yearly,
        activeCount: evmSubs.length,
        categoryBreakdown: evmCategoryBreakdown,
        byChainId: evmByChainId,
      },
      unified: {
        totalMonthlySpend: totalMonthly,
        totalYearlySpend: totalYearly,
        totalActive,
        stellarPercentage: totalMonthly > 0 ? (stellarSpend.monthly / totalMonthly) * 100 : 0,
        evmPercentage: totalMonthly > 0 ? (evmSpend.monthly / totalMonthly) * 100 : 0,
      },
    };
  }, [subscriptions, stats]);
}
