import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Wallet,
  CryptoStream,
  StreamSetup,
  PaymentMethod,
  PaymentMethodFormData,
  PaymentPriority,
  PaymentAttempt,
  PaymentMethodValidationResult,
} from '../types/wallet';
import {
  PaymentMethodService,
  PaymentMethodError,
  PaymentMethodErrorCode,
  PaymentMethodExpiryCheck,
} from '../services/walletService';

interface WalletState {
  wallet: Wallet | null;
  address: string | null;
  network: string | null;
  cryptoStreams: CryptoStream[];
  paymentMethods: PaymentMethod[];
  paymentAttempts: PaymentAttempt[];
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

  addPaymentMethod: (data: PaymentMethodFormData) => Promise<PaymentMethod>;
  removePaymentMethod: (id: string) => Promise<void>;
  updatePaymentMethod: (id: string, updates: Partial<PaymentMethod>) => Promise<void>;
  verifyPaymentMethod: (id: string) => Promise<boolean>;
  setPaymentMethodPriority: (id: string, priority: PaymentPriority) => Promise<void>;
  processPayment: (
    subscriptionId: string,
    amount: string,
    chainId: number,
    maxGasPriceGwei?: number
  ) => Promise<{ success: boolean; attempt: PaymentAttempt; fallbackAttempts: PaymentAttempt[] }>;
  getExpiryInfo: () => {
    expired: PaymentMethodExpiryCheck[];
    expiringSoon: PaymentMethodExpiryCheck[];
  };
  getPaymentMethodsByPriority: () => {
    primary: PaymentMethod[];
    backup: PaymentMethod[];
    fallback: PaymentMethod[];
  };
  checkTokenContractUpgrade: (id: string) => Promise<boolean>;
}

const WALLET_STORAGE_KEY = '@subtrackr_wallet';
const PAYMENT_METHODS_STORAGE_KEY = '@subtrackr_payment_methods';
const PAYMENT_ATTEMPTS_STORAGE_KEY = '@subtrackr_payment_attempts';

const paymentService = PaymentMethodService.getInstance();

