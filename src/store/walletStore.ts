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
  walletServiceManager,
  WalletConnection,
} from '../services/walletService';
import { networkService } from '../services/networkService';
import { ALL_NETWORKS, Network } from '../config/networks';

// ── Types ──────────────────────────────────────────────────────────

export interface NetworkMismatch {
  connectedChainId: number;
  preferredNetwork: Network;
}

interface WalletState {
  // Connection state — derived from walletServiceManager (single source of truth)
  address: string | null;
  chainId: number | null;
  network: string | null;
  isConnected: boolean;

  // Network detection (#69)
  preferredNetwork: Network | null;
  networkMismatch: NetworkMismatch | null;

  // Other wallet state
  cryptoStreams: CryptoStream[];
  paymentMethods: PaymentMethod[];
  paymentAttempts: PaymentAttempt[];
  isLoading: boolean;
  error: string | null;

  // Connection actions
  connectWallet: () => Promise<void>;
  syncWalletConnection: (payload: {
    address: string;
    chainId: number;
    network: string;
  }) => Promise<void>;
  disconnect: () => Promise<void>;
  updateBalance: () => Promise<void>;

  // Network actions (#69)
  setPreferredNetwork: (networkId: string) => Promise<void>;
  detectNetworkMismatch: () => void;

  // Stream actions
  createCryptoStream: (setup: StreamSetup) => Promise<void>;
  cancelCryptoStream: (streamId: string) => Promise<void>;
  fetchCryptoStreams: () => Promise<void>;

  // Payment method actions
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

// ── Constants ──────────────────────────────────────────────────────

const PAYMENT_METHODS_STORAGE_KEY = '@subtrackr_payment_methods';
const PAYMENT_ATTEMPTS_STORAGE_KEY = '@subtrackr_payment_attempts';

const paymentService = PaymentMethodService.getInstance();

// ── Helper: derive connection state from WalletServiceManager ──────

function connectionToState(conn: WalletConnection | null) {
  if (!conn || !conn.isConnected) {
    return { address: null, chainId: null, network: null, isConnected: false };
  }
  const networkName =
    ALL_NETWORKS.find((n) => n.chainId === conn.chainId)?.name ?? `Chain ${conn.chainId}`;
  return {
    address: conn.address,
    chainId: conn.chainId,
    network: networkName,
    isConnected: true,
  };
}

// ── Store ──────────────────────────────────────────────────────────

export const useWalletStore = create<WalletState>((set, get) => {
  // Subscribe to walletServiceManager so the store stays in sync (#62)
  walletServiceManager.addListener((conn) => {
    const connState = connectionToState(conn);
    set(connState);
    // Re-run mismatch detection whenever connection changes (#69)
    get().detectNetworkMismatch();
  });

  return {
    // Initial connection state from walletServiceManager
    ...connectionToState(walletServiceManager.getConnection()),

    // Network detection state
    preferredNetwork: null,
    networkMismatch: null,

    cryptoStreams: [],
    paymentMethods: [],
    paymentAttempts: [],
    isLoading: false,
    error: null,

    // ── Connection actions ─────────────────────────────────────────

    connectWallet: async () => {
      set({ isLoading: true, error: null });
      try {
        // Load persisted payment methods
        const savedMethods = await AsyncStorage.getItem(PAYMENT_METHODS_STORAGE_KEY);
        if (savedMethods) set({ paymentMethods: JSON.parse(savedMethods) });

        const savedAttempts = await AsyncStorage.getItem(PAYMENT_ATTEMPTS_STORAGE_KEY);
        if (savedAttempts) set({ paymentAttempts: JSON.parse(savedAttempts) });

        // walletServiceManager is the source of truth for connection;
        // if already connected, reflect that state now.
        const conn = walletServiceManager.getConnection();
        set({ ...connectionToState(conn), isLoading: false });
        get().detectNetworkMismatch();
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : 'Failed to connect wallet',
          isLoading: false,
        });
      }
    },

    syncWalletConnection: async ({ address, chainId, network }) => {
      // Update walletServiceManager — the listener will sync the store state
      walletServiceManager.setConnection({ address, chainId, isConnected: true });
      set({ isLoading: false, error: null });
    },

    disconnect: async () => {
      try {
        await walletServiceManager.disconnectWallet();
        // Listener will clear address/chainId/network/isConnected
        set({
          cryptoStreams: [],
          paymentMethods: [],
          paymentAttempts: [],
          networkMismatch: null,
        });
      } catch (error) {
        set({ error: 'Failed to disconnect wallet' });
      }
    },

    updateBalance: async () => {
      if (!get().isConnected) return;
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

    // ── Network actions (#69) ──────────────────────────────────────

    setPreferredNetwork: async (networkId: string) => {
      const success = await networkService.setSelectedNetwork(networkId);
      if (success) {
        const network = await networkService.getSelectedNetwork();
        set({ preferredNetwork: network });
        get().detectNetworkMismatch();
      }
    },

    detectNetworkMismatch: () => {
      const { chainId, preferredNetwork } = get();
      if (!chainId || !preferredNetwork) {
        set({ networkMismatch: null });
        return;
      }
      // Only EVM networks have chainId; Stellar wallets don't have a numeric chainId
      if (preferredNetwork.type !== 'evm' || preferredNetwork.chainId == null) {
        set({ networkMismatch: null });
        return;
      }
      if (chainId !== preferredNetwork.chainId) {
        set({ networkMismatch: { connectedChainId: chainId, preferredNetwork } });
      } else {
        set({ networkMismatch: null });
      }
    },

    // ── Stream actions ─────────────────────────────────────────────

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
        set((state) => ({ cryptoStreams: [...state.cryptoStreams, newStream], isLoading: false }));
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
          cryptoStreams: state.cryptoStreams.map((s) =>
            s.id === streamId ? { ...s, isActive: false } : s
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

    // ── Payment method actions ─────────────────────────────────────

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
        set({ paymentMethods: updatedMethods, isLoading: false });
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
        if (!method) throw new Error('Payment method not found');

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
        if (!method) throw new Error('Payment method not found');

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

        const updatedMethods = paymentMethods.map((m) =>
          m.id === result.attempt.paymentMethodId
            ? { ...m, lastUsedAt: new Date(), updatedAt: new Date() }
            : m
        );
        await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));

        const newAttempts = [...get().paymentAttempts, result.attempt, ...result.fallbackAttempts];
        await AsyncStorage.setItem(PAYMENT_ATTEMPTS_STORAGE_KEY, JSON.stringify(newAttempts));

        set({ paymentMethods: updatedMethods, paymentAttempts: newAttempts, isLoading: false });
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
      return {
        expired: paymentService.getExpiredMethods(paymentMethods).map((m) => paymentService.checkExpiry(m)),
        expiringSoon: paymentService.getExpiringSoonMethods(paymentMethods).map((m) => paymentService.checkExpiry(m)),
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
        if (!method) throw new Error('Payment method not found');

        const previousHash = method.metadata.token_code_hash ?? null;
        const result = await paymentService.detectTokenContractUpgrade(method, previousHash);

        if (result.newHash) {
          const updatedMethods = paymentMethods.map((m) =>
            m.id === id
              ? { ...m, metadata: { ...m.metadata, token_code_hash: result.newHash }, updatedAt: new Date() }
              : m
          );
          await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));
          set({ paymentMethods: updatedMethods });
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
  };
});
