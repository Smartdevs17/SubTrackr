import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CryptoStream,
  StreamSetup,
  PaymentMethod,
  PaymentMethodFormData,
  PaymentPriority,
  PaymentAttempt,
} from '../types/wallet';
import {
  WalletServiceManager,
  PaymentMethodService,
  PaymentMethodError,
  PaymentMethodErrorCode,
  PaymentMethodExpiryCheck,
  WalletConnection,
} from '../services/walletService';

type AppError = PaymentMethodError;

interface WalletState {
  // Connection state from service
  connection: WalletConnection | null;
  // UI state
  cryptoStreams: CryptoStream[];
  paymentMethods: PaymentMethod[];
  paymentAttempts: PaymentAttempt[];
  isLoading: boolean;
  error: string | null;

  // Connection management (delegates to service)
  connectWallet: () => Promise<void>;
  disconnect: () => Promise<void>;
  // Balance updates
  updateBalance: () => Promise<void>;
  // Stream management
  createCryptoStream: (setup: StreamSetup) => Promise<void>;
  cancelCryptoStream: (streamId: string) => Promise<void>;
  fetchCryptoStreams: () => Promise<void>;

  // Payment method management
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

const PAYMENT_METHODS_STORAGE_KEY = '@subtrackr_payment_methods';
const PAYMENT_ATTEMPTS_STORAGE_KEY = '@subtrackr_payment_attempts';

const walletService = WalletServiceManager.getInstance();
const paymentService = PaymentMethodService.getInstance();

export const useWalletStore = create<WalletState>((set, get) => {
  // Listen to wallet service connection changes
  walletService.addListener((connection) => {
    set({ connection });
  });

  return {
    connection: null,
    cryptoStreams: [],
    paymentMethods: [],
    paymentAttempts: [],
    isLoading: false,
    error: null,

    connectWallet: async () => {
      set({ isLoading: true, error: null });
      try {
        // Restore persisted payment methods and attempts
        const savedMethods = await AsyncStorage.getItem(PAYMENT_METHODS_STORAGE_KEY);
        if (savedMethods) {
          set({ paymentMethods: JSON.parse(savedMethods) });
        }

        const savedAttempts = await AsyncStorage.getItem(PAYMENT_ATTEMPTS_STORAGE_KEY);
        if (savedAttempts) {
          set({ paymentAttempts: JSON.parse(savedAttempts) });
        }

        // Connection state is managed by walletService
        const connection = walletService.getConnection();
        set({ connection, isLoading: false });
      } catch (error) {
        set({
          error:
            error instanceof PaymentMethodError
              ? error.userMessage
              : error instanceof Error
                ? error.message
                : 'Failed to connect wallet',
          isLoading: false,
        });
      }
    },

    disconnect: async () => {
      try {
        await walletService.disconnectWallet();
        set({
          connection: null,
          cryptoStreams: [],
          paymentMethods: [],
          paymentAttempts: [],
        });
      } catch (error) {
        set({ error: 'Failed to disconnect wallet' });
      }
    },

    updateBalance: async () => {
      const { connection } = get();
      if (!connection) return;

      set({ isLoading: true, error: null });
      try {
        // Service handles actual balance fetching
        await new Promise((resolve) => setTimeout(resolve, 500));
        set({ isLoading: false });
      } catch (error) {
        set({
          error:
            error instanceof PaymentMethodError
              ? error.userMessage
              : error instanceof Error
                ? error.message
                : 'Failed to update balance',
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
          error:
            error instanceof PaymentMethodError
              ? error.userMessage
              : error instanceof Error
                ? error.message
                : 'Failed to create crypto stream',
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
          error:
            error instanceof PaymentMethodError
              ? error.userMessage
              : error instanceof Error
                ? error.message
                : 'Failed to cancel crypto stream',
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
          error:
            error instanceof PaymentMethodError
              ? error.userMessage
              : error instanceof Error
                ? error.message
                : 'Failed to fetch crypto streams',
          isLoading: false,
        });
      }
    },

    addPaymentMethod: async (data: PaymentMethodFormData) => {
      set({ isLoading: true, error: null });
      try {
        const { paymentMethods, connection } = get();
        if (!connection?.address) {
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
          userId: connection.address,
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
          error:
            error instanceof PaymentMethodError
              ? error.userMessage
              : error instanceof Error
                ? error.message
                : 'Failed to add payment method',
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
          error:
            error instanceof PaymentMethodError
              ? error.userMessage
              : error instanceof Error
                ? error.message
                : 'Failed to remove payment method',
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
          error:
            error instanceof PaymentMethodError
              ? error.userMessage
              : error instanceof Error
                ? error.message
                : 'Failed to update payment method',
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
          error:
            error instanceof PaymentMethodError
              ? error.userMessage
              : error instanceof Error
                ? error.message
                : 'Failed to verify payment method',
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
          error:
            error instanceof PaymentMethodError
              ? error.userMessage
              : error instanceof Error
                ? error.message
                : 'Failed to update payment method priority',
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
          error:
            error instanceof PaymentMethodError
              ? error.userMessage
              : error instanceof Error
                ? error.message
                : 'Payment processing failed',
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

        const previousHash = (method.metadata['token_code_hash'] as string | null) ?? null;
        const result = await paymentService.detectTokenContractUpgrade(method, previousHash);

        if (result.upgraded && result.newHash) {
          const updatedMethods = paymentMethods.map((m) =>
            m.id === id
              ? {
                  ...m,
                  metadata: { ...m.metadata, token_code_hash: result.newHash! },
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
                  metadata: { ...m.metadata, token_code_hash: result.newHash! },
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
          error:
            error instanceof PaymentMethodError
              ? error.userMessage
              : error instanceof Error
                ? error.message
                : 'Failed to check token contract upgrade',
          isLoading: false,
        });
        return false;
      }
    },
  };
});

// Selectors for common queries
export const selectAddress = (state: WalletState) => state.connection?.address ?? null;
export const selectChainId = (state: WalletState) => state.connection?.chainId ?? null;
export const selectIsConnected = (state: WalletState) => state.connection?.isConnected ?? false;
