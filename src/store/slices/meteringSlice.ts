/**
 * Metering Slice – usage metering, credits, batch operations, and search.
 */
import type { StateCreator } from 'zustand';
import { MeterState, MeteredUsage, UsageBucket, ChargeLine, Charge, TimeRange } from '../../types/metering';
import { AccountCredit, CreditLot, CreditTransaction, CreditApplied, ExpirationPolicy, CreditTxKind } from '../../types/credit';
import { BatchDraft, BatchExecutionResult, BatchHistoryEntry, BatchProgress, PerItemResult, BatchOperationType, PerItemStatus, CancelReason, BatchCreateInput, BatchUpdateParams, UpdateFilter } from '../../types/batch';

// ── Interfaces ──────────────────────────────────────────────────────────

export interface MeteringSlice {
  meters: Record<string, Record<string, MeterState>>;
  meteringAlerts: Array<{ subscriptionId: string; metric: string; total: number }>;
  registerMeter: (subscriptionId: string, metric: string, config: { unitPrice: number; includedUnits: number; periodSecs?: number; alertThreshold?: number }) => void;
  recordMeterUsage: (subscriptionId: string, metric: string, value: number) => MeteredUsage | null;
  calculateUsageCharge: (subscriptionId: string, period: TimeRange) => Charge;
  getMeters: (subscriptionId: string) => MeterState[];
  getUsageTotal: (subscriptionId: string, metric: string) => number;
}

export interface CreditSlice {
  creditAccounts: Record<string, AccountCredit>;
  creditNextId: number;
  issueCredit: (subscriber: string, amount: number, reason: string, expiresAt?: number) => void;
  setCreditExpirationPolicy: (subscriber: string, policy: ExpirationPolicy) => void;
  applyCredit: (subscriber: string, subscriptionId: string, amountDue: number) => CreditApplied;
  transferCredit: (from: string, to: string, amount: number, reason: string) => boolean;
  expireCredits: (subscriber: string) => number;
  getCreditBalance: (subscriber: string) => number;
  getCreditAccount: (subscriber: string) => AccountCredit;
}

export interface BatchSlice {
  batchDraft: any;
  batchResult: BatchExecutionResult | null;
  batchHistory: BatchHistoryEntry[];
  batchRunning: boolean;
  batchProgress: BatchProgress | null;
  setBatchDraft: (patch: Partial<any>) => void;
  setBatchOperationType: (op: string) => void;
  toggleBatchAtomic: () => void;
  setBatchChunkSize: (size: number) => void;
  loadCreateCsv: (csv: string) => void;
  loadCancelCsv: (csv: string) => void;
  loadChargeCsv: (csv: string) => void;
  loadUpdateCsv: (csv: string) => void;
  executeBatch: () => Promise<BatchExecutionResult | null>;
  retryBatchFailed: () => Promise<BatchExecutionResult | null>;
  exportBatchResultJson: () => string | null;
  exportBatchResultCsv: () => string | null;
  loadBatchHistory: () => Promise<void>;
  resetBatchDraft: () => void;
  clearBatchResult: () => void;
}

