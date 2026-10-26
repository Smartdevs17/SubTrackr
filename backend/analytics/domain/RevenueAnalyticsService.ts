/**
 * RevenueAnalyticsService
 *
 * Computes MRR (Monthly Recurring Revenue), ARR (Annual Recurring Revenue),
 * and churn rate from subscription records.
 *
 * Closes #1141
 */

import type { Pool } from "../../shared/db/connectionPool";

export interface SubscriptionRecord {
  id: string;
  userId: string;
  planId: string;
  amount: number;
  currency: string;
  billingCycle: "monthly" | "annual" | "quarterly";
  status: "active" | "canceled" | "past_due" | "trialing";
  startedAt: Date;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MrrSnapshot {
  date: string;
  mrr: number;
  newMrr: number;
  expansionMrr: number;
  churnedMrr: number;
  contractionMrr: number;
  netNewMrr: number;
}

export interface ChurnSnapshot {
  period: string;
  customerChurnRate: number;
  revenueChurnRate: number;
  customersLost: number;
  revenueLost: number;
  totalCustomers: number;
  totalRevenue: number;
}

export interface RevenueDashboardData {
  currentMrr: number;
  currentArr: number;
  mrrHistory: MrrSnapshot[];
  churnHistory: ChurnSnapshot[];
  averageChurnRate: number;
  mrrGrowthRate: number;
  netRevenueRetention: number;
  generatedAt: string;
}

export type RevenueEntryType = "revenue" | "refund" | "adjustment";

export interface RevenueEntry {
  id: string;
  merchantId: string;
  type: RevenueEntryType;
  amount: number;
  currency: string;
  occurredAt: Date;
}

export interface RevenueReportFilter {
  from?: Date;
  to?: Date;
  merchantId?: string;
}

export interface RevenueReport {
  lines: Record<RevenueEntryType, RevenueEntry[]>;
  totals: {
    revenue: number;
    refunds: number;
    adjustments: number;
    netRevenue: number;
  };
  period: { from: string | null; to: string | null };
}

export class RevenueAnalyticsService {
  constructor(private readonly pool: Pool) {}

  /**
   * Compute MRR from active subscriptions.
   * Monthly = amount; Annual = amount / 12; Quarterly = amount / 3
   */
  computeMrr(subscriptions: SubscriptionRecord[]): number {
    return subscriptions
      .filter((s) => s.status === "active" || s.status === "trialing")
      .reduce((sum, s) => {
        const monthlyAmount =
          s.billingCycle === "annual"
            ? s.amount / 12
            : s.billingCycle === "quarterly"
              ? s.amount / 3
              : s.amount;
        return sum + monthlyAmount;
      }, 0);
  }

  /**
   * ARR = MRR * 12
   */
  computeArr(mrr: number): number {
    return mrr * 12;
  }

  /**
   * Build a period report without folding refunds and adjustments into gross
   * revenue. Refund amounts are reported as positive values and deducted from
   * net revenue; adjustments retain their sign.
   */
  buildRevenueReport(entries: RevenueEntry[], filter: RevenueReportFilter = {}): RevenueReport {
    if (filter.from && filter.to && filter.from > filter.to) {
      throw new RangeError("Revenue report start date must not be after end date");
    }

    const { from, to, merchantId } = filter;
    const filtered = entries.filter((entry) => {
      const occurredAt = new Date(entry.occurredAt);
      return (
        (!merchantId || entry.merchantId === merchantId) &&
        (!from || occurredAt >= from) &&
        (!to || occurredAt <= to)
      );
    });
    const lines: RevenueReport["lines"] = { revenue: [], refund: [], adjustment: [] };
    for (const entry of filtered) lines[entry.type].push(entry);

    const round = (value: number) => Math.round(value * 100) / 100;
    const revenue = round(lines.revenue.reduce((sum, entry) => sum + entry.amount, 0));
    const refunds = round(lines.refund.reduce((sum, entry) => sum + Math.abs(entry.amount), 0));
    const adjustments = round(lines.adjustment.reduce((sum, entry) => sum + entry.amount, 0));

    return {
      lines,
      totals: {
        revenue,
        refunds,
        adjustments,
        netRevenue: round(revenue - refunds + adjustments),
      },
      period: {
        from: filter.from?.toISOString() ?? null,
        to: filter.to?.toISOString() ?? null,
      },
    };
  }

  /**
   * Compute churn rate for a period.
   * Customer churn = customers lost / total customers at start
   * Revenue churn = revenue lost / total revenue at start
   */
  computeChurnRate(
    customersAtStart: number,
    customersLost: number,
    revenueAtStart: number,
    revenueLost: number,
  ): { customerChurnRate: number; revenueChurnRate: number } {
    const customerChurnRate =
      customersAtStart > 0 ? customersLost / customersAtStart : 0;
    const revenueChurnRate =
      revenueAtStart > 0 ? revenueLost / revenueAtStart : 0;
    return { customerChurnRate, revenueChurnRate };
  }

