/**
 * networkStore.ts — Network selection state (slices pattern).
 *
 * Delegates to the combined `useAppStore` (see slices/index.ts). The legacy
 * `useNetworkStore` hook is preserved for compatibility.
 */

import { useAppStore, NetworkSlice } from './slices';
import { Network, ALL_NETWORKS, getNetworkById } from '../config/networks';
import { networkService } from '../services/networkService';

export type NetworkState = NetworkSlice;

export const useNetworkStore = useAppStore;

export const selectCurrentNetwork = (s: NetworkState) => s.currentNetwork;
export const selectAvailableNetworks = (s: NetworkState) => s.availableNetworks;

export type { Network };
export { ALL_NETWORKS, getNetworkById, networkService };
