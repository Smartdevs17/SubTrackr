/**
 * dunning.ts — Intelligent subscription payment retry with smart scheduling.
 *
 * Responsibilities:
 *  - Classify decline codes and decide whether/when to retry
 *  - Apply exponential backoff with configurable jitter
 *  - Track historical success patterns and shift retries toward high-success windows
 *  - Manage per-plan retry policies and circuit-breakers
 *  - Expose analytics helpers consumed by the dunning dashboard
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

/** Hard upper bound on retry attempts for any single invoice. */
const MAX_RETRIES_CAP = 10;

/** Minimum hours between two consecutive attempts. */
const MIN_RETRY_DELAY_HOURS = 0.25;

/** Amount threshold above which we attempt an automatic 50 % split. */
const SPLIT_THRESHOLD_AMOUNT = 500;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeclineCode =
  | 'insufficient_funds'
  | 'card_expired'
  | 'card_lost_stolen'
  | 'do_not_honor'
  | 'authentication_required'
  | 'generic_decline'
  | 'network_error'
  | 'processing_error';

export type OutreachChannel = 'email' | 'sms' | 'push';

export interface RetryPolicy {
  /** Maximum retry attempts (capped at MAX_RETRIES_CAP). */
  maxRetries: number;
  /** Base delay in hours for the first retry. */
  baseDelayHours: number;
  /** Multiplicative factor applied on each failure. */
  backoffMultiplier: number;
  /** Absolute ceiling on computed delay (hours). */
  maxDelayHours: number;
  /**
   * After this many consecutive failures the circuit breaker trips and retries
   * are paused for `circuitBreakerCooldownHours`.
   */
  circuitBreakerThreshold: number;
  circuitBreakerCooldownHours: number;
  /** Optional jitter in hours added to computed delay (avoids thundering herd). */
  jitterHours: number;
}

export interface RetryDecision {
  shouldRetry: boolean;
  /** Delay in hours until the next attempt. */
  delayHours: number;
  outreachChannel: OutreachChannel;
  /** Human-readable reason surfaced in the dashboard. */
  reason: string;
  /** Flag high-priority cases that need manual review. */
  escalatePriority: boolean;
  /** Suggested split amount when the charge is large and might succeed smaller. */
  splitAmount?: number;
}

/** Lightweight record of a single past success used for timing optimisation. */
export interface SuccessDataPoint {
  utcHour: number;
  utcDayOfWeek: number;
}

export interface RetryRecord {
  invoiceId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  attempts: number;
  maxAttempts: number;
  lastDeclineCode?: DeclineCode;
  cardUpdaterTriggered: boolean;
  circuitBreakerUntil?: number; // unix ms
  successHistory: SuccessDataPoint[];
  createdAt: string;
  updatedAt: string;
}

export interface CircuitBreakerStatus {
  isOpen: boolean;
  opensUntil?: number;
  trippedAt?: number;
}

export interface RetryAnalytics {
  totalInvoices: number;
  exhaustedInvoices: number;
  retryingInvoices: number;
  successRate: number;
  avgAttemptsToSuccess: number;
  declineBreakdown: Record<DeclineCode, number>;
  hourlySuccessHeatmap: number[]; // index = UTC hour 0-23
}

// ─── Decline-code recovery map ────────────────────────────────────────────────

interface DeclineProfile {
  shouldRetry: boolean;
  delayHours: number;
  outreachChannel: OutreachChannel;
  reason: string;
  escalatePriority: boolean;
}

