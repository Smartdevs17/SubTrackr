import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../../src/utils/storage';

export type PaymentPriority = 'primary' | 'backup' | 'fallback';

export interface PaymentMethod {
  id: string;
  label: string;
  tokenType: string;
  tokenAddress: string;
  chainId: number;
  priority: PaymentPriority;
  maxSpendPerInterval: number;
  autoRechargeThreshold: number;
  autoRechargeAmount: number;
  isVerified: boolean;
  isActive: boolean;
  expiresAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type PaymentFailureReason =
  | 'expired'
  | 'limit_exceeded'
  | 'insufficient_balance'
  | 'inactive'
  | 'unknown';

export interface PaymentAttemptResult {
  methodId: string;
  success: boolean;
  failureReason?: PaymentFailureReason;
  amount: number;
  timestamp: number;
  /** Zero-based position in the chain this attempt came from. */
  chainPosition?: number;
  /** Chain the attempt belonged to, absent for a priority-ordered charge. */
  chainId?: string;
}

/**
 * An explicit, ordered list of methods to try for a charge.
 *
 * A chain replaces implicit priority ordering when a merchant wants a specific
 * route, and can be scoped to a single subscription.
 */
export interface FallbackChain {
  id: string;
  name: string;
  /** Payment method ids, tried in this order. */
  methodIds: string[];
  /** `null` applies the chain to every subscription. */
  subscriptionId: string | null;
  /** Ceiling on methods tried in one charge; 0 means try the whole chain. */
  maxAttempts: number;
  /** Stop on an expired or inactive method rather than falling through. */
  stopOnHardDecline: boolean;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChainValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export type ExpiryAlertSeverity = 'expired' | 'critical' | 'warning';

export interface ExpiryAlert {
  methodId: string;
  label: string;
  severity: ExpiryAlertSeverity;
  /** Negative once the method has expired. */
  daysUntilExpiry: number;
  message: string;
  /** True when the method still appears in an active chain. */
  inActiveChain: boolean;
}

export interface PaymentMethodStats {
  methodId: string;
  label: string;
  attempts: number;
  successes: number;
  failures: number;
  /** `successes / attempts`, 0-1. */
  successRate: number;
  volume: number;
  topFailureReason: PaymentFailureReason | null;
}

export interface PaymentAnalytics {
  totalAttempts: number;
  totalSuccesses: number;
  totalFailures: number;
  successRate: number;
  /** Fraction of successful charges that needed a fallback, 0-1. */
  fallbackRate: number;
  byMethod: PaymentMethodStats[];
  failureReasons: { reason: PaymentFailureReason; count: number }[];
  mostReliableMethodId: string | null;
  activeMethods: number;
  expiringMethods: number;
}

const MAX_METHODS = 10;
/** Ceiling on methods in one fallback chain. */
export const MAX_CHAIN_LENGTH = 5;
/** Below this many days an expiry alert is critical rather than a warning. */
export const EXPIRY_CRITICAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRIORITY_ORDER: Record<PaymentPriority, number> = { primary: 0, backup: 1, fallback: 2 };

const generateId = (): string =>
  `pm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

const isExpired = (method: PaymentMethod, now: number): boolean =>
  method.expiresAt !== null && method.expiresAt <= now;

interface PaymentStoreState {
  methods: PaymentMethod[];
  attemptLog: PaymentAttemptResult[];
  chains: FallbackChain[];

  addMethod: (
    input: Omit<
      PaymentMethod,
      'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt' | 'isVerified' | 'isActive'
    >
  ) => PaymentMethod;
  removeMethod: (id: string) => void;
  verifyMethod: (id: string) => void;
  setPriority: (id: string, priority: PaymentPriority) => void;
  setExpiry: (id: string, expiresAt: number | null) => void;
  deactivateExpired: () => number;
  chargeWithFallback: (amount: number) => PaymentAttemptResult | null;
  getMethodsSortedByPriority: () => PaymentMethod[];
  getExpiringMethods: (withinDays?: number) => PaymentMethod[];

  // Fallback chains
  createChain: (
    name: string,
    methodIds: string[],
    options?: Partial<Pick<FallbackChain, 'subscriptionId' | 'maxAttempts' | 'stopOnHardDecline'>>
  ) => FallbackChain;
  updateChain: (id: string, updates: Partial<FallbackChain>) => void;
  deleteChain: (id: string) => void;
  reorderChain: (id: string, methodIds: string[]) => void;
  validateChain: (chain: FallbackChain) => ChainValidation;
  resolveChainMethods: (chain: FallbackChain) => PaymentMethod[];
  chainForSubscription: (subscriptionId: string) => FallbackChain | null;
  chargeWithChain: (chainId: string, amount: number) => PaymentAttemptResult | null;

  // Expiry alerts
  getExpiryAlerts: (withinDays?: number) => ExpiryAlert[];

  // Analytics
  getAnalytics: () => PaymentAnalytics;
}

export const usePaymentStore = create<PaymentStoreState>()(
  persist(
    (set, get) => ({
      methods: [],
      attemptLog: [],
      chains: [],

      addMethod: (input) => {
        if (get().methods.length >= MAX_METHODS) {
          throw new Error(`Cannot add more than ${MAX_METHODS} payment methods`);
        }
        const now = Date.now();
        const method: PaymentMethod = {
          ...input,
          id: generateId(),
          isVerified: false,
          isActive: true,
          lastUsedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ methods: [...s.methods, method] }));
        return method;
      },

      removeMethod: (id) => {
        set((s) => ({ methods: s.methods.filter((m) => m.id !== id) }));
      },

      verifyMethod: (id) => {
        set((s) => ({
          methods: s.methods.map((m) =>
            m.id === id ? { ...m, isVerified: true, updatedAt: Date.now() } : m
          ),
        }));
      },

      setPriority: (id, priority) => {
        set((s) => ({
          methods: s.methods.map((m) =>
            m.id === id ? { ...m, priority, updatedAt: Date.now() } : m
          ),
        }));
      },

      setExpiry: (id, expiresAt) => {
        set((s) => ({
          methods: s.methods.map((m) =>
            m.id === id ? { ...m, expiresAt, updatedAt: Date.now() } : m
          ),
        }));
      },

      deactivateExpired: () => {
        const now = Date.now();
        let count = 0;
        set((s) => ({
          methods: s.methods.map((m) => {
            if (m.isActive && isExpired(m, now)) {
              count++;
              return { ...m, isActive: false, updatedAt: now };
            }
            return m;
          }),
        }));
        return count;
      },

      chargeWithFallback: (amount) => {
        const now = Date.now();
        const sorted = get().getMethodsSortedByPriority();
        let lastResult: PaymentAttemptResult | null = null;

        for (const method of sorted) {
          if (!method.isActive) continue;

          if (isExpired(method, now)) {
            lastResult = {
              methodId: method.id,
              success: false,
              failureReason: 'expired',
              amount,
              timestamp: now,
            };
            set((s) => ({ attemptLog: [...s.attemptLog, lastResult!] }));
            continue;
          }

          if (method.maxSpendPerInterval > 0 && amount > method.maxSpendPerInterval) {
            lastResult = {
              methodId: method.id,
              success: false,
              failureReason: 'limit_exceeded',
              amount,
              timestamp: now,
            };
            set((s) => ({ attemptLog: [...s.attemptLog, lastResult!] }));
            continue;
          }

          const successResult: PaymentAttemptResult = {
            methodId: method.id,
            success: true,
            amount,
            timestamp: now,
          };
          set((s) => ({
            attemptLog: [...s.attemptLog, successResult],
            methods: s.methods.map((m) =>
              m.id === method.id ? { ...m, lastUsedAt: now, updatedAt: now } : m
            ),
          }));
          return successResult;
        }

        return lastResult;
      },

      getMethodsSortedByPriority: () => {
        return [...get().methods]
          .filter((m) => m.isActive)
          .sort((a, b) => {
            const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
            if (pDiff !== 0) return pDiff;
            if (a.lastUsedAt !== null && b.lastUsedAt !== null) return b.lastUsedAt - a.lastUsedAt;
            return 0;
          });
      },

      getExpiringMethods: (withinDays = 30) => {
        const now = Date.now();
        const cutoff = now + withinDays * DAY_MS;
        return get().methods.filter(
          (m) => m.isActive && m.expiresAt !== null && m.expiresAt > now && m.expiresAt <= cutoff
        );
      },

      // ── Fallback chains ────────────────────────────────────────────

      createChain: (name, methodIds, options = {}) => {
        const now = Date.now();
        const chain: FallbackChain = {
          id: `chain-${now.toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
          name,
          methodIds,
          subscriptionId: options.subscriptionId ?? null,
          maxAttempts: options.maxAttempts ?? 0,
          stopOnHardDecline: options.stopOnHardDecline ?? false,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };

