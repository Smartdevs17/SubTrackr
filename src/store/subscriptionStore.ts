import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Subscription, // eslint-disable-line
  SubscriptionFormData,
  SubscriptionStats,
  SubscriptionCategory, // eslint-disable-line
  BillingCycle, // eslint-disable-line
} from '../types/subscription';
import {
  CreditAccountState,
  CreditApplicationResult,
  CreditPolicy,
  CreditPurchaseInput,
  CreditTransferInput,
} from '../types/credit';
import { InvoiceStatus, isOpenInvoice } from '../types/invoice';
import { dummySubscriptions } from '../utils/dummyData'; // eslint-disable-line
import { advanceBillingDate } from '../utils/billingDate';
import { buildBillingPeriod } from '../utils/invoice';
import { BILLING_CONVERSIONS, CACHE_CONSTANTS } from '../utils/constants/values';
import {
  syncRenewalReminders,
  presentChargeSuccessNotification,
  presentChargeFailedNotification,
  presentLocalNotification,
  presentDunningRetryNotification,
  presentDunningWarningNotification,
  presentDunningSuspendedNotification,
  presentDunningCancelledNotification,
  presentDunningRecoveryNotification,
} from '../services/notificationService';
import { useCalendarStore } from './calendarStore';
import { useGamificationStore } from './gamificationStore';
import { useInvoiceStore } from './invoiceStore';
import { AchievementTrigger } from '../types/gamification';
import { errorHandler, AppError } from '../services/errorHandler';
import { useSettingsStore } from './settingsStore';
import { currencyService } from '../services/currencyService';
import { useSupportStore } from './supportStore';
import { buildSupportEventMessage } from '../services/ticketingService';
import { SubscriptionSupportContext, TicketIssueType } from '../types/support';
import {
  applyCreditToInvoice,
  buildCreditAccount,
  expireCredits,
  normalizeCreditAccount,
  purchaseCredit,
  transferCredit,
} from '../services/creditService';
import { useUserStore } from './userStore';
import {
  previewProration,
  calculateNetProration,
  generateCreditMemo,
  applyCreditMemo,
  ProrationPreview,
  CreditMemo,
} from '../utils/proration';

const STORAGE_KEY = 'subtrackr-subscriptions';
const STORE_VERSION = 2;
const WRITE_DEBOUNCE_MS = CACHE_CONSTANTS.WRITE_DEBOUNCE_MS;

/**
 * Generate a unique ID for subscriptions
 * Uses timestamp + random component to prevent collisions
 */