export interface SearchSlice {
  searchQuery: string;
  searchFacets: Record<string, any>;
  searchResults: any[];
  savedSearches: Array<{ id: string; name: string; query: string; facets?: Record<string, any> }>;
  setSearchQuery: (q: string) => void;
  setSearchFacets: (f: Record<string, any>) => void;
  updateSearchResults: (results: any[]) => void;
  saveSearch: (name: string) => void;
  loadSavedSearch: (id: string) => void;
  clearSearch: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const DEFAULT_PERIOD_SECS = 86_400;
const MAX_BUCKETS = 90;
const bucketStart = (now: number, periodSecs: number): number => periodSecs === 0 ? now : now - (now % periodSecs);
const newMeter = (metric: string, periodSecs: number): MeterState => ({ metric, total: 0, lastTimestamp: 0, periodSecs, includedUnits: 0, unitPrice: 0, alertThreshold: 0, alertFired: false, buckets: [] });
const billableUnits = (used: number, included: number): number => Math.max(0, used - included);

const blankAccount = (subscriber: string): AccountCredit => ({ subscriber, balance: 0, lots: [], transactions: [], expirationPolicy: { kind: 'never' } });

const isExpired = (lot: CreditLot, now: number): boolean => lot.expiresAt !== undefined && lot.expiresAt <= now;

type MeteringStore = MeteringSlice & CreditSlice & BatchSlice & SearchSlice;
type MeteringCreator = StateCreator<MeteringStore & any, [], [], MeteringStore>;

// ═══════════════════════════════════════════════════════════════════════════
// Slice Factory
// ═══════════════════════════════════════════════════════════════════════════

export const createMeteringSlice: MeteringCreator = (set, get) => {
  const metersFor = (sub: string): Record<string, MeterState> => get().meters[sub] ?? {};
  const commitMeters = (sub: string, map: Record<string, MeterState>) => set((s) => ({ meters: { ...s.meters, [sub]: map } }));

  const account = (subscriber: string): AccountCredit => get().creditAccounts[subscriber] ?? blankAccount(subscriber);
  const commitAccount = (acc: AccountCredit) => set((s) => ({ creditAccounts: { ...s.creditAccounts, [acc.subscriber]: acc } }));

  const addToBucket = (state: MeterState, now: number, value: number) => {
    const start = bucketStart(now, state.periodSecs);
    const last = state.buckets[state.buckets.length - 1];
    if (last && last.start === start) {
      state.buckets = [...state.buckets.slice(0, -1), { start, units: last.units + value }];
    } else {
      state.buckets = [...state.buckets, { start, units: value }];
      if (state.buckets.length > MAX_BUCKETS) state.buckets = state.buckets.slice(-MAX_BUCKETS);
    }
  };

  const realizeExpiry = (acc: AccountCredit, now: number) => {
    let expired = 0;
    acc.lots = acc.lots.map((lot) => {
      if (lot.remaining > 0 && isExpired(lot, now)) { expired += lot.remaining; return { ...lot, remaining: 0 }; }
      return lot;
    });
    if (expired > 0) { acc.balance -= expired; }
    return expired;
  };

  const consume = (acc: AccountCredit, now: number, amount: number): number => {
    let remaining = amount;
    acc.lots = acc.lots.map((lot) => {
      if (remaining <= 0 || lot.remaining <= 0 || isExpired(lot, now)) return lot;
      const take = Math.min(lot.remaining, remaining);
      remaining -= take;
      return { ...lot, remaining: lot.remaining - take };
    });
    return amount - remaining;
  };

  const nowFn = () => Math.floor(Date.now() / 1000);

  return {
    // ── Metering state ──────────────────────────────────────────────
    meters: {},
    meteringAlerts: [],

    registerMeter: (sub, metric, config) => {
      const map = { ...metersFor(sub) };
      const existing = map[metric] ?? newMeter(metric, config.periodSecs ?? DEFAULT_PERIOD_SECS);
      const state: MeterState = { ...existing, periodSecs: config.periodSecs ?? existing.periodSecs ?? DEFAULT_PERIOD_SECS, includedUnits: config.includedUnits, unitPrice: config.unitPrice, alertThreshold: config.alertThreshold ?? 0, alertFired: (config.alertThreshold ?? 0) !== 0 && existing.total >= (config.alertThreshold ?? 0) };
      map[metric] = state;
      commitMeters(sub, map);
    },

    recordMeterUsage: (sub, metric, value) => {
      if (value <= 0) return null;
      const now = nowFn();
      const map = { ...metersFor(sub) };
      const state: MeterState = { ...(map[metric] ?? newMeter(metric, DEFAULT_PERIOD_SECS)) };
      state.total += value;
      state.lastTimestamp = now;
      addToBucket(state, now, value);
      if (state.alertThreshold !== 0 && !state.alertFired && state.total >= state.alertThreshold) {
        state.alertFired = true;
        set((s) => ({ meteringAlerts: [...s.meteringAlerts, { subscriptionId: sub, metric, total: state.total }] }));
      }
      map[metric] = state;
      commitMeters(sub, map);
      return { metric, value, timestamp: now };
    },

    calculateUsageCharge: (sub, period) => {
      const map = metersFor(sub);
      const lines: ChargeLine[] = [];
      let total = 0;
      for (const metric of Object.keys(map)) {
        const state = map[metric];
        const used = state.buckets.reduce((sum, b) => (b.start >= period.start && b.start <= period.end ? sum + b.units : sum), 0);
        const billable = billableUnits(used, state.includedUnits);
        const amount = billable * state.unitPrice;
        total += amount;
        lines.push({ metric, units: used, billableUnits: billable, unitPrice: state.unitPrice, amount });
      }
      return { subscriptionId: sub, currency: 'USD', total, lines };
    },

    getMeters: (sub) => Object.values(metersFor(sub)),
    getUsageTotal: (sub, metric) => metersFor(sub)[metric]?.total ?? 0,

    // ── Credit state ───────────────────────────────────────────────
    creditAccounts: {},
    creditNextId: 0,

    issueCredit: (subscriber, amount, reason, expiresAt) => {
      if (amount <= 0) return;
      const n = nowFn();
      const acc = { ...account(subscriber), lots: [...account(subscriber).lots], transactions: [...account(subscriber).transactions] };
      realizeExpiry(acc, n);
      const expiry = expiresAt ?? (acc.expirationPolicy.kind === 'after_secs' ? n + (acc.expirationPolicy as any).seconds : undefined);
      acc.lots.push({ id: get().creditNextId, remaining: amount, issuedAt: n, expiresAt: expiry });
      acc.balance += amount;
      acc.transactions = [...acc.transactions, { id: get().creditNextId, kind: 'issue', amount, timestamp: n, reason }];
      set((s) => ({ creditNextId: s.creditNextId + 1 }));
      commitAccount(acc);
    },

    setCreditExpirationPolicy: (subscriber, policy) => {
      const acc = { ...account(subscriber), expirationPolicy: policy };
      commitAccount(acc);
    },

    applyCredit: (subscriber, subscriptionId, amountDue) => {
      const n = nowFn();
      const acc = { ...account(subscriber), lots: [...account(subscriber).lots], transactions: [...account(subscriber).transactions] };
      realizeExpiry(acc, n);
      const applied = consume(acc, n, Math.max(0, amountDue));
      if (applied > 0) { acc.balance -= applied; acc.transactions = [...acc.transactions, { id: get().creditNextId, kind: 'apply', amount: -applied, timestamp: n, reason: 'charge_application' }]; set((s) => ({ creditNextId: s.creditNextId + 1 })); }
      commitAccount(acc);
      return { subscriptionId, applied, remainingDue: amountDue - applied, balanceAfter: acc.balance };
    },

    transferCredit: (from, to, amount, reason) => {
      if (amount <= 0 || from === to) return false;
      const n = nowFn();
      const sender = { ...account(from), lots: [...account(from).lots], transactions: [...account(from).transactions] };
      realizeExpiry(sender, n);
      if (sender.balance < amount) return false;
      const moved = consume(sender, n, amount);
      sender.balance -= moved;
      sender.transactions = [...sender.transactions, { id: get().creditNextId, kind: 'transfer_out', amount: -moved, timestamp: n, reason, counterparty: to }];
      set((s) => ({ creditNextId: s.creditNextId + 1 }));
      commitAccount(sender);

      const recipient = { ...account(to), lots: [...account(to).lots], transactions: [...account(to).transactions] };
      realizeExpiry(recipient, n);
      const expiry = recipient.expirationPolicy.kind === 'after_secs' ? n + (recipient.expirationPolicy as any).seconds : undefined;
      recipient.lots.push({ id: get().creditNextId, remaining: moved, issuedAt: n, expiresAt: expiry });
      recipient.balance += moved;
      recipient.transactions = [...recipient.transactions, { id: get().creditNextId, kind: 'transfer_in', amount: moved, timestamp: n, reason, counterparty: from }];
      set((s) => ({ creditNextId: s.creditNextId + 1 }));
      commitAccount(recipient);
      return true;
    },

    expireCredits: (subscriber) => {
      const n = nowFn();
      const acc = { ...account(subscriber), lots: [...account(subscriber).lots], transactions: [...account(subscriber).transactions] };
      const expired = realizeExpiry(acc, n);
      if (expired > 0) { acc.transactions = [...acc.transactions, { id: get().creditNextId, kind: 'expire', amount: -expired, timestamp: n, reason: 'expired' }]; set((s) => ({ creditNextId: s.creditNextId + 1 })); }
      commitAccount(acc);
      return expired;
    },

    getCreditBalance: (subscriber) => account(subscriber).balance,
    getCreditAccount: (subscriber) => account(subscriber),

    // ── Batch state ─────────────────────────────────────────────────
    batchDraft: { operationType: 'create', atomic: false, createInputs: [], updateIds: [], updateParams: {}, cancelIds: [], cancelReasons: [], chargeItems: [], csvContent: '', chunkSize: 50 },
    batchResult: null,
    batchHistory: [],
    batchRunning: false,
    batchProgress: null,

    setBatchDraft: (patch) => set((s) => ({ batchDraft: { ...s.batchDraft, ...patch } })),
    setBatchOperationType: (op) => set((s) => ({ batchDraft: { ...s.batchDraft, operationType: op, csvContent: '' } })),
    toggleBatchAtomic: () => set((s) => ({ batchDraft: { ...s.batchDraft, atomic: !s.batchDraft.atomic } })),
    setBatchChunkSize: (size) => set((s) => ({ batchDraft: { ...s.batchDraft, chunkSize: Math.min(size, 500) } })),

    loadCreateCsv: (_csv) => {},
    loadCancelCsv: (_csv) => {},
    loadChargeCsv: (_csv) => {},
    loadUpdateCsv: (_csv) => {},

    executeBatch: async () => null,
    retryBatchFailed: async () => null,
    exportBatchResultJson: () => null,
    exportBatchResultCsv: () => null,
    loadBatchHistory: async () => {},
    resetBatchDraft: () => set({ batchDraft: { operationType: 'create', atomic: false, createInputs: [], updateIds: [], updateParams: {}, cancelIds: [], cancelReasons: [], chargeItems: [], csvContent: '', chunkSize: 50 }, batchResult: null, batchProgress: null }),
    clearBatchResult: () => set({ batchResult: null, batchProgress: null }),

    // ── Search state ────────────────────────────────────────────────
    searchQuery: '',
    searchFacets: {},
    searchResults: [],
    savedSearches: [],

    setSearchQuery: (q) => set({ searchQuery: q }),
    setSearchFacets: (f) => set((s) => ({ searchFacets: { ...s.searchFacets, ...f } })),
    updateSearchResults: (results) => set({ searchResults: results }),
    saveSearch: (name) => set((s) => ({ savedSearches: [...s.savedSearches, { id: `ss_${Date.now()}`, name, query: s.searchQuery, facets: s.searchFacets }] })),
    loadSavedSearch: (id) => {
      const ss = get().savedSearches.find((s) => s.id === id);
      if (ss) set({ searchQuery: ss.query, searchFacets: ss.facets || {} });
    },
    clearSearch: () => set({ searchQuery: '', searchFacets: {}, searchResults: [] }),
  };
};
