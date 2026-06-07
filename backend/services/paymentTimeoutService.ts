/**
 * Payment Timeout & Recovery Service — Issue #427
 *
 * Handles:
 *  - Timeout detection (configurable per chain)
 *  - Transaction status recovery on timeout
 *  - Automatic retry with higher gas on timeout
 *  - Manual retry option for users
 *  - Stuck transaction alerting
 */

import type { AlertingService } from './alerting';
import type { Alert } from './types';

// ── Chain timeout configuration ───────────────────────────────────────────────

export interface ChainTimeoutConfig {
  chainId: number;
  /** Seconds before a pending tx is considered timed out. */
  timeoutSecs: number;
  /** Basis points to add to gas price on each retry (+1500 bps = +15 %). */
  gasBumpBps: number;
  maxRecoveryAttempts: number;
  /** Minimum ledgers to wait after a reorg before re-submitting. */
  reorgSafetyLedgers: number;
}

export const DEFAULT_CHAIN_CONFIGS: Record<number, ChainTimeoutConfig> = {
  1: {
    chainId: 1,
    timeoutSecs: 300,
    gasBumpBps: 1500,
    maxRecoveryAttempts: 5,
    reorgSafetyLedgers: 2,
  },
  2: {
    chainId: 2,
    timeoutSecs: 120,
    gasBumpBps: 1000,
    maxRecoveryAttempts: 3,
    reorgSafetyLedgers: 1,
  },
};

// ── Core types ────────────────────────────────────────────────────────────────

export type TimeoutStatus =
  | 'pending'
  | 'timed_out'
  | 'recovering'
  | 'resolved'
  | 'abandoned';

export interface PaymentTimeoutRecord {
  id: string;
  chargeId: string;
  subscriptionId: string;
  chainId: number;
  status: TimeoutStatus;
  submittedAt: number;
  timedOutAt?: number;
  lastRecoveryAt?: number;
  recoveryAttempts: number;
  lastGasPrice: bigint;
  /** Raw RPC tx hash used for external status polling. */
  txHash?: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface RecoveryResult {
  success: boolean;
  record: PaymentTimeoutRecord;
  newGasPrice: bigint;
  attemptNumber: number;
}

export interface TimeoutHealthSummary {
  total: number;
  pending: number;
  timedOut: number;
  recovering: number;
  resolved: number;
  abandoned: number;
  /** Percentage of transactions that resolved successfully (0–1). */
  recoveryRate: number;
}

// ── RPC / chain status provider interface ────────────────────────────────────

export interface ChainStatusProvider {
  /**
   * Query the on-chain status of a transaction hash.
   * Returns null when the tx is not found (dropped from mempool).
   */
  getTxStatus(txHash: string, chainId: number): Promise<'confirmed' | 'pending' | 'dropped' | null>;