const generateUniqueId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomComponent}`;
};

type PersistedSubscriptionSlice = Pick<SubscriptionState, 'subscriptions' | 'creditAccounts'>;

const toValidDate = (value: unknown, fallback = new Date()): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
};

const normalizeSubscription = (raw: Partial<Subscription>): Subscription => {
  const now = new Date();
  return {
    id: raw.id ?? generateUniqueId(),
    name: raw.name ?? 'Untitled',
    description: raw.description,
    category: raw.category ?? SubscriptionCategory.OTHER,
    price: Number.isFinite(raw.price) ? (raw.price as number) : 0,
    currency: raw.currency ?? 'USD',
    billingCycle: raw.billingCycle ?? BillingCycle.MONTHLY,
    nextBillingDate: toValidDate(raw.nextBillingDate, now),
    isActive: raw.isActive ?? true,
    notificationsEnabled: raw.notificationsEnabled ?? true,
    isCryptoEnabled: raw.isCryptoEnabled ?? false,
    cryptoStreamId: raw.cryptoStreamId,
    cryptoToken: raw.cryptoToken,
    cryptoAmount: raw.cryptoAmount,
    createdAt: toValidDate(raw.createdAt, now),
    updatedAt: toValidDate(raw.updatedAt, now),
  };
};

const getDefaultAccountId = (): string => {
  const { user } = useUserStore.getState();
  return user?.id ?? user?.email ?? 'local-user';
};

const getDefaultCurrency = (): string => {
  const { preferredCurrency } = useSettingsStore.getState();
  return preferredCurrency ?? 'USD';
};

const ensureCreditAccount = (
  accounts: Record<string, CreditAccountState>,
  accountId: string,
  currency = getDefaultCurrency(),
  policy?: Partial<CreditPolicy>
): Record<string, CreditAccountState> => {
  if (accounts[accountId]) return accounts;
  return {
    ...accounts,
    [accountId]: buildCreditAccount(accountId, currency, policy),
  };
};

const buildSupportContext = (
  subscription: Subscription,
  history: string[]
): SubscriptionSupportContext => ({
  subscriptionName: subscription.name,
  planName: subscription.name,
  planTier: subscription.category,
  billingCycle: subscription.billingCycle,
  status: subscription.isActive ? 'active' : 'paused',
  amount: subscription.price,
  currency: subscription.currency,
  createdAt: subscription.createdAt.toISOString(),
  nextBillingDate:
    subscription.nextBillingDate?.toISOString?.() ??
    new Date(subscription.nextBillingDate).toISOString(),
  failedPayments: subscription.chargeCount ? Math.max(subscription.chargeCount - 1, 0) : 0,
  chargeCount: subscription.chargeCount ?? 0,
  history,
});

const createSupportEvent = (
  subscription: Subscription,
  issueType: TicketIssueType,
  history: string[],
  actorId = 'system'
) => {
  const context = buildSupportContext(subscription, history);
  return {
    subscriptionId: subscription.id,
    issueType,
    message: buildSupportEventMessage(context, issueType),
    occurredAt: new Date(),
    context,
    dedupeKey: `${subscription.id}:${issueType}`,
    actorId,
  };
};

const applyCreditsAcrossOpenInvoices = async (
  state: SubscriptionState,
  accountId: string,
  subscriptionId?: string
): Promise<{ applications: CreditApplicationResult[]; account: CreditAccountState }> => {
  const invoiceStore = useInvoiceStore.getState();
  const account =
    state.creditAccounts[accountId] ?? buildCreditAccount(accountId, getDefaultCurrency());
  if (!subscriptionId) {
    return {
      applications: [],
      account,
    };
  }
  const openInvoices = invoiceStore.invoices
    .filter((invoice) => invoice.subscriptionId === subscriptionId && isOpenInvoice(invoice.status))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let workingAccount = account;
  const applications: CreditApplicationResult[] = [];

  for (const invoice of openInvoices) {
    if (workingAccount.balance <= 0) break;

    const result = applyCreditToInvoice(workingAccount, {
      invoiceId: invoice.id,
      subscriptionId,
      invoiceTotal: invoice.total,
      currency: invoice.currency,
      reference: `auto-apply:${invoice.invoiceNumber}`,
      note: 'Auto-applied to open invoice',
      expectedRevision: workingAccount.revision,
    });

    if (!result.application || result.appliedAmount <= 0) continue;

    workingAccount = result.account;
    applications.push(result);
    await invoiceStore.updateInvoiceStatus(
      invoice.id,
      result.remainingDue > 0 ? InvoiceStatus.PARTIAL : InvoiceStatus.PAID
    );
  }

  return {
    applications,
    account: workingAccount,
  };
};

const serializeForStorage = (state: PersistedSubscriptionSlice): PersistedSubscriptionSlice => ({
  subscriptions: state.subscriptions.map((sub) => ({
    ...sub,
    nextBillingDate: new Date(sub.nextBillingDate),
    createdAt: new Date(sub.createdAt),
    updatedAt: new Date(sub.updatedAt),
  })),
  creditAccounts: Object.fromEntries(
    Object.entries(state.creditAccounts ?? {}).map(([accountId, account]) => [
      accountId,
      {
        ...account,
        nextExpirationAt: account.nextExpirationAt ? new Date(account.nextExpirationAt) : null,
        lots: account.lots.map((lot) => ({
          ...lot,
          createdAt: new Date(lot.createdAt),
          expiresAt: lot.expiresAt ? new Date(lot.expiresAt) : null,
        })),
        ledger: account.ledger.map((entry) => ({
          ...entry,
          createdAt: new Date(entry.createdAt),
          expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null,
        })),
        applications: account.applications.map((entry) => ({
          ...entry,
          createdAt: new Date(entry.createdAt),
        })),
      },
    ])
  ) as Record<string, CreditAccountState>,
});

const migratePersistedState = (
  persisted: unknown,
  _version: number
): PersistedSubscriptionSlice => {
  if (!persisted || typeof persisted !== 'object') {
    return { subscriptions: [], creditAccounts: {} };
  }

  const maybeState = persisted as Partial<PersistedSubscriptionSlice>;
  const subscriptions = Array.isArray(maybeState.subscriptions)
    ? maybeState.subscriptions.map((entry) => normalizeSubscription(entry as Partial<Subscription>))
    : [];
  const creditAccounts =
    maybeState.creditAccounts && typeof maybeState.creditAccounts === 'object'
      ? Object.entries(maybeState.creditAccounts as Record<string, CreditAccountState>).reduce<
          Record<string, CreditAccountState>
        >((acc, [accountId, account]) => {
          acc[accountId] = normalizeCreditAccount({
            ...account,
            accountId,
          });
          return acc;
        }, {})
      : {};

  return { subscriptions, creditAccounts };
};

const pendingWrites = new Map<string, string>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue = Promise.resolve();

const flushPendingWrites = async (): Promise<void> => {
  if (pendingWrites.size === 0) return;

  const writes = Array.from(pendingWrites.entries());
  pendingWrites.clear();

  writeQueue = writeQueue.then(async () => {
    await Promise.all(writes.map(([key, value]) => AsyncStorage.setItem(key, value)));
  });

  try {
    await writeQueue;
  } catch (error) {
    console.warn('Failed to persist subscriptions:', error);
  }
};

const debouncedAsyncStorage: StateStorage = {
  getItem: async (name) => {
    if (pendingWrites.has(name)) return pendingWrites.get(name) ?? null;
    await writeQueue;
    return AsyncStorage.getItem(name);
  },
  setItem: async (name, value) => {
    pendingWrites.set(name, value);
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      void flushPendingWrites();
    }, WRITE_DEBOUNCE_MS);
  },
  removeItem: async (name) => {
    pendingWrites.delete(name);
    if (writeTimer && pendingWrites.size === 0) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    await writeQueue;
    await AsyncStorage.removeItem(name);
  },
};

interface SubscriptionState {
  subscriptions: Subscription[];
  creditAccounts: Record<string, CreditAccountState>;
  stats: SubscriptionStats;
  isLoading: boolean;
  error: AppError | null;
  prorationPreview: ProrationPreview | null;
  creditMemos: Record<string, CreditMemo>;

  // Actions
  addSubscription: (data: SubscriptionFormData) => Promise<void>;
  updateSubscription: (id: string, data: Partial<Subscription>) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  toggleSubscriptionStatus: (id: string) => Promise<void>;
  // new actions added
  previewPlanChange: (id: string, newPrice: number, effectiveDate: 'immediate' | 'end_of_period') => ProrationPreview;
  executePlanChange: (id: string, newPlanData: Partial<Subscription>, effectiveDate: 'immediate' | 'end_of_period') => Promise<void>;
  applyCreditToSubscription: (id: string) => Promise<void>;
  /** Simulate or record a billing result (fires local notifications when enabled for this sub). */
  recordBillingOutcome: (id: string, outcome: 'success' | 'failed') => Promise<void>;
  getCreditAccount: (accountId?: string) => CreditAccountState;
  setCreditPolicy: (policy: Partial<CreditPolicy>, accountId?: string) => Promise<void>;
  purchaseCredit: (input: CreditPurchaseInput, accountId?: string) => Promise<void>;
  transferCredit: (
    input: CreditTransferInput,
    recipientAccountId: string,
    accountId?: string
  ) => Promise<void>;
  applyCreditToInvoice: (
    invoiceId: string,
    subscriptionId: string,
    accountId?: string
  ) => Promise<CreditApplicationResult | null>;
  expireCredits: (accountId?: string) => Promise<void>;
  fetchSubscriptions: () => Promise<void>;
  calculateStats: () => void;
}

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      subscriptions: dummySubscriptions,
      creditAccounts: {},
      stats: {
        totalActive: 0,
        totalMonthlySpend: 0,
        totalYearlySpend: 0,
        categoryBreakdown: {} as Record<string, number>,
        prorationPreview: null,
      creditMemos: {},
      
      previewPlanChange: (id: string, newPrice: number, effectiveDate: 'immediate' | 'end_of_period') => {
        const sub = get().subscriptions.find((s) => s.id === id);
        if (!sub) {
          throw new Error('Subscription not found');
      }

      const preview = previewProration(sub, newPrice, effectiveDate);
        set({ prorationPreview: preview });
        return preview;
      },

      executePlanChange: async (id: string, newPlanData: Partial<Subscription>, effectiveDate: 'immediate' | 'end_of_period') => {
        set({ isLoading: true, error: null });
        try {
          const sub = get().subscriptions.find((s) => s.id === id);
          if (!sub) throw new Error('Subscription not found');
          
          const preview = previewProration(sub, newPlanData.price ?? sub.price, effectiveDate);
        
          // Generate credit memo if downgrade
          let updatedCreditMemos = { ...get().creditMemos };
          if (preview.isCredit && preview.amount > 0) {
            const memo = generateCreditMemo(id, preview.amount, preview.description);
            updatedCreditMemos[id] = memo;
          }
          
          // Update subscription
          const updates: Partial<Subscription> = {
            ...newPlanData,
            updatedAt: new Date(),
          };
          
          if (effectiveDate === 'immediate') {
            // Reset billing cycle
            updates.nextBillingDate = advanceBillingDate(new Date(), newPlanData.billingCycle ?? sub.billingCycle);
          }
          
          set((state) => ({
            subscriptions: state.subscriptions.map((s) =>
              s.id === id ? { ...s, ...updates } : s
            ),
            creditMemos: updatedCreditMemos,
            prorationPreview: null,
            isLoading: false,
          }));
          
          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'executePlanChange',
            subscriptionId: id,
          });
          set({ error: appError, isLoading: false });
        }
      },
      
      applyCreditToSubscription: async (id: string) => {
        const sub = get().subscriptions.find((s) => s.id === id);
        const memo = get().creditMemos[id];
        if (!sub || !memo || memo.applied) return;
        
        const { finalCharge, updatedMemo } = applyCreditMemo(sub.price, memo);
        
        set((state) => ({
          creditMemos: {
            ...state.creditMemos,
            [id]: updatedMemo,
          },
        }));
        
        // Could trigger a reduced charge here
        console.log(`Applied credit: final charge ${finalCharge}`);
      },
    }),
    // ... persist config ...
  )
);
      // Hydration state: keep loading true until persisted state is read.
      isLoading: true,
      error: null,

      addSubscription: async (data: SubscriptionFormData) => {
        set({ isLoading: true, error: null });
        try {
          const newSubscription: Subscription = {
            id: generateUniqueId(),
            ...data,
            isActive: true,
            notificationsEnabled: data.notificationsEnabled !== false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          set((state) => ({
            subscriptions: [...state.subscriptions, newSubscription],
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          await useCalendarStore.getState().syncSubscriptionToCalendars(newSubscription);

          // Gamification Triggers
          const gamificationStore = useGamificationStore.getState();
          gamificationStore.addPoints(10); // 10 points for adding a subscription
          gamificationStore.checkAchievements(AchievementTrigger.SUBSCRIPTION_ADDED, {
            totalSubscriptions: get().subscriptions.length,
            price: data.price,
            category: data.category,
          });
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'addSubscription',
            subscriptionId: 'new',
            metadata: { formData: data },
          });
          set({
            error: appError,
            isLoading: false,
          });
        }
      },

      updateSubscription: async (id: string, data: Partial<Subscription>) => {
        set({ isLoading: true, error: null });
        try {
          set((state) => ({
            subscriptions: state.subscriptions.map((sub) =>
              sub.id === id ? { ...sub, ...data, updatedAt: new Date() } : sub
            ),
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          const updatedSubscription = get().subscriptions.find((sub) => sub.id === id);
          if (updatedSubscription) {
            await useCalendarStore.getState().syncSubscriptionToCalendars(updatedSubscription);
          }
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'updateSubscription',
            subscriptionId: id,
            metadata: { updateData: data },
          });
          set({
            error: appError,
            isLoading: false,
          });
        }
      },

      deleteSubscription: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          const current = get().subscriptions.find((sub) => sub.id === id);
          if (current) {
            useSupportStore
              .getState()
              .createTicket(
                createSupportEvent(current, 'cancellation', [
                  'Cancellation requested from subscription management',
                  'Subscription marked for removal',
                ])
              );
          }

          set((state) => ({
            subscriptions: state.subscriptions.filter((sub) => sub.id !== id),
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          await useCalendarStore.getState().removeSubscriptionFromCalendars(id);
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'deleteSubscription',
            subscriptionId: id,
          });
          set({
            error: appError,
            isLoading: false,
          });
        }
      },

      toggleSubscriptionStatus: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          set((state) => ({
            subscriptions: state.subscriptions.map((sub) =>
              sub.id === id ? { ...sub, isActive: !sub.isActive, updatedAt: new Date() } : sub
            ),
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          const updatedSubscription = get().subscriptions.find((sub) => sub.id === id);
          if (updatedSubscription) {
            await useCalendarStore.getState().syncSubscriptionToCalendars(updatedSubscription);
          }
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'toggleSubscriptionStatus',
            subscriptionId: id,
          });
          set({
            error: appError,
            isLoading: false,
          });
        }
      },

      recordBillingOutcome: async (id: string, outcome: 'success' | 'failed') => {
        const sub = get().subscriptions.find((s) => s.id === id);
        if (!sub) return;
        const accountId = getDefaultAccountId();

        if (outcome === 'failed') {
          const dunningEntries = JSON.parse(
            (await AsyncStorage.getItem('subtrackr-dunning-entries')) || '{}'
          );
          const entry = dunningEntries[id];
          const attempt = (entry?.failedAttempts ?? 0) + 1;

          dunningEntries[id] = {
            failedAttempts: attempt,
            lastFailureAt: new Date().toISOString(),
            currentStage: attempt <= 3 ? 'retry' : attempt <= 5 ? 'warn' : attempt <= 7 ? 'suspend' : 'cancel',
          };
          await AsyncStorage.setItem('subtrackr-dunning-entries', JSON.stringify(dunningEntries));

          if (sub.notificationsEnabled !== false) {
            await presentChargeFailedNotification(sub);
            if (attempt <= 3) {
              await presentDunningRetryNotification(sub, attempt, 3);
            } else if (attempt <= 5) {
              await presentDunningWarningNotification(sub, attempt);
            } else if (attempt <= 7) {
              await presentDunningSuspendedNotification(sub);
            } else {
              await presentDunningCancelledNotification(sub);
            }
          }

          set({ isLoading: false });
          return;
        }

        if (outcome === 'success') {
          const hasDunningEntry = await AsyncStorage.getItem('subtrackr-dunning-entries');
          if (hasDunningEntry) {
            await AsyncStorage.removeItem('subtrackr-dunning-entries');
            if (sub.notificationsEnabled !== false) {
              await presentDunningRecoveryNotification(sub);
            }
          }
          await presentChargeSuccessNotification(sub);
          const billingPeriod = buildBillingPeriod(sub);
          const next = advanceBillingDate(new Date(sub.nextBillingDate), sub.billingCycle);
          const simulatedGas = 0.01 + Math.random() * 0.005; // Simulate 0.01 - 0.015 XLM gas
          set((state) => ({
            subscriptions: state.subscriptions.map((s) =>
              s.id === id
                ? {
                    ...s,
                    nextBillingDate: next,
                    updatedAt: new Date(),
                    totalGasSpent: (s.totalGasSpent || 0) + simulatedGas,
                    chargeCount: (s.chargeCount || 0) + 1,
                    lastGasCost: simulatedGas,
                    gasBudget: s.gasBudget || 0.05,
                  }
                : s
            ),
          }));
          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          const updatedSubscription = get().subscriptions.find((entry) => entry.id === id);
          if (updatedSubscription) {
            await useCalendarStore.getState().syncSubscriptionToCalendars(updatedSubscription);
          }

          const invoice = await useInvoiceStore.getState().generateInvoiceFromSubscription(
            {
              subscription: sub,
              period: billingPeriod,
              region: 'GLOBAL',
              currency: sub.currency,
              recipientEmail: `${sub.name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@billing.local`,
            },
            0
          );

          const creditApplication = await get().applyCreditToInvoice(invoice.id, sub.id, accountId);
          if (creditApplication?.remainingDue > 0) {
            await useInvoiceStore.getState().updateInvoiceStatus(invoice.id, InvoiceStatus.PARTIAL);
          } else if (creditApplication?.appliedAmount && creditApplication.appliedAmount > 0) {
            await useInvoiceStore.getState().updateInvoiceStatus(invoice.id, InvoiceStatus.PAID);
          }
        } else {
          useSupportStore
            .getState()
            .createTicket(
              createSupportEvent(sub, 'failed_charge', [
                'Payment failure recorded during billing run',
                `Next billing date remains ${sub.nextBillingDate.toISOString()}`,
                `Notifications ${sub.notificationsEnabled === false ? 'disabled' : 'enabled'}`,
              ])
            );
        }
      },

      getCreditAccount: (accountId) => {
        const resolvedAccountId = accountId ?? getDefaultAccountId();
        const accounts = get().creditAccounts;
        return (
          accounts[resolvedAccountId] ?? buildCreditAccount(resolvedAccountId, getDefaultCurrency())
        );
      },

      setCreditPolicy: async (policy, accountId) => {
        set({ isLoading: true, error: null });
        try {
          const resolvedAccountId = accountId ?? getDefaultAccountId();
          set((state) => {
            const accounts = ensureCreditAccount(state.creditAccounts, resolvedAccountId);
            const current = accounts[resolvedAccountId];
            return {
              creditAccounts: {
                ...accounts,
                [resolvedAccountId]: {
                  ...current,
                  policy: {
                    ...current.policy,
                    ...policy,
                  },
                  revision: current.revision + 1,
                },
              },
              isLoading: false,
            };
          });
        } catch (error) {
          set({
            error: errorHandler.handleError(error as Error, {
              action: 'setCreditPolicy',
              metadata: { policy, accountId },
            }),
            isLoading: false,
          });
        }
      },

      purchaseCredit: async (input, accountId) => {
        set({ isLoading: true, error: null });
        try {
          const resolvedAccountId = accountId ?? getDefaultAccountId();
          set((state) => {
            const accounts = ensureCreditAccount(state.creditAccounts, resolvedAccountId);
            const current = accounts[resolvedAccountId];
            const nextAccount = purchaseCredit(current, {
              ...input,
              currency: input.currency ?? current.currency,
              expectedRevision: input.expectedRevision ?? current.revision,
            });
            return {
              creditAccounts: {
                ...accounts,
                [resolvedAccountId]: nextAccount,
              },
              isLoading: false,
            };
          });

          if (input.subscriptionId) {
            const applied = await applyCreditsAcrossOpenInvoices(
              get(),
              resolvedAccountId,
              input.subscriptionId
            );
            set((state) => ({
              creditAccounts: {
                ...state.creditAccounts,
                [resolvedAccountId]: applied.account,
              },
            }));
          }
        } catch (error) {
          set({
            error: errorHandler.handleError(error as Error, {
              action: 'purchaseCredit',
              metadata: { input, accountId },
            }),
            isLoading: false,
          });
        }
      },

      transferCredit: async (input, recipientAccountId, accountId) => {
        set({ isLoading: true, error: null });
        try {
          const sourceAccountId = accountId ?? getDefaultAccountId();
          set((state) => {
            const accounts = ensureCreditAccount(
              ensureCreditAccount(state.creditAccounts, sourceAccountId),
              recipientAccountId
            );
            const source = accounts[sourceAccountId];
            const target = accounts[recipientAccountId];
            const next = transferCredit(source, target, {
              ...input,
              currency: input.currency ?? source.currency,
              expectedRevision: input.expectedRevision ?? source.revision,
            });
            return {
              creditAccounts: {
                ...accounts,
                [sourceAccountId]: next.source,
                [recipientAccountId]: next.target,
              },
              isLoading: false,
            };
          });
        } catch (error) {
          set({
            error: errorHandler.handleError(error as Error, {
              action: 'transferCredit',
              metadata: { input, recipientAccountId, accountId },
            }),
            isLoading: false,
          });
        }
      },

      applyCreditToInvoice: async (invoiceId, subscriptionId, accountId) => {
        const resolvedAccountId = accountId ?? getDefaultAccountId();
        const invoices = useInvoiceStore.getState().invoices;
        const invoice = invoices.find((entry) => entry.id === invoiceId);
        if (!invoice) return null;

        const state = get();
        const accounts = ensureCreditAccount(state.creditAccounts, resolvedAccountId);
        const current = accounts[resolvedAccountId];
        const result = applyCreditToInvoice(current, {
          invoiceId,
          subscriptionId,
          invoiceTotal: invoice.total,
          currency: invoice.currency,
          reference: `invoice:${invoice.invoiceNumber}`,
          note: 'Manual or automatic credit application',
          expectedRevision: current.revision,
        });

        if (!result.application || result.appliedAmount <= 0) return result;

        set((currentState) => ({
          creditAccounts: {
            ...currentState.creditAccounts,
            [resolvedAccountId]: result.account,
          },
        }));

        await useInvoiceStore
          .getState()
          .updateInvoiceStatus(
            invoice.id,
            result.remainingDue > 0 ? InvoiceStatus.PARTIAL : InvoiceStatus.PAID
          );

        return result;
      },

      expireCredits: async (accountId) => {
        set({ isLoading: true, error: null });
        try {
          const resolvedAccountId = accountId ?? getDefaultAccountId();
          const state = get();
          const accounts = ensureCreditAccount(state.creditAccounts, resolvedAccountId);
          const current = accounts[resolvedAccountId];
          const result = expireCredits(current);
          set((currentState) => ({
            creditAccounts: {
              ...currentState.creditAccounts,
              [resolvedAccountId]: result.account,
            },
            isLoading: false,
          }));
          if (result.notificationMessage) {
            await presentLocalNotification({
              title: 'Credits expired',
              body: result.notificationMessage,
              data: {
                accountId: resolvedAccountId,
                expiredAmount: result.expiredAmount,
              },
            });
          }
        } catch (error) {
          set({
            error: errorHandler.handleError(error as Error, {
              action: 'expireCredits',
              metadata: { accountId },
            }),
            isLoading: false,
          });
        }
      },

      fetchSubscriptions: async () => {
        set({ isLoading: true, error: null });
        try {
          // TODO: Replace with remote sync; local storage remains source-of-truth offline.
          await new Promise((resolve) => setTimeout(resolve, 1000));
          set({ isLoading: false });
          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          await useCalendarStore.getState().syncSubscriptions(get().subscriptions);
        } catch (error) {
          set({
            error: errorHandler.handleError(error as Error, {
              action: 'fetchSubscriptions',
            }),
            isLoading: false,
          });
        }
      },

      calculateStats: () => {
        const { subscriptions } = get();

        // Safety check: ensure subscriptions is an array
        if (!subscriptions || !Array.isArray(subscriptions)) {
          set({
            stats: {
              totalActive: 0,
              totalMonthlySpend: 0,
              totalYearlySpend: 0,
              categoryBreakdown: {} as Record<SubscriptionCategory, number>,
            },
          });
          return;
        }

        const activeSubs = subscriptions.filter((sub) => sub.isActive);

        const { preferredCurrency, exchangeRates } = useSettingsStore.getState();
        const rates = exchangeRates?.rates || {};

        const totalMonthlySpend = activeSubs.reduce((total, sub) => {
          const priceInPreferred = currencyService.convert(
            sub.price,
            sub.currency,
            preferredCurrency,
            rates
          );
          if (sub.billingCycle === 'monthly') return total + priceInPreferred;
          if (sub.billingCycle === 'yearly') return total + priceInPreferred / 12;
          if (sub.billingCycle === 'weekly')
            return total + priceInPreferred * BILLING_CONVERSIONS.WEEKS_PER_MONTH;
          return total + priceInPreferred;
        }, 0);

        const totalYearlySpend = activeSubs.reduce((total, sub) => {
          const priceInPreferred = currencyService.convert(
            sub.price,
            sub.currency,
            preferredCurrency,
            rates
          );
          if (sub.billingCycle === 'yearly') return total + priceInPreferred;
          if (sub.billingCycle === 'monthly')
            return total + priceInPreferred * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
          if (sub.billingCycle === 'weekly')
            return total + priceInPreferred * BILLING_CONVERSIONS.WEEKS_PER_YEAR;
          return total + priceInPreferred * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
        }, 0);

        const categoryBreakdown = activeSubs.reduce(
          (acc, sub) => {
            acc[sub.category] = (acc[sub.category] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );

        const totalGasSpent = activeSubs.reduce(
          (total, sub) => total + (sub.totalGasSpent || 0),
          0
        );

        set({
          stats: {
            totalActive: activeSubs.length,
            totalMonthlySpend,
            totalYearlySpend,
            categoryBreakdown,
            totalGasSpent,
          },
        });
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => debouncedAsyncStorage),
      partialize: (state) =>
        serializeForStorage({
          subscriptions: state.subscriptions,
          creditAccounts: state.creditAccounts,
        }),
      migrate: (persistedState, version) => migratePersistedState(persistedState, version),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...migratePersistedState(persistedState, STORE_VERSION),
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          useSubscriptionStore.setState({
            error: errorHandler.createError(
              new Error('Stored subscription data is corrupted. Loaded fallback data.'),
              { action: 'rehydrateSubscriptions' },
              true
            ),
            subscriptions: [...dummySubscriptions],
            creditAccounts: {},
            isLoading: false,
          });
          useSubscriptionStore.getState().calculateStats();
          void syncRenewalReminders(useSubscriptionStore.getState().subscriptions);
          return;
        }

        const subscriptions = Array.isArray(state?.subscriptions)
          ? state.subscriptions
          : [...dummySubscriptions];
        const creditAccounts =
          state?.creditAccounts && typeof state.creditAccounts === 'object'
            ? state.creditAccounts
            : {};
        useSubscriptionStore.setState({
          subscriptions,
          creditAccounts,
          isLoading: false,
          error: null,
        });
        useSubscriptionStore.getState().calculateStats();
        void syncRenewalReminders(useSubscriptionStore.getState().subscriptions);
        void useCalendarStore
          .getState()
          .syncSubscriptions(useSubscriptionStore.getState().subscriptions);
      },
    }
  )
);