const DECLINE_PROFILES: Record<DeclineCode, DeclineProfile> = {
  insufficient_funds: {
    shouldRetry: true,
    delayHours: 24,
    outreachChannel: 'push',
    reason: 'Insufficient funds — retry after 24 h',
    escalatePriority: false,
  },
  card_expired: {
    shouldRetry: true,
    delayHours: 1,
    outreachChannel: 'email',
    reason: 'Card expired — trigger card updater, retry after 1 h',
    escalatePriority: false,
  },
  card_lost_stolen: {
    shouldRetry: false,
    delayHours: 0,
    outreachChannel: 'email',
    reason: 'Card lost/stolen — do not retry, contact subscriber',
    escalatePriority: true,
  },
  do_not_honor: {
    shouldRetry: true,
    delayHours: 48,
    outreachChannel: 'email',
    reason: 'Do not honor — retry after 48 h',
    escalatePriority: false,
  },
  authentication_required: {
    shouldRetry: true,
    delayHours: 0.5,
    outreachChannel: 'push',
    reason: 'Authentication required — prompt subscriber via push',
    escalatePriority: false,
  },
  generic_decline: {
    shouldRetry: true,
    delayHours: 6,
    outreachChannel: 'email',
    reason: 'Generic decline — retry after 6 h',
    escalatePriority: false,
  },
  network_error: {
    shouldRetry: true,
    delayHours: 0.5,
    outreachChannel: 'email',
    reason: 'Network error — retry after 30 min',
    escalatePriority: false,
  },
  processing_error: {
    shouldRetry: true,
    delayHours: 1,
    outreachChannel: 'email',
    reason: 'Processing error — retry after 1 h',
    escalatePriority: false,
  },
};

// ─── Default retry policy ─────────────────────────────────────────────────────

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 4,
  baseDelayHours: 1,
  backoffMultiplier: 2,
  maxDelayHours: 72,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldownHours: 24,
  jitterHours: 0.5,
};

// ─── IntelligentRetryScheduler ────────────────────────────────────────────────

/**
 * Core engine.  One instance per service lifetime; state is in-memory and
 * intended to be backed by a persistent store in production.
 */
export class IntelligentRetryScheduler {
  private records = new Map<string, RetryRecord>();
  private policies = new Map<string, RetryPolicy>(); // keyed by planId

  // ── Policy management ────────────────────────────────────────────────────

