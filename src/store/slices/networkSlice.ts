/**
 * Network Slice – blockchain network state.
 */
import type { StateCreator } from 'zustand';
import { Network, ALL_NETWORKS, getNetworkById } from '../../config/networks';

// ── Interface ───────────────────────────────────────────────────────────

export interface NetworkSlice {
  currentNetwork: Network | null;
  availableNetworks: Network[];
  networkLoading: boolean;
  networkError: string | null;
  initializeNetwork: () => Promise<void>;
  setNetwork: (networkId: string) => Promise<void>;
  checkNetworkHealth: (networkId: string) => Promise<{ healthy: boolean; latency?: number; error?: string }>;
  refreshNetworks: () => Promise<void>;
}

type NetworkStore = NetworkSlice;
type NetworkCreator = StateCreator<NetworkStore & any, [], [], NetworkStore>;

// ═══════════════════════════════════════════════════════════════════════════
// Slice Factory
// ═══════════════════════════════════════════════════════════════════════════

export const createNetworkSlice: NetworkCreator = (set) => ({
  currentNetwork: null,
  availableNetworks: ALL_NETWORKS,
  networkLoading: false,
  networkError: null,

  initializeNetwork: async () => {
    set({ networkLoading: true, networkError: null });
    try {
      set({ currentNetwork: ALL_NETWORKS[0] ?? null, networkLoading: false });
    } catch (error) {
      set({ networkError: error instanceof Error ? error.message : 'Failed to initialize', networkLoading: false });
    }
  },

  setNetwork: async (networkId: string) => {
    set({ networkLoading: true, networkError: null });
    try {
      const network = getNetworkById(networkId);
      set({ currentNetwork: network, networkLoading: false });
    } catch (error) {
      set({ networkError: error instanceof Error ? error.message : 'Failed to set network', networkLoading: false });
    }
  },

  checkNetworkHealth: async (_networkId: string) => ({ healthy: true }),

  refreshNetworks: async () => {
    set({ networkLoading: true, networkError: null });
    try {
      set({ availableNetworks: ALL_NETWORKS, networkLoading: false });
    } catch (error) {
      set({ networkError: error instanceof Error ? error.message : 'Failed to refresh', networkLoading: false });
    }
  },
});
