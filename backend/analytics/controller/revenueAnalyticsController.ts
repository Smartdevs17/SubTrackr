/**
 * Revenue Analytics Controller
 *
 * REST endpoints for MRR, ARR, and churn analytics dashboard.
 * Closes #1141
 */

import type { Pool } from "../../shared/db/connectionPool";
import { RevenueAnalyticsService, type RevenueDashboardData } from "../domain/RevenueAnalyticsService";

export interface RevenueAnalyticsControllerDeps {
  pool: Pool;
}

export function createRevenueAnalyticsController(deps: RevenueAnalyticsControllerDeps) {
  const service = new RevenueAnalyticsService(deps.pool);

  return {
    /**
     * GET /analytics/revenue
     * Returns the full revenue dashboard data (MRR, ARR, churn).
     */
    async getDashboard(months?: number): Promise<{ success: boolean; data?: RevenueDashboardData; status?: number; error?: string }> {
      try {
        const period = months && months > 0 && months <= 36 ? months : 12;
        const data = await service.getDashboardData(period);
        return { success: true, data };
      } catch (err) {
        console.error("[RevenueAnalytics] Error generating dashboard:", err);
        return { success: false, status: 500, error: "Failed to generate revenue analytics" };
      }
    },

    /**
     * GET /analytics/revenue/mrr
     * Returns current MRR only.
     */
    async getCurrentMrr(): Promise<{ success: boolean; data?: { mrr: number; arr: number }; status?: number; error?: string }> {
      try {
        const subs = await service.getActiveSubscriptions();
        const mrr = service.computeMrr(subs);
        const arr = service.computeArr(mrr);
        return { success: true, data: { mrr: Math.round(mrr * 100) / 100, arr: Math.round(arr * 100) / 100 } };
      } catch (err) {
        console.error("[RevenueAnalytics] Error fetching MRR:", err);
        return { success: false, status: 500, error: "Failed to fetch MRR" };
      }
    },

    /**
     * GET /analytics/revenue/churn
     * Returns churn history.
     */
    async getChurnHistory(months?: number): Promise<{ success: boolean; data?: unknown; status?: number; error?: string }> {
      try {
        const period = months && months > 0 && months <= 36 ? months : 12;
        const dashboard = await service.getDashboardData(period);
        return { success: true, data: dashboard.churnHistory };
      } catch (err) {
        console.error("[RevenueAnalytics] Error fetching churn history:", err);
        return { success: false, status: 500, error: "Failed to fetch churn history" };
      }
    },
  };
}

export type RevenueAnalyticsController = ReturnType<typeof createRevenueAnalyticsController>;
