/**
 * usage_billing_close cron
 *
 * At the end of each billing period, converts accumulated usage into billable
 * line items per meter (via TieredPricingCalculator) and resets the meter's
 * running totals so the next period starts clean.
 *
 * Designed to run on a configurable interval inside a Node.js process; swap
 * the setInterval for a real scheduler (cron, BullMQ, EventBridge) in production.
 */
import { MeterUsageBreakdown, QuotaMetric } from '../../../src/types/usage';
import { MeteringService, meteringService } from './meteringService';
import { TieredPricingCalculator } from './tieredPricingCalculator';

export interface UsageBillingCloseEntry {
  userId: string;
  metricType: string;
  breakdown: MeterUsageBreakdown;
}

export interface UsageBillingCloseReport {
  closedAt: string;
  entries: UsageBillingCloseEntry[];
}

export interface MeterAccount {
  userId: string;
  metricType: 'api' | 'compute' | 'storage';
  metric: QuotaMetric;
  calculator: TieredPricingCalculator;
}

export class UsageBillingCloseCron {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private accounts: MeterAccount[] = [];

  constructor(
    private readonly service: MeteringService = meteringService,
    private readonly intervalMs = 24 * 60 * 60 * 1000
  ) {}

  /** Register a (user, metric) pair to be closed out by this cron. */
  registerAccount(account: MeterAccount): void {
    this.accounts.push(account);
  }

  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => this.runOnce(), this.intervalMs);
    if (this.intervalHandle.unref) this.intervalHandle.unref();
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Closes the current period for every registered account and resets it. */
  runOnce(): UsageBillingCloseReport {
    const entries: UsageBillingCloseEntry[] = [];

    for (const account of this.accounts) {
      const unitsUsed = this.service.getCurrentPeriodConsumption(account.userId, account.metricType);
      const priced = account.calculator.calculate(unitsUsed);
      const includedUnits = priced.lines.find((l) => l.tier.unitPrice === 0)?.unitsInTier ?? 0;

      entries.push({
        userId: account.userId,
        metricType: account.metricType,
        breakdown: {
          metric: account.metric,
          unitsUsed,
          includedUnits,
          billableUnits: Math.max(0, unitsUsed - includedUnits),
          amount: priced.totalAmount,
        },
      });

      this.service.resetPeriod(account.userId, account.metricType);
    }

    return { closedAt: new Date().toISOString(), entries };
  }
}

export const usageBillingCloseCron = new UsageBillingCloseCron();
