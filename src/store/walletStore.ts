import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import {
  CryptoStream,
  StreamSetup,
  PaymentMethod,
  PaymentMethodFormData,
  PaymentPriority,
  PaymentAttempt,
  FallbackChain,
  FallbackChainValidation,
  PaymentMethodAnalytics,
  PaymentMethodExpiryAlert,
  PaymentMethodShare,
  PaymentMethodShareRole,
} from '../types/wallet';
import {
  WalletServiceManager,
  WalletConnection,
} from '../services/walletService';
import {
  PaymentMethodService,
  PaymentMethodError,
  PaymentMethodErrorCode,
  type ChainPaymentResult,
  type PaymentMethodExpiryCheck,
} from '../services/paymentMethodService';
import { Network } from '../config/networks';

// ── Types ──────────────────────────────────────────────────────────

export interface NetworkMismatch {
  connectedChainId: number;
  preferredNetwork: Network;
}

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

  // Fallback chains
  fallbackChains: FallbackChain[];
  createFallbackChain: (
    name: string,
    methodIds: string[],
    options?: Partial<Pick<FallbackChain, 'subscriptionId' | 'maxAttempts' | 'stopOnHardDecline'>>
  ) => FallbackChain;
  updateFallbackChain: (id: string, updates: Partial<FallbackChain>) => void;
  deleteFallbackChain: (id: string) => void;
  reorderFallbackChain: (id: string, methodIds: string[]) => void;
  validateFallbackChain: (id: string) => FallbackChainValidation | null;
  chainForSubscription: (subscriptionId: string) => FallbackChain | null;
  processPaymentWithChain: (
    subscriptionId: string,
    amount: string,
    chainId: number,
    maxGasPriceGwei?: number
  ) => Promise<ChainPaymentResult>;

  // Expiry alerts
  expiryAlerts: () => PaymentMethodExpiryAlert[];
  deactivateExpiredMethods: () => number;

  // Analytics
  paymentAnalytics: () => PaymentMethodAnalytics;

  // Sharing
  paymentMethodShares: PaymentMethodShare[];
  sharePaymentMethod: (
    methodId: string,
    granteeId: string,
    role: PaymentMethodShareRole,
    options?: { spendLimit?: string; expiresAt?: Date }
  ) => PaymentMethodShare;
  revokePaymentMethodShare: (shareId: string) => void;
  sharesForMethod: (methodId: string) => PaymentMethodShare[];
  methodsSharedWith: (granteeId: string) => PaymentMethod[];
}

const PAYMENT_STORAGE_KEY = '@subtrackr_payment_methods';