  /**
   * Fetch active subscriptions from the database.
   */
  async getActiveSubscriptions(): Promise<SubscriptionRecord[]> {
    const result = await this.pool.query(
      `SELECT id, user_id, plan_id, amount, currency, billing_cycle,
              status, started_at, canceled_at, created_at, updated_at
       FROM subscriptions
       WHERE status IN ($1, $2)
       ORDER BY created_at DESC`,
      ["active", "trialing"],
    );
    return result.rows as unknown as SubscriptionRecord[];
  }

  /**
   * Fetch canceled subscriptions for a date range.
   */
  async getCanceledSubscriptions(
    startDate: Date,
    endDate: Date,
  ): Promise<SubscriptionRecord[]> {
    const result = await this.pool.query(
      `SELECT id, user_id, plan_id, amount, currency, billing_cycle,
              status, started_at, canceled_at, created_at, updated_at
       FROM subscriptions
       WHERE status = $1 AND canceled_at >= $2 AND canceled_at <= $3
       ORDER BY canceled_at DESC`,
      ["canceled", startDate, endDate],
    );
    return result.rows as unknown as SubscriptionRecord[];
  }

  /**
   * Build the full revenue analytics dashboard data.
   */
  async getDashboardData(months: number = 12): Promise<RevenueDashboardData> {
    const activeSubs = await this.getActiveSubscriptions();
    const currentMrr = this.computeMrr(activeSubs);
    const currentArr = this.computeArr(currentMrr);

    const now = new Date();
    const mrrHistory: MrrSnapshot[] = [];
    const churnHistory: ChurnSnapshot[] = [];

    for (let i = months - 1; i >= 0; i--) {
      const periodEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const periodStart = new Date(now.getFullYear(), now.getMonth() - i, 1);

      const periodActive = activeSubs.filter(
        (s) => new Date(s.startedAt) <= periodEnd,
      );
      const periodCanceled = await this.getCanceledSubscriptions(
        periodStart,
        periodEnd,
      );

      const periodMrr = this.computeMrr(periodActive);
      const newSubs = activeSubs.filter(
        (s) =>
          new Date(s.startedAt) >= periodStart &&
          new Date(s.startedAt) <= periodEnd,
      );
      const newMrr = this.computeMrr(newSubs);
      const churnedMrr = this.computeMrr(periodCanceled);

      mrrHistory.push({
        date: periodStart.toISOString().slice(0, 10),
        mrr: Math.round(periodMrr * 100) / 100,
        newMrr: Math.round(newMrr * 100) / 100,
        expansionMrr: 0,
        churnedMrr: Math.round(churnedMrr * 100) / 100,
        contractionMrr: 0,
        netNewMrr: Math.round((newMrr - churnedMrr) * 100) / 100,
      });

      const totalCustomersAtStart = activeSubs.filter(
        (s) => new Date(s.startedAt) < periodStart,
      ).length;
      const { customerChurnRate, revenueChurnRate } = this.computeChurnRate(
        totalCustomersAtStart,
        periodCanceled.length,
        periodMrr,
        churnedMrr,
      );

      churnHistory.push({
        period: periodStart.toISOString().slice(0, 7),
        customerChurnRate: Math.round(customerChurnRate * 10000) / 100,
        revenueChurnRate: Math.round(revenueChurnRate * 10000) / 100,
        customersLost: periodCanceled.length,
        revenueLost: Math.round(churnedMrr * 100) / 100,
        totalCustomers: totalCustomersAtStart,
        totalRevenue: Math.round(periodMrr * 100) / 100,
      });
    }

    const averageChurnRate =
      churnHistory.length > 0
        ? churnHistory.reduce((sum, c) => sum + c.customerChurnRate, 0) /
          churnHistory.length
        : 0;

    const recentMrr = mrrHistory.slice(-2);
    const mrrGrowthRate =
      recentMrr.length === 2 && recentMrr[0].mrr > 0
        ? ((recentMrr[1].mrr - recentMrr[0].mrr) / recentMrr[0].mrr) * 100
        : 0;

    const netRevenueRetention =
      currentMrr > 0 && recentMrr.length === 2
        ? ((recentMrr[1].mrr - recentMrr[0].churnedMrr) / recentMrr[0].mrr) * 100
        : 100;

    return {
      currentMrr: Math.round(currentMrr * 100) / 100,
      currentArr: Math.round(currentArr * 100) / 100,
      mrrHistory,
      churnHistory,
      averageChurnRate: Math.round(averageChurnRate * 100) / 100,
      mrrGrowthRate: Math.round(mrrGrowthRate * 100) / 100,
      netRevenueRetention: Math.round(netRevenueRetention * 100) / 100,
      generatedAt: now.toISOString(),
    };
  }
}
