/**
 * Wallet Slice – wallet connection, crypto streams, payment methods,
 * transaction queue, and merchant onboarding.
 */
import type { StateCreator } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Wallet, CryptoStream, StreamSetup, PaymentMethod, PaymentMethodFormData,
  PaymentPriority, PaymentAttempt,
} from '../../types/wallet';
import { MerchantOnboarding, MerchantOnboardingFormData, OnboardingStep, OnboardingStatus, VerificationTier, MerchantDocument, DocumentType } from '../../types/merchant';
import { QueuedTransaction, QueuedTransactionPayload, ExecuteOrQueueResult } from './transactionQueueTypes';

const WALLET_STORAGE_KEY = '@subtrackr_wallet';
const PAYMENT_METHODS_STORAGE_KEY = '@subtrackr_payment_methods';
const PAYMENT_ATTEMPTS_STORAGE_KEY = '@subtrackr_payment_attempts';

// ── Interfaces ──────────────────────────────────────────────────────────

export interface WalletSlice {
  wallet: Wallet | null;
  walletAddress: string | null;
  walletNetwork: string | null;
  cryptoStreams: CryptoStream[];
  paymentMethods: PaymentMethod[];
  paymentAttempts: PaymentAttempt[];
  walletLoading: boolean;
  walletError: string | null;
  connectWallet: () => Promise<void>;
  syncWalletConnection: (payload: { address: string; chainId: number; network: string }) => Promise<void>;
  disconnectWallet: () => Promise<void>;
  updateBalance: () => Promise<void>;
  createCryptoStream: (setup: StreamSetup) => Promise<void>;
  cancelCryptoStream: (streamId: string) => Promise<void>;
  fetchCryptoStreams: () => Promise<void>;
  addPaymentMethod: (data: PaymentMethodFormData) => Promise<PaymentMethod>;
  removePaymentMethod: (id: string) => Promise<void>;
  updatePaymentMethod: (id: string, updates: Partial<PaymentMethod>) => Promise<void>;
  verifyPaymentMethod: (id: string) => Promise<boolean>;
  setPaymentMethodPriority: (id: string, priority: PaymentPriority) => Promise<void>;
  processPayment: (subscriptionId: string, amount: string, chainId: number, maxGasPriceGwei?: number) => Promise<{ success: boolean; attempt: PaymentAttempt; fallbackAttempts: PaymentAttempt[] }>;
  getExpiryInfo: () => { expired: any[]; expiringSoon: any[] };
  getPaymentMethodsByPriority: () => { primary: PaymentMethod[]; backup: PaymentMethod[]; fallback: PaymentMethod[] };
  checkTokenContractUpgrade: (id: string) => Promise<boolean>;
}

export interface TransactionQueueSlice {
  isOnline: boolean;
  isProcessing: boolean;
  queuedTransactions: QueuedTransaction[];
  queueLastError: string | null;
  initializeConnectivityListener: () => () => void;
  refreshConnectivity: () => Promise<void>;
  queueTransaction: (payload: QueuedTransactionPayload, errorMessage?: string) => Promise<{ transactionId: string; replacedExisting: boolean }>;
  executeOrQueueTransaction: (payload: QueuedTransactionPayload) => Promise<ExecuteOrQueueResult>;
  processQueue: () => Promise<void>;
  clearQueue: () => void;
  removeTransaction: (transactionId: string) => void;
}