const walletService = WalletServiceManager.getInstance();
const paymentService = PaymentMethodService.getInstance();

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => {
      // Listen to wallet service connection changes
      walletService.addListener((connection) => {
        set({ connection });
      });

      return {
        connection: null,
        cryptoStreams: [],
        paymentMethods: [],
        paymentAttempts: [],
        fallbackChains: [],
        paymentMethodShares: [],
        isLoading: false,
        error: null,

        connectWallet: async () => {
          set({ isLoading: true, error: null });
          try {
            // Connection state is managed by walletService;
            // persisted payment methods and attempts are rehydrated automatically.
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
              // Chains and shares reference methods that are gone, so they go
              // with them rather than dangling.
              fallbackChains: [],
              paymentMethodShares: [],
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

            if (process.env.DEBUG_STORE) {
              // eslint-disable-next-line no-console
              console.log(
                'CANADD_T',
                typeof (paymentService as any).canAddMethod,
                'CTOR',
                JSON.stringify((paymentService as any).constructor?.name ?? 'plain'),
                'PROTO_KEYS',
                Object.getOwnPropertyNames(Object.getPrototypeOf(paymentService) ?? {}).length,
                'OWN_KEYS',
                JSON.stringify(Object.keys(paymentService))
              );
            }
            if (process.env.DEBUG_STORE) {
              // eslint-disable-next-line no-console
              console.log(
                'CANADD_T',
                typeof (paymentService as any).canAddMethod,
                'CTOR',
                JSON.stringify((paymentService as any).constructor?.name ?? 'plain'),
                'PROTO_KEYS',
                Object.getOwnPropertyNames(Object.getPrototypeOf(paymentService) ?? {}).length,
                'OWN_KEYS',
                JSON.stringify(Object.keys(paymentService))
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
              const verified = await paymentService.verifyPaymentMethod(newMethod);
              newMethod.isVerified = verified;
            }

            const updatedMethods = [...paymentMethods, newMethod];

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

            const newAttempts = [
              ...get().paymentAttempts,
              result.attempt,
              ...result.fallbackAttempts,
            ];

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

        // ── Fallback chains ────────────────────────────────────────────

        createFallbackChain: (name, methodIds, options = {}) => {
          const now = new Date();
          const chain: FallbackChain = {
            id: `chain_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name,
            methodIds,
            subscriptionId: options.subscriptionId ?? null,
            maxAttempts: options.maxAttempts ?? 0,
            stopOnHardDecline: options.stopOnHardDecline ?? false,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          };

          const validation = paymentService.validateChain(chain, get().paymentMethods);
          if (!validation.isValid) {
            const message = validation.errors.join('; ');
            set({ error: message });
            throw new PaymentMethodError(
              PaymentMethodErrorCode.FALLBACK_FAILED,
              message,
              'Fix the chain configuration and try again.'
            );
          }

          set((state) => ({ fallbackChains: [...state.fallbackChains, chain], error: null }));
          return chain;
        },

        updateFallbackChain: (id, updates) =>
          set((state) => ({
            fallbackChains: state.fallbackChains.map((chain) =>
              chain.id === id ? { ...chain, ...updates, updatedAt: new Date() } : chain
            ),
          })),

        deleteFallbackChain: (id) =>
          set((state) => ({
            fallbackChains: state.fallbackChains.filter((chain) => chain.id !== id),
          })),

        reorderFallbackChain: (id, methodIds) =>
          set((state) => ({
            fallbackChains: state.fallbackChains.map((chain) =>
              chain.id === id ? { ...chain, methodIds, updatedAt: new Date() } : chain
            ),
          })),

        validateFallbackChain: (id) => {
          const chain = get().fallbackChains.find((candidate) => candidate.id === id);
          if (!chain) return null;
          return paymentService.validateChain(chain, get().paymentMethods);
        },

        chainForSubscription: (subscriptionId) =>
          paymentService.selectChainForSubscription(get().fallbackChains, subscriptionId),

        processPaymentWithChain: async (subscriptionId, amount, chainId, maxGasPriceGwei = 500) => {
          set({ isLoading: true, error: null });
          try {
            const { paymentMethods } = get();
            // A merchant who has never configured a chain still gets one,
            // derived from the priority ordering.
            const chain =
              get().chainForSubscription(subscriptionId) ??
              paymentService.buildDefaultChain(paymentMethods);

            const result = await paymentService.processPaymentWithChain(
              chain,
              paymentMethods,
              subscriptionId,
              amount,
              chainId,
              maxGasPriceGwei
            );

            const attempts = [
              ...get().paymentAttempts,
              ...result.fallbackAttempts,
              ...(result.attempt ? [result.attempt] : []),
            ];

            set({
              paymentAttempts: attempts,
              paymentMethods: result.attempt
                ? paymentMethods.map((method) =>
                    method.id === result.attempt!.paymentMethodId
                      ? { ...method, lastUsedAt: new Date(), updatedAt: new Date() }
                      : method
                  )
                : paymentMethods,
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
                    : 'Chain payment failed',
              isLoading: false,
            });
            throw error;
          }
        },

        // ── Expiry alerts ──────────────────────────────────────────────

        expiryAlerts: () =>
          paymentService.buildExpiryAlerts(get().paymentMethods, get().fallbackChains),

        deactivateExpiredMethods: () => {
          const { paymentMethods } = get();
          const expired = new Set(
            paymentService.getExpiredMethods(paymentMethods).map((method) => method.id)
          );
          if (expired.size === 0) return 0;

          set({
            paymentMethods: paymentMethods.map((method) =>
              expired.has(method.id) ? paymentService.markPaymentMethodExpired(method) : method
            ),
          });
          return expired.size;
        },

        // ── Analytics ──────────────────────────────────────────────────

        paymentAnalytics: () =>
          paymentService.computeAnalytics(get().paymentMethods, get().paymentAttempts),

        // ── Sharing ────────────────────────────────────────────────────

        sharePaymentMethod: (methodId, granteeId, role, options = {}) => {
          const method = get().paymentMethods.find((candidate) => candidate.id === methodId);
          if (!method) {
            throw new PaymentMethodError(
              PaymentMethodErrorCode.INVALID_TOKEN,
              'Payment method not found.',
              'Refresh your payment methods and try again.'
            );
          }

          try {
            const share = paymentService.createShare(method, granteeId, role, options);
            set((state) => ({
              paymentMethodShares: [...state.paymentMethodShares, share],
              error: null,
            }));
            return share;
          } catch (error) {
            set({
              error: error instanceof PaymentMethodError ? error.userMessage : 'Failed to share',
            });
            throw error;
          }
        },

        revokePaymentMethodShare: (shareId) =>
          set((state) => ({
            paymentMethodShares: state.paymentMethodShares.map((share) =>
              share.id === shareId && share.revokedAt === null
                ? { ...share, revokedAt: new Date() }
                : share
            ),
          })),

        sharesForMethod: (methodId) =>
          get().paymentMethodShares.filter(
            (share) => share.methodId === methodId && paymentService.isShareActive(share)
          ),

        methodsSharedWith: (granteeId) =>
          paymentService.getSharedMethods(
            get().paymentMethods,
            get().paymentMethodShares,
            granteeId
          ),

        // ── Issue #922: Chain health & smart fallback selection ──────────

        rotationPolicies: [] as PaymentMethodRotationPolicy[],

        getChainHealthSnapshot: (chainId: string) => {
          const chain = get().fallbackChains.find((c) => c.id === chainId);
          if (!chain) return null;

          // Build lightweight attempt objects from stored PaymentAttempts.
          const recentAttempts = get().paymentAttempts.map((a) => ({
            paymentMethodId: a.paymentMethodId,
            success: a.success,
            timestamp: new Date(a.createdAt),
            latencyMs: undefined as number | undefined,
          }));

          return _chainHealthMonitor.snapshotChainHealth(
            chainId,
            chain.methodIds,
            recentAttempts
          );
        },

        getSmartFallbackSelection: (chainId: string) => {
          const snapshot = get().getChainHealthSnapshot(chainId);
          if (!snapshot) return null;

          const chain = get().fallbackChains.find((c) => c.id === chainId);
          if (!chain) return null;

          const policy =
            get().rotationPolicies.find((p) => p.chainId === chainId) ?? null;

          return _smartSelector.selectFallbackOrder(chain.methodIds, snapshot, policy);
        },

        getChainDiagnosticReport: (chainId: string) => {
          const snapshot = get().getChainHealthSnapshot(chainId);
          const selection = get().getSmartFallbackSelection(chainId);
          if (!snapshot || !selection) return null;
          return buildFallbackChainDiagnosticReport(snapshot, selection);
        },

        setRotationPolicy: (policy: PaymentMethodRotationPolicy) => {
          _chainHealthMonitor.setRotationPolicy(policy);
          set((state) => {
            const existing = state.rotationPolicies.findIndex(
              (p) => p.chainId === policy.chainId
            );
            const updated = [...state.rotationPolicies];
            if (existing >= 0) {
              updated[existing] = policy;
            } else {
              updated.push(policy);
            }
            return { rotationPolicies: updated };
          });
        },

        removeRotationPolicy: (chainId: string) =>
          set((state) => ({
            rotationPolicies: state.rotationPolicies.filter((p) => p.chainId !== chainId),
          })),

        applyAllRotationPolicies: () => {
          const { rotationPolicies, fallbackChains, paymentAttempts } = get();
          const updatedPolicies: PaymentMethodRotationPolicy[] = [];

          for (const policy of rotationPolicies) {
            const chain = fallbackChains.find((c) => c.id === policy.chainId);
            if (!chain) {
              updatedPolicies.push(policy);
              continue;
            }

            const recentAttempts = paymentAttempts.map((a) => ({
              paymentMethodId: a.paymentMethodId,
              success: a.success,
              timestamp: new Date(a.createdAt),
            }));

            const snapshot = _chainHealthMonitor.snapshotChainHealth(
              chain.id,
              chain.methodIds,
              recentAttempts
            );
            const applied = _chainHealthMonitor.applyRotationPolicy(policy, snapshot);
            updatedPolicies.push(applied);
          }

          set({ rotationPolicies: updatedPolicies });
        },
      };
    },
    {
      name: PAYMENT_STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      // Only persist payment configuration and history; connection and streams
      // are ephemeral.
      partialize: (state) => ({
        paymentMethods: state.paymentMethods,
        paymentAttempts: state.paymentAttempts,
        fallbackChains: state.fallbackChains,
        paymentMethodShares: state.paymentMethodShares,
        rotationPolicies: state.rotationPolicies,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[walletStore] Hydration error — resetting payment data:', error);
          useWalletStore.setState({
            paymentMethods: [],
            paymentAttempts: [],
            fallbackChains: [],
            paymentMethodShares: [],
          });
        }
      },
    }
  )
);

// Selectors for common queries
export const selectAddress = (state: WalletState) => state.connection?.address ?? null;
export const selectChainId = (state: WalletState) => state.connection?.chainId ?? null;
export const selectIsConnected = (state: WalletState) => state.connection?.isConnected ?? false;

// ═══════════════════════════════════════════════════════════════════════════
// Issue #922 enhancements — Fallback chain health & smart selection
// ═══════════════════════════════════════════════════════════════════════════
import {
  FallbackChainHealthMonitor,
  FallbackChainHealthSnapshot,
  SmartFallbackSelector,
  SmartFallbackSelection,
  PaymentMethodRotationPolicy,
  buildFallbackChainDiagnosticReport,
} from '../services/walletService';

const _chainHealthMonitor = FallbackChainHealthMonitor.getInstance();
const _smartSelector = SmartFallbackSelector.getInstance();

/**
 * Extend the WalletState interface with chain health & smart selection.
 *
 * These are computed on demand (not persisted) so they live outside the
 * persisted slice.
 */
declare module './walletStore' {
  interface WalletState {
    // ── Chain health ─────────────────────────────────────────────────────
    /** Compute and return the health snapshot for a specific chain. */
    getChainHealthSnapshot: (chainId: string) => FallbackChainHealthSnapshot | null;
    /** Return a smart-selected fallback order for a chain execution. */
    getSmartFallbackSelection: (chainId: string) => SmartFallbackSelection | null;
    /** Build a human-readable diagnostic report for a chain. */
    getChainDiagnosticReport: (chainId: string) => string | null;
    // ── Rotation policies ────────────────────────────────────────────────
    rotationPolicies: PaymentMethodRotationPolicy[];
    setRotationPolicy: (policy: PaymentMethodRotationPolicy) => void;
    removeRotationPolicy: (chainId: string) => void;
    applyAllRotationPolicies: () => void;
  }
}
