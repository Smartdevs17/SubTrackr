import type { WalletConnection } from '../services/walletService';

export interface WalletProviderState {
  connection: WalletConnection | null;
  isLoading: boolean;
  error: string | null;
  connectWallet: () => Promise<void>;
  disconnect: () => Promise<void>;
  updateBalance: () => Promise<void>;
}

export interface WalletProvider {
  isConnected: boolean;
  address: string | null;
  isLoading: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshBalance: () => Promise<void>;
}

/** Narrow the wallet store to the surface screens are allowed to use. */
export function selectWalletProvider(state: WalletProviderState): WalletProvider {
  return {
    isConnected: state.connection !== null,
    address: state.connection?.address ?? null,
    isLoading: state.isLoading,
    error: state.error,
    connect: state.connectWallet,
    disconnect: state.disconnect,
    refreshBalance: state.updateBalance,
  };
}
