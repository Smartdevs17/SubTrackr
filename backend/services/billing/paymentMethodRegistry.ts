/**
 * Server-side payment method registry.
 *
 * Holds a merchant's payment methods, the fallback chains that route charges
 * through them, the shares that let another account use them, and the attempt
 * log those chains produce. The chain is the unit of reliability: a charge
 * walks it in order until one method succeeds, so a single expired card no
 * longer means a failed renewal.
 *
 * Mirrors `src/services/paymentMethodService.ts`, which does the same on the
 * client against a connected wallet.
 */

import { BillingError, BillingErrorCode } from './errors';

/** Ceiling on methods in one fallback chain. */
export const MAX_CHAIN_LENGTH = 5;
/** Below this many days an expiry alert is critical rather than a warning. */
export const EXPIRY_CRITICAL_DAYS = 7;
/** Methods expiring within this many days raise an alert at all. */
export const EXPIRY_WARNING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PaymentMethodKind = 'card' | 'wallet' | 'bank' | 'crypto';

export interface RegisteredPaymentMethod {
  id: string;
  merchantId: string;
  label: string;
  kind: PaymentMethodKind;
  /** Last four digits or a truncated address, for display only. */
  reference: string;
  currency: string;
  /** Ceiling per billing interval; `0` means unlimited. */
  spendLimit: number;
  isVerified: boolean;
  isActive: boolean;
  /** ISO-8601, `null` for a method that does not expire. */
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PaymentMethodDraft = Omit<
  RegisteredPaymentMethod,
  'id' | 'merchantId' | 'isVerified' | 'isActive' | 'lastUsedAt' | 'createdAt' | 'updatedAt'
>;

export interface FallbackChain {
  id: string;
  merchantId: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface ChainValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export type PaymentFailureReason =
  | 'expired'
  | 'inactive'
  | 'unverified'
  | 'limit_exceeded'
  | 'declined'
  | 'unknown';

export interface ChargeAttempt {
  id: string;
  methodId: string;
  subscriptionId: string;
  chainId: string | null;
  /** Zero-based position in the chain this attempt came from. */
  chainPosition: number;
  amount: number;
  success: boolean;
  failureReason?: PaymentFailureReason;
  attemptedAt: string;
}

export interface ChargeResult {
  subscriptionId: string;
  chainId: string | null;
  success: boolean;
  attempts: ChargeAttempt[];
  /** Method that succeeded, `null` when the whole chain failed. */
  succeededMethodId: string | null;
  succeededAtPosition: number;
  haltedOnHardDecline: boolean;
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

export type ShareRole = 'viewer' | 'charger';

export interface PaymentMethodShare {
  id: string;
  methodId: string;
  granteeId: string;
  role: ShareRole;
  /** Ceiling on what the grantee may spend, `null` to inherit the method's. */
  spendLimit: number | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface PaymentMethodStats {
  methodId: string;
  label: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  volume: number;
  topFailureReason: PaymentFailureReason | null;
}

export interface PaymentMethodAnalytics {
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

/** Attempts one charge against one method; resolves the decline reason. */
export type ChargeProcessor = (input: {
  method: RegisteredPaymentMethod;
  subscriptionId: string;
  amount: number;
}) => Promise<{ success: boolean; failureReason?: PaymentFailureReason }>;

const daysUntil = (isoDate: string, now: Date): number =>
  Math.ceil((new Date(isoDate).getTime() - now.getTime()) / DAY_MS);

export class PaymentMethodRegistry {
  private methods = new Map<string, RegisteredPaymentMethod>();
  private chains = new Map<string, FallbackChain>();
  private shares = new Map<string, PaymentMethodShare>();
  private attempts: ChargeAttempt[] = [];
  private sequence = 0;

  constructor(
    /** Default processor; a charge may pass its own. */
    private readonly processor: ChargeProcessor = async () => ({ success: true }),
    private readonly now: () => Date = () => new Date()
  ) {}

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // ── Method CRUD ────────────────────────────────────────────────────

