import { create } from 'zustand';
import { Wallet, TokenBalance, CryptoStream, StreamSetup } from '../types/wallet';

interface WalletState {
  wallet: Wallet | null;
  cryptoStreams: CryptoStream[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  updateBalance: () => Promise<void>;
  createCryptoStream: (setup: StreamSetup) => Promise<void>;
  cancelCryptoStream: (streamId: string) => Promise<void>;
  fetchCryptoStreams: () => Promise<void>;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  wallet: null,
  cryptoStreams: [],
  isLoading: false,
  error: null,

  connectWallet: async () => {
    set({ isLoading: true, error: null });
    try {
      // TODO: Implement actual wallet connection
      // For now, simulate connection
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const mockWallet: Wallet = {
        address: '0x1234...5678',
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
      
      set({ wallet: mockWallet, isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to connect wallet',
        isLoading: false 
      });
    }
  },

  disconnectWallet: () => {
    set({ wallet: null, cryptoStreams: [] });
  },

  updateBalance: async () => {
    const { wallet } = get();
    if (!wallet) return;
    
    set({ isLoading: true, error: null });
    try {
      // TODO: Implement actual balance update
      await new Promise(resolve => setTimeout(resolve, 500));
      set({ isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to update balance',
        isLoading: false 
      });
    }
  },

  createCryptoStream: async (setup: StreamSetup) => {
    set({ isLoading: true, error: null });
    try {
      // TODO: Implement actual stream creation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const newStream: CryptoStream = {
        id: Date.now().toString(),
        subscriptionId: 'temp', // This should come from the subscription
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
        isLoading: false 
      });
    }
  },

  cancelCryptoStream: async (streamId: string) => {
    set({ isLoading: true, error: null });
    try {
      // TODO: Implement actual stream cancellation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      set((state) => ({
        cryptoStreams: state.cryptoStreams.map((stream) =>
          stream.id === streamId
            ? { ...stream, isActive: false }
            : stream
        ),
        isLoading: false,
      }));
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to cancel crypto stream',
        isLoading: false 
      });
    }
  },

  fetchCryptoStreams: async () => {
    set({ isLoading: true, error: null });
    try {
      // TODO: Implement actual API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      set({ isLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch crypto streams',
        isLoading: false 
      });
    }
  },
}));
