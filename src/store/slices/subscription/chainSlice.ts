import { Subscription } from '../../../types/subscription';
import { ChainType } from '../../../types/wallet';
import { crossChainRoutingService } from '../../../services/crossChainRoutingService';
import { crossChainNotificationService } from '../../../services/crossChainNotificationService';
import { errorHandler } from '../../../services/errorHandler';

export const initialSubscriptionChainState = {
  chainFilter: {} as unknown,
};

export function createSubscriptionChainSlice(set: any, get: any) {
  return {
    ...initialSubscriptionChainState,

    setChainFilter: (filter: unknown) => set({ chainFilter: filter }),

    getFilteredSubscriptions: () => {
      const { subscriptions, chainFilter } = get();
      if (!chainFilter || Object.keys(chainFilter).length === 0) return subscriptions;

      return subscriptions.filter((sub: Subscription) => {
        if (chainFilter.chainType !== undefined && sub.chainType !== chainFilter.chainType)
          return false;
        if (chainFilter.chainId !== undefined && sub.chainId !== chainFilter.chainId) return false;
        if (chainFilter.status === 'active' && !sub.isActive) return false;
        if (chainFilter.status === 'paused' && sub.isActive) return false;
        if (chainFilter.searchQuery) {
          const query = chainFilter.searchQuery.toLowerCase();
          if (
            !sub.name.toLowerCase().includes(query) &&
            !sub.category.toLowerCase().includes(query)
          )
            return false;
        }
        return true;
      });
    },

    getSubscriptionsByChain: (chainType: string) => {
      return get().subscriptions.filter((s: Subscription) => s.chainType === chainType);
    },

    initiateCrossChainTransfer: async (
      id: string,
      targetChainType: string,
      targetChainId: number
    ) => {
      set({ isLoading: true, error: null });
      try {
        const sub = get().subscriptions.find((s: Subscription) => s.id === id);
        if (!sub) throw new Error('Subscription not found');

        const subChainType = sub.chainType ?? ChainType.EVM;
        const subChainId = sub.chainId ?? 1;

        const transfer = {
          sourceChainType: subChainType,
          sourceChainId: subChainId,
          targetChainType,
          targetChainId,
          status: 'pending',
          initiatedAt: new Date(),
        };

        const route = await crossChainRoutingService.findPaymentRoute({
          sourceChainType: subChainType,
          sourceChainId: subChainId,
          targetChainType,
          targetChainId,
          tokenSymbol: sub.cryptoToken || sub.currency,
          amount: sub.price.toString(),
        });

        await crossChainRoutingService.executePayment(route);

        set((state: any) => ({
          subscriptions: state.subscriptions.map((s: Subscription) =>
            s.id === id
              ? {
                  ...s,
                  crossChainTransfer: { ...transfer, status: 'pending' },
                  updatedAt: new Date(),
                }
              : s
          ),
          isLoading: false,
        }));

        crossChainNotificationService.notifyCrossChainTransfer(id, subChainType, targetChainType);
        get().calculateStats();
      } catch (error) {
        const appError = errorHandler.handleError(error as Error, {
          action: 'initiateCrossChainTransfer',
          subscriptionId: id,
        });
        set({ error: appError, isLoading: false });
      }
    },

    approveCrossChainTransfer: async (id: string) => {
      set({ isLoading: true, error: null });
      try {
        const sub = get().subscriptions.find((s: Subscription) => s.id === id);
        if (!sub || !sub.crossChainTransfer) throw new Error('No pending transfer');

        set((state: any) => ({
          subscriptions: state.subscriptions.map((s: Subscription) =>
            s.id === id
              ? {
                  ...s,
                  chainType: s.crossChainTransfer.targetChainType,
                  chainId: s.crossChainTransfer.targetChainId,
                  crossChainTransfer: { ...s.crossChainTransfer, status: 'completed' },
                  updatedAt: new Date(),
                }
              : s
          ),
          isLoading: false,
        }));

        get().calculateStats();
      } catch (error) {
        const appError = errorHandler.handleError(error as Error, {
          action: 'approveCrossChainTransfer',
          subscriptionId: id,
        });
        set({ error: appError, isLoading: false });
      }
    },

    aggregateCrossChainBilling: async () => {
      const { subscriptions } = get();
      const activeSubs = subscriptions.filter((s: Subscription) => s.isActive);

      const billingItems = activeSubs.map((sub: Subscription) => ({
        chainType: sub.chainType ?? ChainType.EVM,
        amount: sub.price,
        currency: sub.currency,
      }));

      return crossChainRoutingService.aggregateBilling(billingItems);
    },
  };
}
