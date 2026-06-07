import { create } from 'zustand';

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

export interface PaymentAttemptResult {
  methodId: string;
  success: boolean;
  failureReason?: 'expired' | 'limit_exceeded' | 'insufficient_balance' | 'unknown';
  amount: number;
  timestamp: number;
}

const MAX_METHODS = 10;
const PRIORITY_ORDER: Record<PaymentPriority, number> = { primary: 0, backup: 1, fallback: 2 };

const generateId = (): string =>
  `pm-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

const isExpired = (method: PaymentMethod, now: number): boolean =>
  method.expiresAt !== null && method.expiresAt <= now;

interface PaymentStoreState {
  methods: PaymentMethod[];
  attemptLog: PaymentAttemptResult[];

  addMethod: (
    input: Omit<PaymentMethod, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt' | 'isVerified' | 'isActive'>
  ) => PaymentMethod;
  removeMethod: (id: string) => void;
  verifyMethod: (id: string) => void;
  setPriority: (id: string, priority: PaymentPriority) => void;
  setExpiry: (id: string, expiresAt: number | null) => void;
  deactivateExpired: () => number;
  chargeWithFallback: (amount: number) => PaymentAttemptResult | null;
  getMethodsSortedByPriority: () => PaymentMethod[];
  getExpiringMethods: (withinDays?: number) => PaymentMethod[];
}

export const usePaymentStore = create<PaymentStoreState>()((set, get) => ({
  methods: [],
  attemptLog: [],

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
    const cutoff = now + withinDays * 24 * 60 * 60 * 1000;
    return get().methods.filter(
      (m) => m.isActive && m.expiresAt !== null && m.expiresAt > now && m.expiresAt <= cutoff
    );
  },
}));
