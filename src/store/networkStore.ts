import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import { Network, ALL_NETWORKS, getNetworkById } from '../config/networks';
import { networkService } from '../services/networkService';

interface NetworkState {
  currentNetwork: Network | null;
  availableNetworks: Network[];
  isLoading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  setNetwork: (networkId: string) => Promise<void>;
  checkHealth: (
    networkId: string
  ) => Promise<{ healthy: boolean; latency?: number; error?: string }>;
  refreshNetworks: () => Promise<void>;
}

export const useNetworkStore = create<NetworkState>()(
  persist(
    (set) => ({
      currentNetwork: null,
      availableNetworks: ALL_NETWORKS,
      isLoading: false,
      error: null,

      initialize: async () => {
        set({ isLoading: true, error: null });
        try {
          const network = await networkService.getSelectedNetwork();
          set({ currentNetwork: network, isLoading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to initialize network',
            isLoading: false,
          });
        }
      },

      setNetwork: async (networkId: string) => {
        set({ isLoading: true, error: null });
        try {
          const success = await networkService.setSelectedNetwork(networkId);
          if (success) {
            const network = getNetworkById(networkId);
            set({ currentNetwork: network, isLoading: false });
          } else {
            set({ error: 'Failed to set network', isLoading: false });
          }
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to set network',
            isLoading: false,
          });
        }
      },

      checkHealth: async (networkId: string) => {
        try {
          return await networkService.checkNetworkHealth(networkId);
        } catch (error) {
          return {
            healthy: false,
            error: error instanceof Error ? error.message : 'Health check failed',
          };
        }
      },

      refreshNetworks: async () => {
        set({ isLoading: true, error: null });
        try {
          const networks = await networkService.getAvailableNetworks();
          set({ availableNetworks: networks, isLoading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to refresh networks',
            isLoading: false,
          });
        }
      },
    }),
    {
      name: 'subtrackr-network-store',
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        currentNetwork: state.currentNetwork,
      }),
    }
  )
);