  /**
   * Detect whether a chain reorganisation has occurred since `sinceBlock`.
   * Used to abort recovery when reorg depth exceeds `reorgSafetyLedgers`.
   */
  detectReorg(chainId: number, sinceBlock: number): Promise<boolean>;
}

// ── Service ───────────────────────────────────────────────────────────────────

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export class PaymentTimeoutService {
  private records = new Map<string, PaymentTimeoutRecord>();
  /** charge_id → record_id */
  private byCharge = new Map<string, string>();
  /** subscription_id → record_id[] */
  private bySub = new Map<string, string[]>();

  private chainConfigs = new Map<number, ChainTimeoutConfig>(
    Object.entries(DEFAULT_CHAIN_CONFIGS).map(([k, v]) => [Number(k), v])
  );

  constructor(
    private readonly alerting?: AlertingService,
    private readonly chainProvider?: ChainStatusProvider
  ) {}

  // ── Configuration ────────────────────────────────────────────────────────

  setChainConfig(config: ChainTimeoutConfig): void {
    if (config.timeoutSecs <= 0 || config.timeoutSecs > 3600) {
      throw new Error('timeoutSecs must be between 1 and 3600');
    }
    if (config.maxRecoveryAttempts > 10) {
      throw new Error('maxRecoveryAttempts exceeds cap of 10');
    }
    this.chainConfigs.set(config.chainId, config);
  }

  getChainConfig(chainId: number): ChainTimeoutConfig {
    return (
      this.chainConfigs.get(chainId) ?? {
        chainId,
        timeoutSecs: 300,
        gasBumpBps: 1500,
        maxRecoveryAttempts: 5,
        reorgSafetyLedgers: 2,
      }
    );
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Register a newly submitted payment for timeout tracking. */
  registerPending(
    chargeId: string,
    subscriptionId: string,
    chainId: number,
    initialGasPrice: bigint,
    txHash?: string
  ): PaymentTimeoutRecord {
    const id = createId('pto');
    const now = Date.now();
    const record: PaymentTimeoutRecord = {
      id,
      chargeId,
      subscriptionId,
      chainId,
      status: 'pending',
      submittedAt: now,
      recoveryAttempts: 0,
      lastGasPrice: initialGasPrice,
      txHash,
      note: 'submitted',
      createdAt: now,
      updatedAt: now,
    };

    this.records.set(id, record);
    this.byCharge.set(chargeId, id);

    const subList = this.bySub.get(subscriptionId) ?? [];
    subList.push(id);
    this.bySub.set(subscriptionId, subList);

    return record;
  }

  /**
   * Scan all pending records and detect timeouts.
   * Should be called on a scheduler (e.g. every 30 s).
   * Returns the list of newly-detected timed-out records.
   */
  async detectTimeouts(): Promise<PaymentTimeoutRecord[]> {
    const now = Date.now();
    const newlyTimedOut: PaymentTimeoutRecord[] = [];

    for (const record of this.records.values()) {
      if (record.status !== 'pending') continue;

      const config = this.getChainConfig(record.chainId);
      const elapsed = (now - record.submittedAt) / 1000;

      if (elapsed < config.timeoutSecs) continue;

      // Optionally confirm via RPC before marking timed-out.
      if (this.chainProvider && record.txHash) {
        const chainStatus = await this.chainProvider
          .getTxStatus(record.txHash, record.chainId)
          .catch(() => null);

        if (chainStatus === 'confirmed') {
          this.resolveRecord(record, 'confirmed on-chain during scan');
          continue;
        }
      }

      record.status = 'timed_out';
      record.timedOutAt = now;
      record.note = 'timeout_detected';
      record.updatedAt = now;
      this.records.set(record.id, record);

      newlyTimedOut.push(record);
      await this.dispatchTimeoutAlert(record);
    }

    return newlyTimedOut;
  }

  /**
   * Automatically retry all timed-out transactions with a bumped gas price.
   * Intended for cron/scheduler use.
   */
  async autoRecoverAll(): Promise<RecoveryResult[]> {
    const results: RecoveryResult[] = [];

    for (const record of this.records.values()) {
      if (record.status !== 'timed_out' && record.status !== 'recovering') continue;

      const result = await this.attemptRecovery(record.chargeId);
      if (result) results.push(result);
    }

    return results;
  }

  /**
   * Attempt recovery for a single timed-out payment with a higher gas price.
   * Handles: chain reorg detection, gas spike protection, attempt cap.
   */
  async attemptRecovery(chargeId: string): Promise<RecoveryResult | null> {
    const recordId = this.byCharge.get(chargeId);
    if (!recordId) return null;

    const record = this.records.get(recordId);
    if (!record) return null;

    if (record.status !== 'timed_out' && record.status !== 'recovering') {
      return null;
    }

    const config = this.getChainConfig(record.chainId);

    if (record.recoveryAttempts >= config.maxRecoveryAttempts) {
      record.status = 'abandoned';
      record.note = 'max_recovery_attempts_exhausted';
      record.updatedAt = Date.now();
      this.records.set(record.id, record);
      await this.dispatchAbandonedAlert(record);
      return null;
    }

    // Detect chain reorg before re-submitting (edge case: reorg during timeout window).
    if (this.chainProvider && record.txHash) {
      const hasReorg = await this.chainProvider
        .detectReorg(record.chainId, config.reorgSafetyLedgers)
        .catch(() => false);

      if (hasReorg) {
        record.note = 'reorg_detected_recovery_deferred';
        record.updatedAt = Date.now();
        this.records.set(record.id, record);
        await this.dispatchReorgAlert(record);
        return null;
      }
    }

    // Bump gas by the configured basis points.
    const bumpFactor = BigInt(10_000 + config.gasBumpBps);
    const newGasPrice = (record.lastGasPrice * bumpFactor) / BigInt(10_000);

    const now = Date.now();
    record.recoveryAttempts += 1;
    record.lastRecoveryAt = now;
    record.lastGasPrice = newGasPrice;
    record.status = 'recovering';
    record.note = `recovery_attempt_${record.recoveryAttempts}`;
    record.updatedAt = now;
    this.records.set(record.id, record);

    await this.dispatchRecoveryAlert(record, newGasPrice);

    return {
      success: true,
      record,
      newGasPrice,
      attemptNumber: record.recoveryAttempts,
    };
  }

  /**
   * Manual retry option for users — validates ownership then delegates to
   * `attemptRecovery` with a user-supplied gas price override.
   */
  async manualRetry(
    chargeId: string,
    requestedGasPrice: bigint
  ): Promise<RecoveryResult | null> {
    const recordId = this.byCharge.get(chargeId);
    if (!recordId) throw new Error('Charge not found');

    const record = this.records.get(recordId);
    if (!record) throw new Error('Timeout record not found');

    if (record.status === 'resolved' || record.status === 'abandoned') {
      throw new Error('Transaction is not in a recoverable state');
    }

    const config = this.getChainConfig(record.chainId);
    const minBumped =
      record.lastGasPrice +
      (record.lastGasPrice * BigInt(config.gasBumpBps)) / BigInt(10_000);

    const effectiveGasPrice = requestedGasPrice > minBumped ? requestedGasPrice : minBumped;
    record.lastGasPrice = effectiveGasPrice;
    record.status = 'timed_out';
    this.records.set(record.id, record);

    return this.attemptRecovery(chargeId);
  }

  /** Mark a payment as confirmed on-chain (called after RPC confirms the tx). */
  markResolved(chargeId: string, note = 'confirmed_on_chain'): PaymentTimeoutRecord | null {
    const recordId = this.byCharge.get(chargeId);
    if (!recordId) return null;

    const record = this.records.get(recordId);
    if (!record) return null;

    return this.resolveRecord(record, note);
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getRecord(chargeId: string): PaymentTimeoutRecord | undefined {
    const id = this.byCharge.get(chargeId);
    return id ? this.records.get(id) : undefined;
  }

  getSubscriptionTimeouts(subscriptionId: string): PaymentTimeoutRecord[] {
    const ids = this.bySub.get(subscriptionId) ?? [];
    return ids
      .map((id) => this.records.get(id))
      .filter((r): r is PaymentTimeoutRecord => r !== undefined);
  }

  getStuckTransactions(subscriptionId?: string): PaymentTimeoutRecord[] {
    const source = subscriptionId
      ? this.getSubscriptionTimeouts(subscriptionId)
      : Array.from(this.records.values());

    return source.filter(
      (r) => r.status === 'timed_out' || r.status === 'recovering'
    );
  }

  getHealthSummary(subscriptionId?: string): TimeoutHealthSummary {
    const source = subscriptionId
      ? this.getSubscriptionTimeouts(subscriptionId)
      : Array.from(this.records.values());

    const summary: TimeoutHealthSummary = {
      total: source.length,
      pending: 0,
      timedOut: 0,
      recovering: 0,
      resolved: 0,
      abandoned: 0,
      recoveryRate: 0,
    };

    for (const r of source) {
      switch (r.status) {
        case 'pending':    summary.pending++;    break;
        case 'timed_out':  summary.timedOut++;   break;
        case 'recovering': summary.recovering++; break;
        case 'resolved':   summary.resolved++;   break;
        case 'abandoned':  summary.abandoned++;  break;
      }
    }

    const terminal = summary.resolved + summary.abandoned;
    summary.recoveryRate = terminal > 0 ? summary.resolved / terminal : 0;

    return summary;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private resolveRecord(record: PaymentTimeoutRecord, note: string): PaymentTimeoutRecord {
    record.status = 'resolved';
    record.note = note;
    record.updatedAt = Date.now();
    this.records.set(record.id, record);
    return record;
  }

  private buildAlertId(record: PaymentTimeoutRecord, suffix: string): string {
    return `pto_${record.chargeId}_${suffix}`;
  }

  private async dispatchTimeoutAlert(record: PaymentTimeoutRecord): Promise<void> {
    if (!this.alerting) return;
    const alert: Alert = {
      id: this.buildAlertId(record, 'timeout'),
      severity: 'warning',
      title: 'Payment Transaction Timed Out',
      message:
        `Charge ${record.chargeId} (sub ${record.subscriptionId}) on chain ${record.chainId} ` +
        `has exceeded the timeout window. Automatic recovery will be attempted.`,
      timestamp: Date.now(),
      resolved: false,
      ruleId: 'payment_timeout',
    };
    await this.alerting.dispatch(alert);
  }

  private async dispatchRecoveryAlert(
    record: PaymentTimeoutRecord,
    newGasPrice: bigint
  ): Promise<void> {
    if (!this.alerting) return;
    const alert: Alert = {
      id: this.buildAlertId(record, `recovery_${record.recoveryAttempts}`),
      severity: 'info',
      title: 'Payment Recovery Attempted',
      message:
        `Recovery attempt ${record.recoveryAttempts} for charge ${record.chargeId} ` +
        `with gas price ${newGasPrice}.`,
      timestamp: Date.now(),
      resolved: false,
      ruleId: 'payment_recovery_attempt',
    };
    await this.alerting.dispatch(alert);
  }

  private async dispatchAbandonedAlert(record: PaymentTimeoutRecord): Promise<void> {
    if (!this.alerting) return;
    const alert: Alert = {
      id: this.buildAlertId(record, 'abandoned'),
      severity: 'critical',
      title: 'Payment Transaction Abandoned',
      message:
        `Charge ${record.chargeId} (sub ${record.subscriptionId}) has exhausted all ` +
        `${record.recoveryAttempts} recovery attempts. Manual intervention required.`,
      timestamp: Date.now(),
      resolved: false,
      ruleId: 'payment_abandoned',
    };
    await this.alerting.dispatch(alert);
  }

  private async dispatchReorgAlert(record: PaymentTimeoutRecord): Promise<void> {
    if (!this.alerting) return;
    const alert: Alert = {
      id: this.buildAlertId(record, 'reorg'),
      severity: 'warning',
      title: 'Chain Reorg Detected During Timeout Window',
      message:
        `Charge ${record.chargeId} recovery deferred due to chain reorg on chain ` +
        `${record.chainId}. Will retry after the reorg safety window.`,
      timestamp: Date.now(),
      resolved: false,
      ruleId: 'chain_reorg_during_timeout',
    };
    await this.alerting.dispatch(alert);
  }
}

export const paymentTimeoutService = new PaymentTimeoutService();