        const validation = get().validateChain(chain);
        if (!validation.isValid) {
          throw new Error(validation.errors.join('; '));
        }

        set((s) => ({ chains: [...s.chains, chain] }));
        return chain;
      },

      updateChain: (id, updates) => {
        set((s) => ({
          chains: s.chains.map((c) =>
            c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c
          ),
        }));
      },

      deleteChain: (id) => {
        set((s) => ({ chains: s.chains.filter((c) => c.id !== id) }));
      },

      reorderChain: (id, methodIds) => {
        set((s) => ({
          chains: s.chains.map((c) =>
            c.id === id ? { ...c, methodIds, updatedAt: Date.now() } : c
          ),
        }));
      },

      validateChain: (chain) => {
        const errors: string[] = [];
        const warnings: string[] = [];
        const { methods } = get();

        if (!chain.name.trim()) errors.push('Chain name is required.');
        if (chain.methodIds.length === 0) {
          errors.push('A fallback chain needs at least one payment method.');
        }
        if (chain.methodIds.length > MAX_CHAIN_LENGTH) {
          errors.push(`A fallback chain holds at most ${MAX_CHAIN_LENGTH} methods.`);
        }
        if (chain.maxAttempts < 0) errors.push('Max attempts cannot be negative.');

        const seen = new Set<string>();
        for (const id of chain.methodIds) {
          if (seen.has(id)) errors.push(`Payment method ${id} appears twice in the chain.`);
          seen.add(id);
          if (!methods.some((m) => m.id === id)) {
            errors.push(`Payment method ${id} does not exist.`);
          }
        }

        // These are independent facts about the chain, so a chain that is both
        // short and partly unusable reports both.
        const usable = get().resolveChainMethods(chain);
        if (errors.length === 0 && usable.length === 0) {
          errors.push('Every method in this chain is inactive or expired.');
        }
        if (usable.length === 1) {
          warnings.push('A single-method chain has no fallback if that method fails.');
        }
        if (usable.length < chain.methodIds.length && errors.length === 0) {
          warnings.push('Some methods in this chain are inactive or expired.');
        }

        return { isValid: errors.length === 0, errors, warnings };
      },

