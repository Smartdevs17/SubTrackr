import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Wallet, CryptoStream, StreamSetup } from '../types/wallet';

interface WalletState {
  wallet: Wallet | null;
  address: string | null;
  network: string | null;
  cryptoStreams: CryptoStream[];
  isLoading: boolean;
  error: string | null;

  connectWallet: () => Promise<void>;
  syncWalletConnection: (payload: {
    address: string;
    chainId: number;
    network: string;
  }) => Promise<void>;
  disconnect: () => Promise<void>;
  updateBalance: () => Promise<void>;
  createCryptoStream: (setup: StreamSetup) => Promise<void>;
  cancelCryptoStream: (streamId: string) => Promise<void>;
  fetchCryptoStreams: () => Promise<void>;
}

const WALLET_STORAGE_KEY = '@subtrackr_wallet';

export const useWalletStore = create<WalletState>((set, get) => ({
  wallet: null,
  address: null,
  network: null,
  cryptoStreams: [],
  isLoading: false,
  error: null,

  connectWallet: async () => {
    set({ isLoading: true, error: null });
    try {
      const savedWallet = await AsyncStorage.getItem(WALLET_STORAGE_KEY);

      if (savedWallet) {
        const parsed = JSON.parse(savedWallet);
        set({
          address: parsed.address,
          network: parsed.network,
          wallet: parsed.wallet,
          isLoading: false,
        });
        return;
      }

      const mockWallet: Wallet = {
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fAb1',
        chainId: 1,
        isConnected: true,
        balance: '0.5',
        tokens: [
          {
            symbol: 'ETH',
            name: 'Ethereum',
            address: '0x0000000000000000000000000000000000000000',
            balance: '0.5',
            decimals: 18,
          },
          {
            symbol: 'USDC',
            name: 'USD Coin',
            address: '0xA0b86a33E6441b8b4b8b8b8b8b8b8b8b8b8b8b8',
            balance: '1000',
            decimals: 6,
          },
        ],
      };

      const walletData = {
        address: mockWallet.address,
        network: 'Ethereum Mainnet',
        wallet: mockWallet,
      };

      await AsyncStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(walletData));

      set({
        wallet: mockWallet,
        address: mockWallet.address,
        network: 'Ethereum Mainnet',
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to connect wallet',
        isLoading: false,
      });
    }
  },

  syncWalletConnection: async ({ address, chainId, network }) => {
    const walletData = {
      address,
      network,
      wallet: {
        address,
        chainId,
        isConnected: true,
        balance: '0',
        tokens: [],
      } as Wallet,
    };

    await AsyncStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(walletData));
    set({
      wallet: walletData.wallet,
      address,
      network,
      isLoading: false,
      error: null,
    });
  },

  disconnect: async () => {
    try {
      await AsyncStorage.removeItem(WALLET_STORAGE_KEY);
      set({ wallet: null, address: null, network: null, cryptoStreams: [] });
    } catch (error) {
      set({ error: 'Failed to disconnect wallet' });
    }
  },

  updateBalance: async () => {
    const { wallet } = get();
    if (!wallet) return;

    set({ isLoading: true, error: null });
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update balance',
        isLoading: false,
      });
    }
  },

  createCryptoStream: async (setup: StreamSetup) => {
    set({ isLoading: true, error: null });
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const newStream: CryptoStream = {
        id: Date.now().toString(),
        subscriptionId: 'temp',
        ...setup,
        isActive: true,
        streamId: `stream_${Date.now()}`,
      };

      set((state) => ({
        cryptoStreams: [...state.cryptoStreams, newStream],
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create crypto stream',
        isLoading: false,
      });
    }
  },

  cancelCryptoStream: async (streamId: string) => {
    set({ isLoading: true, error: null });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      set((state) => ({
        cryptoStreams: state.cryptoStreams.map((stream) =>
          stream.id === streamId ? { ...stream, isActive: false } : stream
        ),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to cancel crypto stream',
        isLoading: false,
      });
    }
  },

  fetchCryptoStreams: async () => {
    set({ isLoading: true, error: null });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch crypto streams',
        isLoading: false,
      });
    }
  },
}));