  setPlanPolicy(planId: string, policy: Partial<RetryPolicy>): RetryPolicy {
    const merged: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      ...this.policies.get(planId),
      ...policy,
      maxRetries: Math.min(
        policy.maxRetries ?? this.policies.get(planId)?.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
        MAX_RETRIES_CAP,
      ),
    };
    this.policies.set(planId, merged);
    return merged;
  }

  getPlanPolicy(planId: string): RetryPolicy {
    return this.policies.get(planId) ?? DEFAULT_RETRY_POLICY;
  }

  // ── Registration ─────────────────────────────────────────────────────────

  register(
    invoiceId: string,
    subscriptionId: string,
    planId: string,
    amount: number,
    currency: string,
  ): RetryRecord {
    const policy = this.getPlanPolicy(planId);
    const record: RetryRecord = {
      invoiceId,
      subscriptionId,
      amount,
      currency,
      attempts: 0,
      maxAttempts: policy.maxRetries,
      cardUpdaterTriggered: false,
      successHistory: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.records.set(invoiceId, record);
    return record;
  }

  // ── Core decision ────────────────────────────────────────────────────────

  /**
   * Decide whether and when to retry a failed payment.
   *
   * Algorithm:
   * 1. Hard blocks (lost/stolen card, max retries, circuit breaker)
   * 2. Decline-code base delay
   * 3. Exponential backoff on top of base delay
   * 4. Historical timing shift — move retry toward the hour with highest
   *    historical success rate for this subscriber
   * 5. Jitter to spread load
   * 6. Large-amount split suggestion
   */
  decideRetry(invoiceId: string, declineCode: DeclineCode, planId: string): RetryDecision {
    const record = this.records.get(invoiceId);
    if (!record) {
      return {
        shouldRetry: false,
        delayHours: 0,
        outreachChannel: 'email',
        reason: `Invoice ${invoiceId} not registered`,
        escalatePriority: false,
      };
    }

    const policy = this.getPlanPolicy(planId);
    const profile = DECLINE_PROFILES[declineCode];

    // --- hard block: lost/stolen ---
    if (!profile.shouldRetry) {
      return { ...profile };
    }

    // --- hard block: max retries ---
    if (record.attempts >= record.maxAttempts) {
      return {
        shouldRetry: false,
        delayHours: 0,
        outreachChannel: 'sms',
        reason: `Max retries (${record.maxAttempts}) reached`,
        escalatePriority: true,
      };
    }

    // --- hard block: circuit breaker ---
    const cbStatus = this.getCircuitBreakerStatus(record, policy);
    if (cbStatus.isOpen) {
      const hoursLeft = cbStatus.opensUntil
        ? (cbStatus.opensUntil - Date.now()) / ONE_HOUR_MS
        : policy.circuitBreakerCooldownHours;
      return {
        shouldRetry: false,
        delayHours: hoursLeft,
        outreachChannel: 'email',
        reason: `Circuit breaker open — resume after ${hoursLeft.toFixed(1)} h`,
        escalatePriority: false,
      };
    }

    // --- compute delay ---
    let delayHours = profile.delayHours;
    delayHours = this.applyExponentialBackoff(delayHours, record.attempts, policy);
    delayHours = this.applyHistoricalShift(delayHours, record.successHistory);
    delayHours = this.applyJitter(delayHours, policy.jitterHours);
    delayHours = Math.max(delayHours, MIN_RETRY_DELAY_HOURS);
    delayHours = Math.min(delayHours, policy.maxDelayHours);

    // --- side-effects ---
    if (declineCode === 'card_expired' && !record.cardUpdaterTriggered) {
      record.cardUpdaterTriggered = true;
    }

    const splitAmount =
      record.amount > SPLIT_THRESHOLD_AMOUNT && record.attempts <= 1
        ? Math.round(record.amount / 2)
        : undefined;

    record.attempts += 1;
    record.lastDeclineCode = declineCode;
    record.updatedAt = new Date().toISOString();
    this.records.set(invoiceId, record);

    return {
      shouldRetry: true,
      delayHours,
      outreachChannel: profile.outreachChannel,
      reason: profile.reason,
      escalatePriority: profile.escalatePriority,
      splitAmount,
    };
  }

  // ── Success feedback ─────────────────────────────────────────────────────

  /**
   * Record a successful charge.  The UTC hour is stored and used to shift
   * future retries toward high-success windows.
   */
  recordSuccess(invoiceId: string): void {
    const record = this.records.get(invoiceId);
    if (!record) return;
    const now = new Date();
    record.successHistory.push({
      utcHour: now.getUTCHours(),
      utcDayOfWeek: now.getUTCDay(),
    });
    record.updatedAt = new Date().toISOString();
    this.records.set(invoiceId, record);
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  getRecord(invoiceId: string): RetryRecord | undefined {
    return this.records.get(invoiceId);
  }

  getAllRecords(): RetryRecord[] {
    return Array.from(this.records.values());
  }

  // ── Circuit-breaker inspection ───────────────────────────────────────────

  getCircuitBreakerStatus(record: RetryRecord, policy: RetryPolicy): CircuitBreakerStatus {
    if (record.attempts < policy.circuitBreakerThreshold) {
      return { isOpen: false };
    }
    if (record.circuitBreakerUntil == null) {
      // Trip now
      record.circuitBreakerUntil = Date.now() + policy.circuitBreakerCooldownHours * ONE_HOUR_MS;
      this.records.set(record.invoiceId, record);
    }
    if (Date.now() < record.circuitBreakerUntil) {
      return { isOpen: true, opensUntil: record.circuitBreakerUntil };
    }
    // Cooldown elapsed — reset
    record.circuitBreakerUntil = undefined;
    record.attempts = 0;
    this.records.set(record.invoiceId, record);
    return { isOpen: false };
  }

  // ── Analytics ────────────────────────────────────────────────────────────

  getAnalytics(): RetryAnalytics {
    const all = this.getAllRecords();
    const heatmap = new Array<number>(24).fill(0);
    const breakdown = {} as Record<DeclineCode, number>;

    let exhausted = 0;
    let retrying = 0;
    const successCounts: number[] = [];

    for (const r of all) {
      if (r.attempts >= r.maxAttempts) exhausted++;
      else if (r.attempts > 0) retrying++;

      for (const s of r.successHistory) {
        heatmap[s.utcHour] = (heatmap[s.utcHour] ?? 0) + 1;
      }
      if (r.successHistory.length > 0) {
        successCounts.push(r.attempts);
      }
      if (r.lastDeclineCode) {
        breakdown[r.lastDeclineCode] = (breakdown[r.lastDeclineCode] ?? 0) + 1;
      }
    }

    const totalSuccesses = all.filter((r) => r.successHistory.length > 0).length;
    const successRate = all.length > 0 ? Math.round((totalSuccesses / all.length) * 100) : 0;
    const avgAttempts =
      successCounts.length > 0
        ? successCounts.reduce((s, n) => s + n, 0) / successCounts.length
        : 0;

    return {
      totalInvoices: all.length,
      exhaustedInvoices: exhausted,
      retryingInvoices: retrying,
      successRate,
      avgAttemptsToSuccess: Math.round(avgAttempts * 10) / 10,
      declineBreakdown: breakdown,
      hourlySuccessHeatmap: heatmap,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private applyExponentialBackoff(
    baseHours: number,
    attempts: number,
    policy: RetryPolicy,
  ): number {
    if (attempts === 0) return baseHours;
    const backoff = baseHours * Math.pow(policy.backoffMultiplier, attempts);
    return Math.min(backoff, policy.maxDelayHours);
  }

  /**
   * Shift the delay so the retry lands close to the UTC hour with the most
   * historical successes.  If there is no history the delay is unchanged.
   */
  private applyHistoricalShift(
    delayHours: number,
    history: SuccessDataPoint[],
  ): number {
    if (history.length === 0) return delayHours;

    const counts = new Array<number>(24).fill(0);
    for (const h of history) counts[h.utcHour]++;
    const bestHour = counts.indexOf(Math.max(...counts));

    const nowHour = new Date().getUTCHours();
    const hoursUntilBest = (bestHour - nowHour + 24) % 24;

    // Only apply when it meaningfully aligns (within ±2 h of computed delay)
    if (Math.abs(hoursUntilBest - delayHours) <= 2) {
      return hoursUntilBest > 0 ? hoursUntilBest : delayHours;
    }
    return delayHours;
  }

  /** Add a pseudo-random jitter bounded by ±jitterHours/2. */
  private applyJitter(delayHours: number, jitterHours: number): number {
    if (jitterHours <= 0) return delayHours;
    const jitter = (Math.random() - 0.5) * jitterHours;
    return Math.max(delayHours + jitter, MIN_RETRY_DELAY_HOURS);
  }
}

// Singleton export for application-wide use
export const intelligentRetryScheduler = new IntelligentRetryScheduler();

// ─── Grace Period ─────────────────────────────────────────────────────────────

export interface GracePeriodConfig {
  /** How many hours after the first failure before the subscription is suspended. */
  durationHours: number;
  /** Whether to send reminder notifications during the grace period. */
  sendReminders: boolean;
  /** Interval (hours) between reminders while grace period is active. */
  reminderIntervalHours: number;
}

export const DEFAULT_GRACE_PERIOD_CONFIG: GracePeriodConfig = {
  durationHours: 72, // 3 days
  sendReminders: true,
  reminderIntervalHours: 24,
};

export type GracePeriodStatus = 'active' | 'expired' | 'recovered';

export interface GracePeriod {
  invoiceId: string;
  subscriptionId: string;
  startedAt: number; // unix ms
  expiresAt: number; // unix ms
  status: GracePeriodStatus;
  remindersSent: number;
  lastReminderAt?: number; // unix ms
}

// ─── Outreach Dispatcher (injectable) ────────────────────────────────────────

export interface OutreachPayload {
  subscriptionId: string;
  invoiceId: string;
  channel: OutreachChannel;
  message: string;
  escalate: boolean;
  splitAmount?: number;
}

export type OutreachDispatcher = (payload: OutreachPayload) => Promise<void>;

/** No-op dispatcher used in tests and when no dispatcher is injected. */
export const noopDispatcher: OutreachDispatcher = async (_payload) => {
  /* intentionally empty */
};

// ─── DunningOrchestrator ──────────────────────────────────────────────────────

/**
 * High-level orchestrator that wires together the IntelligentRetryScheduler,
 * grace period management, and outreach dispatch.
 *
 * Usage:
 *   const orchestrator = new DunningOrchestrator({ dispatcher: myEmailDispatcher });
 *   await orchestrator.processFailed({ invoiceId, subscriptionId, planId, amount, currency, declineCode });
 */
export interface DunningOrchestratorOptions {
  /** Override the retry scheduler instance (defaults to a fresh one). */
  scheduler?: IntelligentRetryScheduler;
  /** Callback invoked when outreach should be sent. */
  dispatcher?: OutreachDispatcher;
  /** Override grace period config per plan: planId → config. */
  gracePeriodConfigs?: Map<string, GracePeriodConfig>;
  /** Default grace period config used when no plan-specific config exists. */
  defaultGracePeriodConfig?: GracePeriodConfig;
}

export interface ProcessFailedInput {
  invoiceId: string;
  subscriptionId: string;
  planId: string;
  amount: number;
  currency: string;
  declineCode: DeclineCode;
}

export interface ProcessFailedResult {
  decision: RetryDecision;
  gracePeriod?: GracePeriod;
  outreachSent: boolean;
}

export class DunningOrchestrator {
  private readonly scheduler: IntelligentRetryScheduler;
  private readonly dispatcher: OutreachDispatcher;
  private readonly gracePeriodConfigs: Map<string, GracePeriodConfig>;
  private readonly defaultGracePeriod: GracePeriodConfig;
  private readonly gracePeriods = new Map<string, GracePeriod>();

  constructor(opts: DunningOrchestratorOptions = {}) {
    this.scheduler = opts.scheduler ?? new IntelligentRetryScheduler();
    this.dispatcher = opts.dispatcher ?? noopDispatcher;
    this.gracePeriodConfigs = opts.gracePeriodConfigs ?? new Map();
    this.defaultGracePeriod = opts.defaultGracePeriodConfig ?? DEFAULT_GRACE_PERIOD_CONFIG;
  }

  // ── Plan policy management ───────────────────────────────────────────────

  setPlanPolicy(planId: string, policy: Partial<RetryPolicy>): RetryPolicy {
    return this.scheduler.setPlanPolicy(planId, policy);
  }

  setGracePeriodConfig(planId: string, config: GracePeriodConfig): void {
    this.gracePeriodConfigs.set(planId, config);
  }

  // ── Core processing entrypoint ───────────────────────────────────────────

  /**
   * Process a failed payment attempt end-to-end:
   *  1. Register invoice if not already known.
   *  2. Run the retry decision engine.
   *  3. Start or update the grace period.
   *  4. Dispatch outreach notification.
   *
   * This is the primary method called by billing workers.
   */
  async processFailed(input: ProcessFailedInput): Promise<ProcessFailedResult> {
    const { invoiceId, subscriptionId, planId, amount, currency, declineCode } = input;

    // Ensure the invoice is registered
    if (!this.scheduler.getRecord(invoiceId)) {
      this.scheduler.register(invoiceId, subscriptionId, planId, amount, currency);
    }

    const decision = this.scheduler.decideRetry(invoiceId, declineCode, planId);

    // Manage grace period
    const gracePeriod = this.upsertGracePeriod(invoiceId, subscriptionId, planId, decision);

    // Dispatch outreach if appropriate
    let outreachSent = false;
    const shouldNotify =
      decision.shouldRetry ||
      decision.escalatePriority ||
      (gracePeriod && gracePeriod.status === 'active');

    if (shouldNotify) {
      try {
        await this.dispatcher({
          subscriptionId,
          invoiceId,
          channel: decision.outreachChannel,
          message: decision.reason,
          escalate: decision.escalatePriority,
          splitAmount: decision.splitAmount,
        });
        outreachSent = true;
      } catch {
        // Dispatch failures are non-fatal — the retry schedule is already persisted.
      }
    }

    return { decision, gracePeriod: gracePeriod ?? undefined, outreachSent };
  }

  /**
   * Mark an invoice as recovered (payment succeeded).
   * Closes the grace period and records the success timestamp.
   */
  async processSuccess(invoiceId: string): Promise<void> {
    this.scheduler.recordSuccess(invoiceId);

    const gp = this.gracePeriods.get(invoiceId);
    if (gp) {
      gp.status = 'recovered';
      this.gracePeriods.set(invoiceId, gp);
    }
  }

  // ── Grace period management ──────────────────────────────────────────────

  getGracePeriod(invoiceId: string): GracePeriod | undefined {
    return this.gracePeriods.get(invoiceId);
  }

  /**
   * Check and expire any grace periods whose time has elapsed.
   * Returns the list of expired invoice IDs — the caller should suspend
   * the corresponding subscriptions.
   */
  sweepExpiredGracePeriods(now = Date.now()): string[] {
    const expired: string[] = [];
    for (const [id, gp] of this.gracePeriods) {
      if (gp.status === 'active' && now >= gp.expiresAt) {
        gp.status = 'expired';
        this.gracePeriods.set(id, gp);
        expired.push(id);
      }
    }
    return expired;
  }

  /**
   * Tick reminder dispatch for all active grace periods.
   * Returns the list of invoice IDs for which a reminder was sent.
   */
  async tickGracePeriodReminders(now = Date.now()): Promise<string[]> {
    const reminded: string[] = [];
    for (const [id, gp] of this.gracePeriods) {
      if (gp.status !== 'active') continue;

      const record = this.scheduler.getRecord(id);
      if (!record) continue;

      const gpConfig = this.getGracePeriodConfigForInvoice(id);
      if (!gpConfig.sendReminders) continue;

      const intervalMs = gpConfig.reminderIntervalHours * ONE_HOUR_MS;
      const lastReminder = gp.lastReminderAt ?? gp.startedAt;
      if (now - lastReminder < intervalMs) continue;

      try {
        await this.dispatcher({
          subscriptionId: gp.subscriptionId,
          invoiceId: id,
          channel: 'email',
          message: `Grace period reminder: payment still pending. Expires in ${Math.max(0, Math.ceil((gp.expiresAt - now) / ONE_HOUR_MS))} hour(s).`,
          escalate: false,
        });
        gp.remindersSent += 1;
        gp.lastReminderAt = now;
        this.gracePeriods.set(id, gp);
        reminded.push(id);
      } catch {
        // Non-fatal
      }
    }
    return reminded;
  }

  // ── Analytics & inspection ───────────────────────────────────────────────

  getRetryAnalytics(): RetryAnalytics {
    return this.scheduler.getAnalytics();
  }

  getAllGracePeriods(): GracePeriod[] {
    return Array.from(this.gracePeriods.values());
  }

  getActiveGracePeriods(): GracePeriod[] {
    return this.getAllGracePeriods().filter((gp) => gp.status === 'active');
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private upsertGracePeriod(
    invoiceId: string,
    subscriptionId: string,
    planId: string,
    decision: RetryDecision,
  ): GracePeriod | null {
    // Only manage grace periods when retries are still scheduled
    if (!decision.shouldRetry && !decision.escalatePriority) return null;

    const existing = this.gracePeriods.get(invoiceId);
    if (existing && existing.status !== 'active') return existing;

    const config = this.gracePeriodConfigs.get(planId) ?? this.defaultGracePeriod;
    const now = Date.now();

    if (!existing) {
      const gp: GracePeriod = {
        invoiceId,
        subscriptionId,
        startedAt: now,
        expiresAt: now + config.durationHours * ONE_HOUR_MS,
        status: 'active',
        remindersSent: 0,
      };
      this.gracePeriods.set(invoiceId, gp);
      return gp;
    }

    return existing;
  }

  private getGracePeriodConfigForInvoice(invoiceId: string): GracePeriodConfig {
    const gp = this.gracePeriods.get(invoiceId);
    if (!gp) return this.defaultGracePeriod;
    // Try to find a record to get the plan — fall back to default
    // (plan association is stored on the retry record)
    const record = this.scheduler.getRecord(invoiceId);
    if (!record) return this.defaultGracePeriod;
    // We don't store planId on the record itself, so we use the default.
    // Per-plan grace period config is applied at processFailed time.
    return this.defaultGracePeriod;
  }
}

// ─── Singleton orchestrator ───────────────────────────────────────────────────

export const dunningOrchestrator = new DunningOrchestrator();