      resolveChainMethods: (chain) => {
        const now = Date.now();
        const byId = new Map(get().methods.map((m) => [m.id, m]));
        const usable = chain.methodIds
          .map((id) => byId.get(id))
          .filter((m): m is PaymentMethod => Boolean(m) && m!.isActive && !isExpired(m!, now));
        return chain.maxAttempts > 0 ? usable.slice(0, chain.maxAttempts) : usable;
      },

      chainForSubscription: (subscriptionId) => {
        const active = get().chains.filter((c) => c.isActive);
        return (
          active.find((c) => c.subscriptionId === subscriptionId) ??
          active.find((c) => c.subscriptionId === null) ??
          null
        );
      },

      /**
       * Charge through an explicit chain rather than the priority ordering.
       *
       * A hard decline — an expired or deactivated method — halts the chain
       * when it is configured that way, since falling through would only
       * repeat a configuration problem.
       */
      chargeWithChain: (chainId, amount) => {
        const chain = get().chains.find((c) => c.id === chainId);
        if (!chain) return null;

        const now = Date.now();
        const byId = new Map(get().methods.map((m) => [m.id, m]));
        const ordered = chain.maxAttempts > 0
          ? chain.methodIds.slice(0, chain.maxAttempts)
          : chain.methodIds;

        let lastResult: PaymentAttemptResult | null = null;

        for (let position = 0; position < ordered.length; position++) {
          const method = byId.get(ordered[position]);
          if (!method) continue;

          const record = (
            success: boolean,
            failureReason?: PaymentFailureReason
          ): PaymentAttemptResult => {
            const result: PaymentAttemptResult = {
              methodId: method.id,
              success,
              failureReason,
              amount,
              timestamp: now,
              chainPosition: position,
              chainId: chain.id,
            };
            set((s) => ({
              attemptLog: [...s.attemptLog, result],
              methods: success
                ? s.methods.map((m) =>
                    m.id === method.id ? { ...m, lastUsedAt: now, updatedAt: now } : m
                  )
                : s.methods,
            }));
            return result;
          };

          const hardDecline = !method.isActive || isExpired(method, now);
          if (hardDecline) {
            lastResult = record(false, !method.isActive ? 'inactive' : 'expired');
            if (chain.stopOnHardDecline) return lastResult;
            continue;
          }

          if (method.maxSpendPerInterval > 0 && amount > method.maxSpendPerInterval) {
            lastResult = record(false, 'limit_exceeded');
            continue;
          }

          return record(true);
        }

        return lastResult;
      },