export const useWalletStore = create<WalletState>((set, get) => ({
  wallet: null,
  address: null,
  network: null,
  cryptoStreams: [],
  paymentMethods: [],
  paymentAttempts: [],
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

        const savedMethods = await AsyncStorage.getItem(PAYMENT_METHODS_STORAGE_KEY);
        if (savedMethods) {
          set({ paymentMethods: JSON.parse(savedMethods) });
        }

        const savedAttempts = await AsyncStorage.getItem(PAYMENT_ATTEMPTS_STORAGE_KEY);
        if (savedAttempts) {
          set({ paymentAttempts: JSON.parse(savedAttempts) });
        }

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
      set({
        wallet: null,
        address: null,
        network: null,
        cryptoStreams: [],
        paymentMethods: [],
        paymentAttempts: [],
      });
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

  addPaymentMethod: async (data: PaymentMethodFormData) => {
    set({ isLoading: true, error: null });
    try {
      const { paymentMethods, address } = get();
      if (!address) {
        throw new PaymentMethodError(
          PaymentMethodErrorCode.VERIFICATION_FAILED,
          'Wallet not connected.',
          'Connect your wallet first.'
        );
      }

      const canAdd = paymentService.canAddMethod(paymentMethods.length);
      if (!canAdd.canAdd) {
        throw new PaymentMethodError(
          PaymentMethodErrorCode.MAX_METHODS,
          canAdd.reason!,
          'Remove an existing payment method first.'
        );
      }

      const validation = paymentService.validatePaymentMethodForm(data);
      if (!validation.isValid) {
        throw new PaymentMethodError(
          PaymentMethodErrorCode.INVALID_TOKEN,
          validation.errors.join('; '),
          'Fix the validation errors and try again.'
        );
      }

      const isDup = paymentService.isDuplicateMethod(
        paymentMethods,
        data.tokenAddress,
        data.chainId,
        data.tokenType
      );
      if (isDup) {
        throw new PaymentMethodError(
          PaymentMethodErrorCode.DUPLICATE,
          'A payment method with this token and chain already exists.',
          'Use a different token or chain.'
        );
      }

      const newMethod: PaymentMethod = {
        id: paymentService.generateId(),
        userId: address,
        tokenType: data.tokenType,
        tokenAddress: data.tokenAddress,
        chainId: data.chainId,
        label: data.label,
        priority: data.priority,
        maxSpendPerInterval: data.maxSpendPerInterval,
        isVerified: data.tokenType === 'NATIVE',
        isActive: true,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
      };

      if (!newMethod.isVerified) {
        await paymentService.verifyPaymentMethod(newMethod);
        newMethod.isVerified = true;
      }

      const updatedMethods = [...paymentMethods, newMethod];
      await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));

      set({
        paymentMethods: updatedMethods,
        isLoading: false,
      });

      return newMethod;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to add payment method',
        isLoading: false,
      });
      throw error;
    }
  },

  removePaymentMethod: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const { paymentMethods } = get();
      const updatedMethods = paymentMethods.filter((m) => m.id !== id);
      await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));
      set({ paymentMethods: updatedMethods, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to remove payment method',
        isLoading: false,
      });
    }
  },

  updatePaymentMethod: async (id: string, updates: Partial<PaymentMethod>) => {
    set({ isLoading: true, error: null });
    try {
      const { paymentMethods } = get();
      const updatedMethods = paymentMethods.map((m) =>
        m.id === id ? { ...m, ...updates, updatedAt: new Date() } : m
      );
      await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));
      set({ paymentMethods: updatedMethods, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update payment method',
        isLoading: false,
      });
    }
  },

  verifyPaymentMethod: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const { paymentMethods } = get();
      const method = paymentMethods.find((m) => m.id === id);
      if (!method) {
        throw new Error('Payment method not found');
      }

      const verified = await paymentService.verifyPaymentMethod(method);
      if (verified) {
        const updatedMethods = paymentMethods.map((m) =>
          m.id === id ? { ...m, isVerified: true, updatedAt: new Date() } : m
        );
        await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));
        set({ paymentMethods: updatedMethods, isLoading: false });
      }
      return verified;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to verify payment method',
        isLoading: false,
      });
      throw error;
    }
  },

  setPaymentMethodPriority: async (id: string, priority: PaymentPriority) => {
    set({ isLoading: true, error: null });
    try {
      const { paymentMethods } = get();
      const method = paymentMethods.find((m) => m.id === id);
      if (!method) {
        throw new Error('Payment method not found');
      }

      const updatedMethods = paymentMethods.map((m) =>
        m.id === id ? { ...m, priority, updatedAt: new Date() } : m
      );
      await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));
      set({ paymentMethods: updatedMethods, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update payment method priority',
        isLoading: false,
      });
    }
  },

  processPayment: async (
    subscriptionId: string,
    amount: string,
    chainId: number,
    maxGasPriceGwei: number = 500
  ) => {
    set({ isLoading: true, error: null });
    try {
      const { paymentMethods } = get();
      const result = await paymentService.processPaymentWithFallback(
        paymentMethods,
        subscriptionId,
        amount,
        chainId,
        maxGasPriceGwei
      );

      const updatedMethods = paymentMethods.map((m) => {
        if (m.id === result.attempt.paymentMethodId) {
          return { ...m, lastUsedAt: new Date(), updatedAt: new Date() };
        }
        return m;
      });
      await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));

      const newAttempts = [...get().paymentAttempts, result.attempt, ...result.fallbackAttempts];
      await AsyncStorage.setItem(PAYMENT_ATTEMPTS_STORAGE_KEY, JSON.stringify(newAttempts));

      set({
        paymentMethods: updatedMethods,
        paymentAttempts: newAttempts,
        isLoading: false,
      });

      return result;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Payment processing failed',
        isLoading: false,
      });
      throw error;
    }
  },

  getExpiryInfo: () => {
    const { paymentMethods } = get();
    const expired = paymentService.getExpiredMethods(paymentMethods);
    const expiringSoon = paymentService.getExpiringSoonMethods(paymentMethods);

    return {
      expired: expired.map((m) => paymentService.checkExpiry(m)),
      expiringSoon: expiringSoon.map((m) => paymentService.checkExpiry(m)),
    };
  },

  getPaymentMethodsByPriority: () => {
    const { paymentMethods } = get();
    return {
      primary: paymentService.getPrimaryMethods(paymentMethods),
      backup: paymentService.getBackupMethods(paymentMethods),
      fallback: paymentService.getFallbackMethods(paymentMethods),
    };
  },

  checkTokenContractUpgrade: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const { paymentMethods } = get();
      const method = paymentMethods.find((m) => m.id === id);
      if (!method) {
        throw new Error('Payment method not found');
      }

      const previousHash = method.metadata.token_code_hash ?? null;
      const result = await paymentService.detectTokenContractUpgrade(method, previousHash);

      if (result.upgraded && result.newHash) {
        const updatedMethods = paymentMethods.map((m) =>
          m.id === id
            ? {
                ...m,
                metadata: { ...m.metadata, token_code_hash: result.newHash },
                updatedAt: new Date(),
              }
            : m
        );
        await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));
        set({ paymentMethods: updatedMethods, isLoading: false });
      } else if (result.newHash && !previousHash) {
        const updatedMethods = paymentMethods.map((m) =>
          m.id === id
            ? {
                ...m,
                metadata: { ...m.metadata, token_code_hash: result.newHash },
                updatedAt: new Date(),
              }
            : m
        );
        await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));
        set({ paymentMethods: updatedMethods, isLoading: false });
      }

      set({ isLoading: false });
      return result.upgraded;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to check token contract upgrade',
        isLoading: false,
      });
      return false;
    }
  },
}));
