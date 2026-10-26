import type { RevenueEntry, RevenueReportFilter } from "./RevenueAnalyticsService";
import { RevenueAnalyticsService } from "./RevenueAnalyticsService";
import type { Pool } from "../../shared/db/connectionPool";

export interface MerchantSubscriptionMetric {
  merchantId: string;
  status: "active" | "canceled" | "past_due" | "trialing";
}

export interface MerchantPerformanceMetrics {
  merchantId: string;
  grossRevenue: number;
  refunds: number;
  adjustments: number;
  netRevenue: number;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  churnRate: number;
  generatedAt: string;
}

export class MerchantPerformanceService {
  private readonly revenue = new RevenueAnalyticsService({} as Pool);

  getMetrics(
    merchantId: string,
    entries: RevenueEntry[],
    subscriptions: MerchantSubscriptionMetric[],
    period: Omit<RevenueReportFilter, "merchantId"> = {},
  ): MerchantPerformanceMetrics {
    if (!merchantId.trim()) throw new Error("merchantId is required");

    const report = this.revenue.buildRevenueReport(entries, { ...period, merchantId });
    const scoped = subscriptions.filter((subscription) => subscription.merchantId === merchantId);
    const activeSubscriptions = scoped.filter(
      (subscription) =>
        subscription.status === "active" || subscription.status === "trialing",
    ).length;
    const canceled = scoped.filter(
      (subscription) => subscription.status === "canceled",
    ).length;
    const pastDueSubscriptions = scoped.filter(
      (subscription) => subscription.status === "past_due",
    ).length;

    return {
      merchantId,
      grossRevenue: report.totals.revenue,
      refunds: report.totals.refunds,
      adjustments: report.totals.adjustments,
      netRevenue: report.totals.netRevenue,
      activeSubscriptions,
      pastDueSubscriptions,
      churnRate: scoped.length ? Math.round((canceled / scoped.length) * 10_000) / 100 : 0,
      generatedAt: new Date().toISOString(),
    };
  }

  export(metrics: MerchantPerformanceMetrics, format: "csv" | "json"): string {
    if (format === "json") return JSON.stringify(metrics, null, 2);

    const rows: Array<[string, string | number]> = [
      ["merchant_id", metrics.merchantId],
      ["gross_revenue", metrics.grossRevenue],
      ["refunds", metrics.refunds],
      ["adjustments", metrics.adjustments],
      ["net_revenue", metrics.netRevenue],
      ["active_subscriptions", metrics.activeSubscriptions],
      ["past_due_subscriptions", metrics.pastDueSubscriptions],
      ["churn_rate_percent", metrics.churnRate],
      ["generated_at", metrics.generatedAt],
    ];
    const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    return ["metric,value", ...rows.map(([name, value]) => `${escape(name)},${escape(value)}`)].join("\n");
  }
}