      // ── Expiry alerts ──────────────────────────────────────────────

      getExpiryAlerts: (withinDays = 30) => {
        const now = Date.now();
        const chained = new Set(
          get()
            .chains.filter((c) => c.isActive)
            .flatMap((c) => c.methodIds)
        );

        return get()
          .methods.filter((m) => m.expiresAt !== null)
          .map((m) => {
            const daysUntilExpiry = Math.ceil((m.expiresAt! - now) / DAY_MS);
            if (daysUntilExpiry > withinDays) return null;

            const severity: ExpiryAlertSeverity =
              daysUntilExpiry <= 0
                ? 'expired'
                : daysUntilExpiry <= EXPIRY_CRITICAL_DAYS
                  ? 'critical'
                  : 'warning';
            const inActiveChain = chained.has(m.id);
            const base =
              severity === 'expired'
                ? `${m.label} expired ${Math.abs(daysUntilExpiry)} day(s) ago`
                : `${m.label} expires in ${daysUntilExpiry} day(s)`;

            return {
              methodId: m.id,
              label: m.label,
              severity,
              daysUntilExpiry,
              message: inActiveChain ? `${base} and is still in a fallback chain` : base,
              inActiveChain,
            };
          })
          .filter((alert): alert is ExpiryAlert => alert !== null)
          .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
      },

      // ── Analytics ──────────────────────────────────────────────────

      /**
       * Success rates, failure reasons and fallback usage over the attempt log.
       *
       * `fallbackRate` is the fraction of successful charges that only landed
       * after an earlier method failed — the number that says whether the
       * chain is doing real work.
       */
      getAnalytics: () => {
        const { methods, attemptLog } = get();
        const labels = new Map(methods.map((m) => [m.id, m.label]));
        const stats = new Map<string, PaymentMethodStats>();
        const failureCounts = new Map<PaymentFailureReason, number>();

        let totalSuccesses = 0;
        let totalFailures = 0;
        let fallbackSuccesses = 0;
        let failuresBefore = 0;

        for (const attempt of attemptLog) {
          let entry = stats.get(attempt.methodId);
          if (!entry) {
            entry = {
              methodId: attempt.methodId,
              label: labels.get(attempt.methodId) ?? attempt.methodId,
              attempts: 0,
              successes: 0,
              failures: 0,
              successRate: 0,
              volume: 0,
              topFailureReason: null,
            };
            stats.set(attempt.methodId, entry);
          }
          entry.attempts += 1;

          if (attempt.success) {
            entry.successes += 1;
            entry.volume += attempt.amount;
            totalSuccesses += 1;
            // A success reached only after earlier failures is the chain
            // earning its keep.
            if (failuresBefore > 0 || (attempt.chainPosition ?? 0) > 0) fallbackSuccesses += 1;
            failuresBefore = 0;
          } else {
            entry.failures += 1;
            totalFailures += 1;
            failuresBefore += 1;
            const reason = attempt.failureReason ?? 'unknown';
            failureCounts.set(reason, (failureCounts.get(reason) ?? 0) + 1);
          }
        }

        for (const entry of stats.values()) {
          entry.successRate = entry.attempts === 0 ? 0 : entry.successes / entry.attempts;
          const tally = new Map<PaymentFailureReason, number>();
          attemptLog
            .filter((a) => a.methodId === entry.methodId && !a.success)
            .forEach((a) => {
              const reason = a.failureReason ?? 'unknown';
              tally.set(reason, (tally.get(reason) ?? 0) + 1);
            });
          entry.topFailureReason = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        }

        const byMethod = [...stats.values()].sort((a, b) => b.attempts - a.attempts);
        const totalAttempts = totalSuccesses + totalFailures;

        return {
          totalAttempts,
          totalSuccesses,
          totalFailures,
          successRate: totalAttempts === 0 ? 0 : totalSuccesses / totalAttempts,
          fallbackRate: totalSuccesses === 0 ? 0 : fallbackSuccesses / totalSuccesses,
          byMethod,
          failureReasons: [...failureCounts.entries()]
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count),
          mostReliableMethodId:
            byMethod
              .filter((entry) => entry.attempts > 0)
              .sort((a, b) => b.successRate - a.successRate)[0]?.methodId ?? null,
          activeMethods: methods.filter((m) => m.isActive).length,
          expiringMethods: get().getExpiringMethods().length,
        };
      },
    }),
    {
      name: 'subtrackr-payment-store',
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        methods: state.methods,
        attemptLog: state.attemptLog,
        chains: state.chains,
      }),
    }
  )
);