  addMethod(merchantId: string, draft: PaymentMethodDraft): RegisteredPaymentMethod {
    if (!draft.label?.trim()) {
      throw new BillingError(BillingErrorCode.INVALID_PLAN, 'Payment method label is required.', {
        merchantId,
      });
    }
    if (draft.spendLimit < 0) {
      throw new BillingError(BillingErrorCode.INVALID_PLAN, 'Spend limit cannot be negative.', {
        merchantId,
      });
    }

    const timestamp = this.now().toISOString();
    const method: RegisteredPaymentMethod = {
      ...draft,
      id: this.nextId('pm'),
      merchantId,
      // A crypto wallet proves itself by signing; other kinds need an explicit
      // verification step before they can be charged.
      isVerified: draft.kind === 'crypto',
      isActive: true,
      lastUsedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.methods.set(method.id, method);
    return method;
  }

  getMethod(id: string): RegisteredPaymentMethod | undefined {
    return this.methods.get(id);
  }

  listMethods(merchantId: string, includeInactive = false): RegisteredPaymentMethod[] {
    return [...this.methods.values()]
      .filter((method) => method.merchantId === merchantId)
      .filter((method) => includeInactive || method.isActive)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  updateMethod(id: string, updates: Partial<PaymentMethodDraft>): RegisteredPaymentMethod {
    const method = this.requireMethod(id);
    const updated = { ...method, ...updates, updatedAt: this.now().toISOString() };
    this.methods.set(id, updated);
    return updated;
  }

  verifyMethod(id: string): RegisteredPaymentMethod {
    return this.setMethodFlags(id, { isVerified: true });
  }

  /**
   * Retire a method and drop it from every chain, so a chain never points at
   * something that can no longer be charged.
   */
  removeMethod(id: string): void {
    this.requireMethod(id);
    this.methods.delete(id);
    for (const chain of this.chains.values()) {
      if (!chain.methodIds.includes(id)) continue;
      this.chains.set(chain.id, {
        ...chain,
        methodIds: chain.methodIds.filter((methodId) => methodId !== id),
        updatedAt: this.now().toISOString(),
      });
    }
  }

  /** Deactivate every method whose expiry has passed. Returns how many. */
  deactivateExpired(merchantId: string): number {
    const now = this.now();
    let count = 0;
    for (const method of this.listMethods(merchantId)) {
      if (!method.expiresAt || daysUntil(method.expiresAt, now) > 0) continue;
      this.setMethodFlags(method.id, { isActive: false });
      count += 1;
    }
    return count;
  }

  // ── Fallback chains ────────────────────────────────────────────────

  createChain(
    merchantId: string,
    name: string,
    methodIds: string[],
    options: Partial<Pick<FallbackChain, 'subscriptionId' | 'maxAttempts' | 'stopOnHardDecline'>> = {}
  ): FallbackChain {
    const timestamp = this.now().toISOString();
    const chain: FallbackChain = {
      id: this.nextId('chain'),
      merchantId,
      name,
      methodIds,
      subscriptionId: options.subscriptionId ?? null,
      maxAttempts: options.maxAttempts ?? 0,
      stopOnHardDecline: options.stopOnHardDecline ?? false,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const validation = this.validateChain(chain);
    if (!validation.isValid) {
      throw new BillingError(
        BillingErrorCode.INVALID_PLAN,
        `Invalid fallback chain: ${validation.errors.join('; ')}`,
        { merchantId }
      );
    }

    this.chains.set(chain.id, chain);
    return chain;
  }

  getChain(id: string): FallbackChain | undefined {
    return this.chains.get(id);
  }

  listChains(merchantId: string): FallbackChain[] {
    return [...this.chains.values()].filter((chain) => chain.merchantId === merchantId);
  }

  updateChain(id: string, updates: Partial<FallbackChain>): FallbackChain {
    const chain = this.chains.get(id);
    if (!chain) {
      throw new BillingError(BillingErrorCode.INVALID_PLAN, `Fallback chain ${id} not found.`, {
        chainId: id,
      });
    }
    const updated = { ...chain, ...updates, updatedAt: this.now().toISOString() };
    this.chains.set(id, updated);
    return updated;
  }

  deleteChain(id: string): void {
    this.chains.delete(id);
  }

  /**
   * A chain is valid when it names at least one known method, stays within
   * `MAX_CHAIN_LENGTH`, and lists no method twice.
   */
  validateChain(chain: FallbackChain): ChainValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!chain.name?.trim()) errors.push('Chain name is required.');
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
      const method = this.methods.get(id);
      if (!method) {
        errors.push(`Payment method ${id} does not exist.`);
      } else if (method.merchantId !== chain.merchantId) {
        errors.push(`Payment method ${id} belongs to another merchant.`);
      }
    }

    // These are independent facts about the chain, so a chain that is both
    // short and partly unusable reports both.
    const usable = this.resolveChainMethods(chain);
    if (errors.length === 0 && usable.length === 0) {
      errors.push('Every method in this chain is inactive, unverified or expired.');
    }
    if (usable.length === 1) {
      warnings.push('A single-method chain has no fallback if that method fails.');
    }
    if (usable.length < chain.methodIds.length && errors.length === 0) {
      warnings.push('Some methods in this chain are inactive, unverified or expired.');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /** The methods a chain will actually attempt, in order. */
  resolveChainMethods(chain: FallbackChain): RegisteredPaymentMethod[] {
    const now = this.now();
    const usable = chain.methodIds
      .map((id) => this.methods.get(id))
      .filter((method): method is RegisteredPaymentMethod => {
        if (!method || !method.isActive || !method.isVerified) return false;
        return !method.expiresAt || daysUntil(method.expiresAt, now) > 0;
      });
    return chain.maxAttempts > 0 ? usable.slice(0, chain.maxAttempts) : usable;
  }

  /** The chain that applies to a subscription: its own, else the global one. */
  chainForSubscription(merchantId: string, subscriptionId: string): FallbackChain | null {
    const active = this.listChains(merchantId).filter((chain) => chain.isActive);
    return (
      active.find((chain) => chain.subscriptionId === subscriptionId) ??
      active.find((chain) => chain.subscriptionId === null) ??
      null
    );
  }

  // ── Charging ───────────────────────────────────────────────────────

  /**
   * Charge a subscription through its fallback chain, trying each method in
   * turn until one succeeds.
   *
   * A hard decline — an expired, inactive or unverified method — halts the
   * chain when it is configured that way, since falling through would only
   * repeat a configuration problem.
   */
  async charge(
    merchantId: string,
    subscriptionId: string,
    amount: number,
    processor: ChargeProcessor = this.processor
  ): Promise<ChargeResult> {
    const chain = this.chainForSubscription(merchantId, subscriptionId);
    const candidates = chain
      ? chain.methodIds
          .map((id) => this.methods.get(id))
          .filter((method): method is RegisteredPaymentMethod => Boolean(method))
          .slice(0, chain.maxAttempts > 0 ? chain.maxAttempts : undefined)
      : this.listMethods(merchantId);

    if (candidates.length === 0) {
      throw new BillingError(
        BillingErrorCode.PAYMENT_FAILED,
        `No payment method available for subscription ${subscriptionId}.`,
        { merchantId, subscriptionId }
      );
    }

    const now = this.now();
    const attempts: ChargeAttempt[] = [];

    for (let position = 0; position < candidates.length; position++) {
      const method = candidates[position];
      const record = (
        success: boolean,
        failureReason?: PaymentFailureReason
      ): ChargeAttempt => {
        const attempt: ChargeAttempt = {
          id: this.nextId('att'),
          methodId: method.id,
          subscriptionId,
          chainId: chain?.id ?? null,
          chainPosition: position,
          amount,
          success,
          failureReason,
          attemptedAt: now.toISOString(),
        };
        attempts.push(attempt);
        this.attempts.push(attempt);
        return attempt;
      };

      const hardDecline: PaymentFailureReason | null = !method.isActive
        ? 'inactive'
        : !method.isVerified
          ? 'unverified'
          : method.expiresAt && daysUntil(method.expiresAt, now) <= 0
            ? 'expired'
            : null;

      if (hardDecline) {
        record(false, hardDecline);
        if (chain?.stopOnHardDecline) {
          return {
            subscriptionId,
            chainId: chain.id,
            success: false,
            attempts,
            succeededMethodId: null,
            succeededAtPosition: -1,
            haltedOnHardDecline: true,
          };
        }
        continue;
      }

      if (method.spendLimit > 0 && amount > method.spendLimit) {
        record(false, 'limit_exceeded');
        continue;
      }

      const outcome = await processor({ method, subscriptionId, amount });
      record(outcome.success, outcome.failureReason ?? (outcome.success ? undefined : 'declined'));

      if (outcome.success) {
        this.setMethodFlags(method.id, { lastUsedAt: now.toISOString() });
        return {
          subscriptionId,
          chainId: chain?.id ?? null,
          success: true,
          attempts,
          succeededMethodId: method.id,
          succeededAtPosition: position,
          haltedOnHardDecline: false,
        };
      }
    }

    return {
      subscriptionId,
      chainId: chain?.id ?? null,
      success: false,
      attempts,
      succeededMethodId: null,
      succeededAtPosition: -1,
      haltedOnHardDecline: false,
    };
  }

  getAttempts(merchantId: string): ChargeAttempt[] {
    const owned = new Set(
      this.listMethods(merchantId, true).map((method) => method.id)
    );
    return this.attempts.filter((attempt) => owned.has(attempt.methodId));
  }

  // ── Expiry alerts ──────────────────────────────────────────────────

  /**
   * Alerts for methods that have expired or are about to.
   *
   * A method still sitting in an active chain is flagged, because its expiry
   * will break a charge rather than merely retire an unused method.
   */
  getExpiryAlerts(merchantId: string, withinDays = EXPIRY_WARNING_DAYS): ExpiryAlert[] {
    const now = this.now();
    const chained = new Set(
      this.listChains(merchantId)
        .filter((chain) => chain.isActive)
        .flatMap((chain) => chain.methodIds)
    );

    return this.listMethods(merchantId, true)
      .filter((method) => method.expiresAt !== null)
      .map((method) => {
        const remaining = daysUntil(method.expiresAt!, now);
        if (remaining > withinDays) return null;

        const severity: ExpiryAlertSeverity =
          remaining <= 0 ? 'expired' : remaining <= EXPIRY_CRITICAL_DAYS ? 'critical' : 'warning';
        const inActiveChain = chained.has(method.id);
        const base =
          severity === 'expired'
            ? `${method.label} expired ${Math.abs(remaining)} day(s) ago`
            : `${method.label} expires in ${remaining} day(s)`;

        return {
          methodId: method.id,
          label: method.label,
          severity,
          daysUntilExpiry: remaining,
          message: inActiveChain ? `${base} and is still in a fallback chain` : base,
          inActiveChain,
        };
      })
      .filter((alert): alert is ExpiryAlert => alert !== null)
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  }

  // ── Sharing ────────────────────────────────────────────────────────

  /**
   * Grant another account use of a payment method.
   *
   * A `viewer` sees the method in listings; a `charger` may also spend from
   * it, bounded by `spendLimit` when one is set.
   */
  shareMethod(
    methodId: string,
    granteeId: string,
    role: ShareRole,
    options: { spendLimit?: number; expiresAt?: string } = {}
  ): PaymentMethodShare {
    const method = this.requireMethod(methodId);

    if (!granteeId.trim()) {
      throw new BillingError(BillingErrorCode.INVALID_PLAN, 'A share needs a grantee.', {
        methodId,
      });
    }
    if (granteeId === method.merchantId) {
      throw new BillingError(
        BillingErrorCode.INVALID_PLAN,
        'A payment method cannot be shared with its own owner.',
        { methodId }
      );
    }
    if (!method.isActive) {
      throw new BillingError(
        BillingErrorCode.INVALID_PLAN,
        `${method.label} is inactive and cannot be shared.`,
        { methodId }
      );
    }

    const share: PaymentMethodShare = {
      id: this.nextId('share'),
      methodId,
      granteeId,
      role,
      spendLimit: options.spendLimit ?? null,
      expiresAt: options.expiresAt ?? null,
      createdAt: this.now().toISOString(),
      revokedAt: null,
    };
    this.shares.set(share.id, share);
    return share;
  }

  revokeShare(shareId: string): void {
    const share = this.shares.get(shareId);
    if (!share || share.revokedAt) return;
    this.shares.set(shareId, { ...share, revokedAt: this.now().toISOString() });
  }

  isShareActive(share: PaymentMethodShare): boolean {
    if (share.revokedAt) return false;
    return !share.expiresAt || new Date(share.expiresAt).getTime() > this.now().getTime();
  }

  listShares(methodId: string): PaymentMethodShare[] {
    return [...this.shares.values()].filter(
      (share) => share.methodId === methodId && this.isShareActive(share)
    );
  }

  /** Methods visible to a grantee through their live shares. */
  methodsSharedWith(granteeId: string): RegisteredPaymentMethod[] {
    const granted = [...this.shares.values()]
      .filter((share) => share.granteeId === granteeId && this.isShareActive(share))
      .map((share) => share.methodId);
    return granted
      .map((id) => this.methods.get(id))
      .filter((method): method is RegisteredPaymentMethod => Boolean(method));
  }

  canGranteeCharge(methodId: string, granteeId: string, amount: number): boolean {
    const share = [...this.shares.values()].find(
      (candidate) =>
        candidate.methodId === methodId &&
        candidate.granteeId === granteeId &&
        candidate.role === 'charger' &&
        this.isShareActive(candidate)
    );
    if (!share) return false;
    return share.spendLimit === null || amount <= share.spendLimit;
  }

  // ── Analytics ──────────────────────────────────────────────────────

  /**
   * Success rates, failure reasons and fallback usage over the attempt log.
   *
   * `fallbackRate` is the fraction of successful charges that only landed
   * after an earlier method failed — the number that says whether the chain is
   * doing real work.
   */
  getAnalytics(merchantId: string): PaymentMethodAnalytics {
    const methods = this.listMethods(merchantId, true);
    const labels = new Map(methods.map((method) => [method.id, method.label]));
    const attempts = this.getAttempts(merchantId);

    const stats = new Map<string, PaymentMethodStats>();
    const failureCounts = new Map<PaymentFailureReason, number>();
    let totalSuccesses = 0;
    let totalFailures = 0;
    let fallbackSuccesses = 0;

    for (const attempt of attempts) {
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
        // Anything past the head of the chain only succeeded because the
        // fallback existed.
        if (attempt.chainPosition > 0) fallbackSuccesses += 1;
      } else {
        entry.failures += 1;
        totalFailures += 1;
        const reason = attempt.failureReason ?? 'unknown';
        failureCounts.set(reason, (failureCounts.get(reason) ?? 0) + 1);
      }
    }

    for (const entry of stats.values()) {
      entry.successRate = entry.attempts === 0 ? 0 : entry.successes / entry.attempts;
      const tally = new Map<PaymentFailureReason, number>();
      attempts
        .filter((attempt) => attempt.methodId === entry.methodId && !attempt.success)
        .forEach((attempt) => {
          const reason = attempt.failureReason ?? 'unknown';
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
      activeMethods: methods.filter((method) => method.isActive).length,
      expiringMethods: this.getExpiryAlerts(merchantId).filter(
        (alert) => alert.severity !== 'expired'
      ).length,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────

  private setMethodFlags(
    id: string,
    flags: Partial<Pick<RegisteredPaymentMethod, 'isActive' | 'isVerified' | 'lastUsedAt'>>
  ): RegisteredPaymentMethod {
    const method = this.requireMethod(id);
    const updated = { ...method, ...flags, updatedAt: this.now().toISOString() };
    this.methods.set(id, updated);
    return updated;
  }

  private requireMethod(id: string): RegisteredPaymentMethod {
    const method = this.methods.get(id);
    if (!method) {
      throw new BillingError(BillingErrorCode.INVALID_PLAN, `Payment method ${id} not found.`, {
        methodId: id,
      });
    }
    return method;
  }
}