export interface MerchantSlice {
  merchantOnboarding: MerchantOnboarding | null;
  merchantLoading: boolean;
  merchantError: string | null;
  startOnboarding: (data: MerchantOnboardingFormData) => Promise<void>;
  submitDocument: (docType: DocumentType, uri: string) => Promise<void>;
  nextStep: () => Promise<void>;
  previousStep: () => Promise<void>;
  requestVerification: () => Promise<void>;
  approveVerification: (tier: VerificationTier, notes?: string) => Promise<void>;
  rejectVerification: (reason: string) => Promise<void>;
  getOnboardingStatus: () => OnboardingStatus;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const generateUniqueId = (): string => {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rand}`;
};

const getDefaultSteps = (): OnboardingStep[] => [
  OnboardingStep.BUSINESS_INFO,
  OnboardingStep.ID_DOCUMENT,
  OnboardingStep.BUSINESS_LICENSE,
  OnboardingStep.REVIEW,
];

type WalletStore = WalletSlice & TransactionQueueSlice & MerchantSlice;
type WalletCreator = StateCreator<WalletStore & any, [], [], WalletStore>;

// ═══════════════════════════════════════════════════════════════════════════
// Slice Factory
// ═══════════════════════════════════════════════════════════════════════════

export const createWalletSlice: WalletCreator = (set, get) => ({
  // ── Wallet state ──────────────────────────────────────────────────
  wallet: null,
  walletAddress: null,
  walletNetwork: null,
  cryptoStreams: [],
  paymentMethods: [],
  paymentAttempts: [],
  walletLoading: false,
  walletError: null,

  connectWallet: async () => {
    set({ walletLoading: true, walletError: null });
    try {
      const savedWallet = await AsyncStorage.getItem(WALLET_STORAGE_KEY);
      if (savedWallet) {
        const parsed = JSON.parse(savedWallet);
        set({
          walletAddress: parsed.address, walletNetwork: parsed.network, wallet: parsed.wallet, walletLoading: false,
        });
        const savedMethods = await AsyncStorage.getItem(PAYMENT_METHODS_STORAGE_KEY);
        if (savedMethods) set({ paymentMethods: JSON.parse(savedMethods) });
        const savedAttempts = await AsyncStorage.getItem(PAYMENT_ATTEMPTS_STORAGE_KEY);
        if (savedAttempts) set({ paymentAttempts: JSON.parse(savedAttempts) });
        return;
      }
      const mockWallet: Wallet = {
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fAb1', chainId: 1, isConnected: true, balance: '0.5',
        tokens: [{ symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000', balance: '0.5', decimals: 18 }],
      };
      await AsyncStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({ address: mockWallet.address, network: 'Ethereum Mainnet', wallet: mockWallet }));
      set({ wallet: mockWallet, walletAddress: mockWallet.address, walletNetwork: 'Ethereum Mainnet', walletLoading: false });
    } catch (error) {
      set({ walletError: error instanceof Error ? error.message : 'Failed to connect wallet', walletLoading: false });
    }
  },

  syncWalletConnection: async ({ address, chainId, network }) => {
    const walletData = { address, network, wallet: { address, chainId, isConnected: true, balance: '0', tokens: [] } as Wallet };
    await AsyncStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(walletData));
    set({ wallet: walletData.wallet, walletAddress: address, walletNetwork: network, walletLoading: false, walletError: null });
  },

  disconnectWallet: async () => {
    try {
      await AsyncStorage.removeItem(WALLET_STORAGE_KEY);
      set({ wallet: null, walletAddress: null, walletNetwork: null, cryptoStreams: [], paymentMethods: [], paymentAttempts: [] });
    } catch { set({ walletError: 'Failed to disconnect wallet' }); }
  },

  updateBalance: async () => {
    set({ walletLoading: true, walletError: null });
    try { await new Promise((resolve) => setTimeout(resolve, 500)); set({ walletLoading: false }); }
    catch (error) { set({ walletError: error instanceof Error ? error.message : 'Failed to update balance', walletLoading: false }); }
  },

  createCryptoStream: async (setup) => {
    set({ walletLoading: true, walletError: null });
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const newStream: CryptoStream = { id: Date.now().toString(), subscriptionId: 'temp', ...setup, isActive: true, streamId: `stream_${Date.now()}` };
      set((s) => ({ cryptoStreams: [...s.cryptoStreams, newStream], walletLoading: false }));
    } catch (error) {
      set({ walletError: error instanceof Error ? error.message : 'Failed to create crypto stream', walletLoading: false });
    }
  },

  cancelCryptoStream: async (streamId) => {
    set({ walletLoading: true, walletError: null });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      set((s) => ({ cryptoStreams: s.cryptoStreams.map((st) => st.id === streamId ? { ...st, isActive: false } : st), walletLoading: false }));
    } catch (error) {
      set({ walletError: error instanceof Error ? error.message : 'Failed to cancel crypto stream', walletLoading: false });
    }
  },

  fetchCryptoStreams: async () => {
    set({ walletLoading: true, walletError: null });
    try { await new Promise((resolve) => setTimeout(resolve, 1000)); set({ walletLoading: false }); }
    catch (error) { set({ walletError: error instanceof Error ? error.message : 'Failed to fetch crypto streams', walletLoading: false }); }
  },

  addPaymentMethod: async (data) => {
    set({ walletLoading: true, walletError: null });
    try {
      const method: PaymentMethod = {
        id: generateUniqueId(), userId: get().walletAddress ?? 'unknown', tokenType: data.tokenType,
        tokenAddress: data.tokenAddress, chainId: data.chainId, label: data.label, priority: data.priority,
        maxSpendPerInterval: data.maxSpendPerInterval, isVerified: data.tokenType === 'NATIVE',
        isActive: true, expiresAt: null, lastUsedAt: null, createdAt: new Date(), updatedAt: new Date(), metadata: {},
      } as PaymentMethod;
      const updatedMethods = [...get().paymentMethods, method];
      await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));
      set({ paymentMethods: updatedMethods, walletLoading: false });
      return method;
    } catch (error) {
      set({ walletError: error instanceof Error ? error.message : 'Failed to add payment method', walletLoading: false });
      throw error;
    }
  },

  removePaymentMethod: async (id) => {
    set({ walletLoading: true, walletError: null });
    try {
      const updatedMethods = get().paymentMethods.filter((m) => m.id !== id);
      await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));
      set({ paymentMethods: updatedMethods, walletLoading: false });
    } catch (error) { set({ walletError: error instanceof Error ? error.message : 'Failed to remove payment method', walletLoading: false }); }
  },

  updatePaymentMethod: async (id, updates) => {
    set({ walletLoading: true, walletError: null });
    try {
      const updatedMethods = get().paymentMethods.map((m) => m.id === id ? { ...m, ...updates, updatedAt: new Date() } : m);
      await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));
      set({ paymentMethods: updatedMethods, walletLoading: false });
    } catch (error) { set({ walletError: error instanceof Error ? error.message : 'Failed to update payment method', walletLoading: false }); }
  },

  verifyPaymentMethod: async (id) => {
    set({ walletLoading: true, walletError: null });
    try {
      const method = get().paymentMethods.find((m) => m.id === id);
      if (!method) throw new Error('Payment method not found');
      set({ walletLoading: false });
      return true;
    } catch (error) { set({ walletError: error instanceof Error ? error.message : 'Failed to verify payment method', walletLoading: false }); throw error; }
  },

  setPaymentMethodPriority: async (id, priority) => {
    set({ walletLoading: true, walletError: null });
    try {
      const updatedMethods = get().paymentMethods.map((m) => m.id === id ? { ...m, priority, updatedAt: new Date() } : m);
      await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, JSON.stringify(updatedMethods));
      set({ paymentMethods: updatedMethods, walletLoading: false });
    } catch (error) { set({ walletError: error instanceof Error ? error.message : 'Failed to update priority', walletLoading: false }); }
  },

  processPayment: async (subscriptionId, amount, chainId, maxGasPriceGwei = 500) => {
    set({ walletLoading: true, walletError: null });
    try {
      const attempt: PaymentAttempt = {
        id: `attempt-${Date.now()}`, paymentMethodId: get().paymentMethods[0]?.id ?? 'mock',
        token: 'ETH', amount, chainId, status: 'success', gasPriceGwei: maxGasPriceGwei,
        timestamp: Date.now(),
      } as PaymentAttempt;
      const newAttempts = [...get().paymentAttempts, attempt];
      await AsyncStorage.setItem(PAYMENT_ATTEMPTS_STORAGE_KEY, JSON.stringify(newAttempts));
      set({ paymentAttempts: newAttempts, walletLoading: false });
      return { success: true, attempt, fallbackAttempts: [] };
    } catch (error) {
      set({ walletError: error instanceof Error ? error.message : 'Payment processing failed', walletLoading: false });
      throw error;
    }
  },

  getExpiryInfo: () => ({ expired: [], expiringSoon: [] }),
  getPaymentMethodsByPriority: () => {
    const methods = get().paymentMethods;
    return { primary: methods.filter((m) => m.priority === 'primary'), backup: methods.filter((m) => m.priority === 'backup'), fallback: methods.filter((m) => !m.priority || m.priority === 'fallback') };
  },
  checkTokenContractUpgrade: async (_id) => false,

  // ── Transaction Queue state ─────────────────────────────────────
  isOnline: true,
  isProcessing: false,
  queuedTransactions: [],
  queueLastError: null,

  initializeConnectivityListener: () => {
    return () => {};
  },

  refreshConnectivity: async () => {
    set({ isOnline: true });
    if (!get().isOnline) { set({ isOnline: true }); void get().processQueue(); }
  },

  queueTransaction: async (payload, errorMessage) => {
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let replacedExisting = false;
    set((s) => {
      const existing = s.queuedTransactions.find((tx) => tx.conflictKey === payload.protocol + payload.recipientAddress);
      const nextQueue = s.queuedTransactions.filter((tx) => tx.conflictKey !== (existing?.conflictKey ?? ''));
      if (existing) replacedExisting = true;
      const queued: QueuedTransaction = {
        id: transactionId, createdAt: Date.now(), updatedAt: Date.now(), attempts: 0,
        conflictKey: payload.protocol + payload.recipientAddress, status: 'pending' as const,
        payload: payload as any, lastError: errorMessage,
      };
      return { queuedTransactions: [...nextQueue, queued], queueLastError: errorMessage ?? null };
    });
    return { transactionId, replacedExisting };
  },

  executeOrQueueTransaction: async (payload) => {
    if (!get().isOnline) {
      const queued = await get().queueTransaction(payload, 'Device is offline.');
      return { queued: true, transactionId: queued.transactionId };
    }
    return { queued: false, transactionId: `executed_${Date.now()}` };
  },

  processQueue: async () => {
    if (get().isProcessing || !get().isOnline) return;
    set({ isProcessing: true, queueLastError: null });
    try {
      const sorted = [...get().queuedTransactions].sort((a, b) => a.createdAt - b.createdAt);
      for (const tx of sorted) {
        if (!get().isOnline) break;
        set((s) => ({ queuedTransactions: s.queuedTransactions.filter((q) => q.id !== tx.id) }));
      }
    } finally { set({ isProcessing: false }); }
  },

  clearQueue: () => set({ queuedTransactions: [], queueLastError: null }),
  removeTransaction: (transactionId) => set((s) => ({ queuedTransactions: s.queuedTransactions.filter((tx) => tx.id !== transactionId) })),

  // ── Merchant state ───────────────────────────────────────────────
  merchantOnboarding: null,
  merchantLoading: false,
  merchantError: null,

  startOnboarding: async (data) => {
    set({ merchantLoading: true, merchantError: null });
    try {
      const newOnboarding: MerchantOnboarding = {
        id: generateUniqueId(), merchantAddress: data.email, steps: getDefaultSteps(),
        currentStep: OnboardingStep.BUSINESS_INFO, status: OnboardingStatus.IN_PROGRESS,
        documents: [], startedAt: new Date(), updatedAt: new Date(),
      };
      set({ merchantOnboarding: newOnboarding, merchantLoading: false });
    } catch (error) {
      set({ merchantError: error instanceof Error ? error.message : 'Failed to start onboarding', merchantLoading: false });
    }
  },

  submitDocument: async (docType, uri) => {
    set({ merchantLoading: true, merchantError: null });
    try {
      const onboarding = get().merchantOnboarding;
      if (!onboarding) throw new Error('No onboarding in progress');
      const newDoc: MerchantDocument = { id: generateUniqueId(), type: docType, uri, uploadedAt: new Date(), status: 'pending' };
      set({ merchantOnboarding: { ...onboarding, documents: [...onboarding.documents, newDoc], updatedAt: new Date() }, merchantLoading: false });
    } catch (error) {
      set({ merchantError: error instanceof Error ? error.message : 'Failed to submit document', merchantLoading: false });
    }
  },

  nextStep: async () => {
    const onboarding = get().merchantOnboarding;
    if (!onboarding) return;
    const currentIndex = onboarding.steps.indexOf(onboarding.currentStep);
    if (currentIndex >= onboarding.steps.length - 1) return;
    const currentStep = onboarding.steps[currentIndex + 1];
    const newStatus = currentStep === OnboardingStep.REVIEW ? OnboardingStatus.PENDING_REVIEW : OnboardingStatus.IN_PROGRESS;
    set({ merchantOnboarding: { ...onboarding, currentStep, status: newStatus, updatedAt: new Date() } });
  },

  previousStep: async () => {
    const onboarding = get().merchantOnboarding;
    if (!onboarding) return;
    const currentIndex = onboarding.steps.indexOf(onboarding.currentStep);
    if (currentIndex <= 0) return;
    set({ merchantOnboarding: { ...onboarding, currentStep: onboarding.steps[currentIndex - 1], status: OnboardingStatus.IN_PROGRESS, updatedAt: new Date() } });
  },

  requestVerification: async () => {
    const onboarding = get().merchantOnboarding;
    if (!onboarding) return;
    set({ merchantOnboarding: { ...onboarding, status: OnboardingStatus.PENDING_REVIEW, updatedAt: new Date() } });
  },

  approveVerification: async (tier, notes) => {
    const onboarding = get().merchantOnboarding;
    if (!onboarding) return;
    const limits = tier === VerificationTier.ENHANCED ? { monthlyVolume: 1000000, maxTransactions: 10000 } : { monthlyVolume: 10000, maxTransactions: 100 };
    set({ merchantOnboarding: { ...onboarding, status: OnboardingStatus.VERIFIED, verificationResult: { isVerified: true, tier, reviewedAt: new Date(), reviewerNotes: notes, limits }, updatedAt: new Date() } });
  },

  rejectVerification: async (reason) => {
    const onboarding = get().merchantOnboarding;
    if (!onboarding) return;
    set({ merchantOnboarding: { ...onboarding, status: OnboardingStatus.REJECTED, verificationResult: { isVerified: false, tier: VerificationTier.BASIC, reviewedAt: new Date(), reviewerNotes: reason, limits: { monthlyVolume: 0, maxTransactions: 0 } }, updatedAt: new Date() } });
  },

  getOnboardingStatus: () => get().merchantOnboarding?.status ?? OnboardingStatus.NOT_STARTED,
});
