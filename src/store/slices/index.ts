/**
 * slices/index.ts — Combined root store (slices pattern).
 *
 * Composes all domain slices into a single `useAppStore`. Each slice is
 * defined independently in its own file (authSlice, userSlice, settingsSlice,
 * networkSlice, transactionSlice, ...) — giving modularity and type-safety —
 * and then composed here.
 *
 * Persistence: the combined store persists a single JSON blob under one key.
 * `partialize` whitelists the persisted fields so ephemeral state (isLoading,
 * error) is excluded — matching the behaviour of the original singleton
 * stores. Existing legacy stores re-read their slice from this store, so no
 * consumers are broken.
 */

import { create } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';
import { asyncStorageAdapter, localStorageAdapter } from '../../utils/storage';

import { createAuthSlice } from './authSlice';
import { createUserSlice } from './userSlice';
import { createSettingsSlice } from './settingsSlice';
import { createNetworkSlice } from './networkSlice';
import { createTransactionSlice } from './transactionSlice';
import { createSearchSlice } from './searchSlice';
import { createCreditSlice } from './creditSlice';
import { createMeteringSlice } from './meteringSlice';
import { createPaymentSlice } from './paymentSlice';
import { createBatchSlice } from './batchSlice';
import { createAnalyticsSlice } from './analyticsSlice';
import type { AppState } from './state';

export type { AppState } from './state';
export type { AuthUser, AuthSlice, AuthStoreState } from './authSlice';
export type { UserSlice, UserStoreState, ConsentState } from './userSlice';
export type { SettingsSlice, SettingsStoreState } from './settingsSlice';
export type { NetworkSlice, NetworkStoreState } from './networkSlice';
export type { TransactionSlice, TransactionStoreState } from './transactionSlice';
export type { SearchSlice, SearchStoreState } from './searchSlice';
export type {
  CreditSlice,
  CreditStoreState,
  CreditTxKind,
  ExpirationPolicy,
  CreditLot,
  CreditTransaction,
  AccountCredit,
  CreditApplied,
  PrepaymentWallet,
  PrepaymentTxKind,
  PrepaymentTransaction,
  PrepaymentSnapshot,
} from './creditSlice';
export type {
  MeteringSlice,
  MeteringStoreState,
  MeteredUsage,
  UsageBucket,
  MeterState,
  ChargeLine,
  Charge,
  TimeRange,
  UsageAlertEntry,
  UsageTrend,
  UsageAnalytics,
} from './meteringSlice';
export { DEFAULT_PERIOD_SECS, bucketStart, billableUnits } from './meteringSlice';
export type {
  PaymentSlice,
  PaymentStoreState,
  PaymentPriority,
  PaymentMethod,
  PaymentFailureReason,
  PaymentAttemptResult,
  FallbackChain,
  ChainValidation,
  ExpiryAlertSeverity,
  ExpiryAlert,
  PaymentMethodStats,
  PaymentAnalytics,
} from './paymentSlice';
export { MAX_CHAIN_LENGTH, EXPIRY_CRITICAL_DAYS } from './paymentSlice';
export type {
  BatchSlice,
  BatchStoreState,
  BatchDraft,
  ItemExecutor,
  BatchOperationType,
  BatchState,
  PerItemStatus,
  CancelReason,
  UpdateFilter,
  BatchUpdateParams,
  BatchCreateInput,
  PerItemResult,
  BatchProgress,
  BatchHistoryEntry,
  BatchOperationConfig,
  BatchAnalytics,
  BatchAnalyticsSummary,
  BatchRollbackResult,
  BatchSizeValidation,
  RollbackHandler,
} from './batchSlice';
export {
  estimateBatchGas,
  validateBatchSize,
  exportBatchResultToJson,
  exportBatchResultToCsv,
  getBatchHistory,
  saveBatchHistory,
  clearPersistedBatchHistory,
  computeBatchAnalytics,
  getDefaultBatchConfig,
  validateBatchSizeFor,
  DEFAULT_BATCH_CONFIGS,
} from './batchSlice';
export type { AnalyticsSlice, AnalyticsStoreState, CreditMetricSnapshot } from './analyticsSlice';
export { DEFAULT_WIDGETS, computeCreditSnapshot } from './analyticsSlice';

// ─────────────────────────────────────────────────────────────────────────────
// Storage selection: pick the correct adapter for the runtime environment.
// Mobile uses AsyncStorage; web/developer-portal use localStorage.
// ─────────────────────────────────────────────────────────────────────────────

const isWeb = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const storage: StateStorage = isWeb ? localStorageAdapter : asyncStorageAdapter;

/**
 * `useAppStore` — single source of truth for all app slices.
 *
 * Consumers may subscribe to a slice with a selector, e.g.
 * `const token = useAppStore(selectAuthToken)`.
 */
export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...createAuthSlice(set, get),
      ...createUserSlice(set, get),
      ...createSettingsSlice(set, get),
      ...createNetworkSlice(set, get),
      ...createTransactionSlice(set, get),
      ...createSearchSlice(set, get),
      ...createCreditSlice(set, get),
      ...createMeteringSlice(set, get),
      ...createPaymentSlice(set, get),
      ...createBatchSlice(set, get),
      ...createAnalyticsSlice(set, get),
    }),
    {
      name: 'subtrackr-app-store',
      version: 1,
      storage: createJSONStorage(() => storage),
      partialize: (state): Partial<AppState> => ({
        token: state.token,
        userId: state.userId,
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        subscriptionTier: state.subscriptionTier,
        consent: state.consent,
        preferredCurrency: state.preferredCurrency,
        notificationsEnabled: state.notificationsEnabled,
        exchangeRates: state.exchangeRates,
        healthScoreWeights: state.healthScoreWeights,
        currentNetwork: state.currentNetwork,
        transactions: state.transactions,
        savedSearches: state.savedSearches,
        accounts: state.accounts,
        nextId: state.nextId,
        wallets: state.wallets,
        nextWalletId: state.nextWalletId,
        walletTransactionIds: state.walletTransactionIds,
        history: state.history,
        configs: state.configs,
        methods: state.methods,
        attemptLog: state.attemptLog,
        chains: state.chains,
      }),
    }
  )
);

// ─────────────────────────────────────────────────────────────────────────────
// Cross-slice selectors
// ─────────────────────────────────────────────────────────────────────────────

export const selectAuthToken = (s: AppState) => s.token;
export const selectIsAuthenticated = (s: AppState) => s.isAuthenticated;
export const selectUserId = (s: AppState) => s.userId;
export const selectUser = (s: AppState) => s.user;
export const selectPreferredCurrency = (s: AppState) => s.preferredCurrency;
export const selectCurrentNetwork = (s: AppState) => s.currentNetwork;
export const selectTransactions = (s: AppState) => s.transactions;
export const selectSubscriptionTier = (s: AppState) => s.subscriptionTier;
export const selectSearchQueryText = (s: AppState) => s.queryText;
export const selectSavedSearches = (s: AppState) => s.savedSearches;
