import { MonitoringService } from './monitoring';
import type { TransactionEvent } from './types';

export interface BatchChargeCandidate {
  subscriptionId: string;
  amount: number;
  nextBillingDate: Date;
  isActive?: boolean;
}

export interface BatchChargeOptions {
  atomic?: boolean;
  includeOverdue?: boolean;
  maxBatchSize?: number;
  singleTransactionGas?: number;
  batchBaseGas?: number;
  perItemGas?: number;
}

export interface BatchChargeResult {
  runId: string;
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  skippedItems: number;
  amountCharged: number;
  gasEstimate: number;
  savings: {
    singleTxGas: number;
    batchGas: number;
    saved: number;
    percent: number;
  };
  state: 'completed' | 'partial' | 'failed';
  startedAt: number;
  completedAt: number;
  errors: string[];
}

export class BatchChargeService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastMatchTimestamp = 0;
  private runHistory: BatchChargeResult[] = [];
  private maxHistory = 50;
  private cronExpression = '0 0 * * *';
  private checkIntervalMs = 60_000;
  private singleTransactionGas = 150_000;
  private batchBaseGas = 50_000;
  private perItemGas = 100_000;

  constructor(options?: { checkIntervalMs?: number; singleTransactionGas?: number; batchBaseGas?: number; perItemGas?: number }) {
    if (options?.checkIntervalMs) this.checkIntervalMs = options.checkIntervalMs;
    if (options?.singleTransactionGas) this.singleTransactionGas = options.singleTransactionGas;
    if (options?.batchBaseGas) this.batchBaseGas = options.batchBaseGas;
    if (options?.perItemGas) this.perItemGas = options.perItemGas;
  }

  static selectDueToday(subscriptions: BatchChargeCandidate[]): BatchChargeCandidate[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return subscriptions.filter((sub) => {
      const billing = new Date(sub.nextBillingDate);
      billing.setHours(0, 0, 0, 0);
      return billing.getTime() === today.getTime() && sub.isActive !== false;
    });
  }

  static selectOverdue(subscriptions: BatchChargeCandidate[]): BatchChargeCandidate[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return subscriptions.filter((sub) => {
      const billing = new Date(sub.nextBillingDate);
      billing.setHours(0, 0, 0, 0);
      return billing.getTime() < today.getTime() && sub.isActive !== false;
    });
  }

  static buildChargeItems(subscriptions: BatchChargeCandidate[]): Array<{ subscriptionId: string; amount: number }> {
    return subscriptions.map((s) => ({ subscriptionId: s.subscriptionId, amount: s.amount }));
  }

  getGasEstimate(itemCount: number): number {
    return this.batchBaseGas + itemCount * this.perItemGas;
  }

  getSavings(itemCount: number): { singleTxGas: number; batchGas: number; saved: number; percent: number } {
    const singleTxGas = this.singleTransactionGas * itemCount;
    const batchGas = this.getGasEstimate(itemCount);
    const saved = singleTxGas - batchGas;
    const percent = itemCount > 0 ? Math.round((saved / singleTxGas) * 100) : 0;
    return { singleTxGas, batchGas, saved, percent };
  }

  async executeBatchCharge(
    subscriptions: BatchChargeCandidate[],
    chargeFn: (id: string, amount: number) => Promise<boolean>,
    monitoring: MonitoringService,
    options?: BatchChargeOptions,
  ): Promise<BatchChargeResult> {
    const atomic = options?.atomic ?? false;
    const includeOverdue = options?.includeOverdue ?? true;
    const maxBatchSize = options?.maxBatchSize ?? 100;

    const candidates = includeOverdue
      ? [...BatchChargeService.selectDueToday(subscriptions), ...BatchChargeService.selectOverdue(subscriptions)]
      : BatchChargeService.selectDueToday(subscriptions);

    const items = candidates.slice(0, maxBatchSize);
    const startedAt = Date.now();
    const runId = `batch_${startedAt.toString(36)}`;
    const gasEstimate = this.getGasEstimate(items.length);
    const savings = this.getSavings(items.length);

    let successfulItems = 0;
    let failedItems = 0;
    let skippedItems = 0;
    let amountCharged = 0;
    const errors: string[] = [];
    let state: BatchChargeResult['state'] = 'completed';

    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      const success = await chargeFn(item.subscriptionId, item.amount);
      const transaction: TransactionEvent = {
        id: `${runId}_${idx}`,
        subscriptionId: item.subscriptionId,
        amount: item.amount,
        currency: 'USD',
        status: success ? 'success' : 'failed',
        timestamp: Date.now(),
        gasUsed: this.perItemGas,
        errorMessage: success ? undefined : `Charge failed for ${item.subscriptionId}`,
      };
      monitoring.recordTransaction(transaction);

      if (success) {
        successfulItems += 1;
        amountCharged += item.amount;
      } else {
        failedItems += 1;
        errors.push(transaction.errorMessage || 'Charge failed');
        if (atomic) {
          skippedItems = items.length - idx - 1;
          state = 'failed';
          break;
        }
      }
    }

    if (!atomic && failedItems > 0) {
      state = successfulItems > 0 ? 'partial' : 'failed';
    }

    const completedAt = Date.now();
    const result: BatchChargeResult = {
      runId,
      totalItems: items.length,
      successfulItems,
      failedItems,
      skippedItems,
      amountCharged,
      gasEstimate,
      savings,
      state,
      startedAt,
      completedAt,
      errors,
    };

    this.recordRun(result);
    return result;
  }

  scheduleBatchCharge(
    cronExpression: string,
    loadSubscriptions: () => Promise<BatchChargeCandidate[]>,
    chargeFn: (id: string, amount: number) => Promise<boolean>,
    monitoring: MonitoringService,
    options?: BatchChargeOptions,
  ): void {
    this.cronExpression = cronExpression;
    if (this.intervalHandle) return;

    this.intervalHandle = setInterval(async () => {
      const now = new Date();
      if (!this.matchesCron(now) || this.lastMatchTimestamp === this.cronMinuteKey(now)) {
        return;
      }
      this.lastMatchTimestamp = this.cronMinuteKey(now);
      const subscriptions = await loadSubscriptions();
      await this.executeBatchCharge(subscriptions, chargeFn, monitoring, options);
    }, this.checkIntervalMs);
  }

  stopSchedule(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  getRecentRuns(): BatchChargeResult[] {
    return [...this.runHistory];
  }

  private recordRun(result: BatchChargeResult): void {
    this.runHistory.unshift(result);
    if (this.runHistory.length > this.maxHistory) {
      this.runHistory = this.runHistory.slice(0, this.maxHistory);
    }
  }

  private matchesCron(date: Date): boolean {
    const parts = this.cronExpression.trim().split(/\s+/);
    if (parts.length !== 5) {
      return false;
    }
    const [minuteExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;
    const minute = date.getMinutes();
    const hour = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const weekday = date.getDay();

    return (
      this.matchCronField(minuteExpr, minute) &&
      this.matchCronField(hourExpr, hour) &&
      this.matchCronField(domExpr, day) &&
      this.matchCronField(monthExpr, month) &&
      this.matchCronField(dowExpr, weekday)
    );
  }

  private matchCronField(expression: string, value: number): boolean {
    if (expression === '*') return true;
    const parts = expression.split(',');
    for (const part of parts) {
      if (part.includes('/')) {
        const [base, step] = part.split('/');
        const stepValue = parseInt(step, 10);
        if (Number.isNaN(stepValue) || stepValue <= 0) continue;
        if (base === '*') {
          if (value % stepValue === 0) return true;
          continue;
        }
      }
      const parsed = parseInt(part, 10);
      if (!Number.isNaN(parsed) && parsed === value) {
        return true;
      }
    }
    return false;
  }

  private cronMinuteKey(date: Date): number {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes());
  }
}
