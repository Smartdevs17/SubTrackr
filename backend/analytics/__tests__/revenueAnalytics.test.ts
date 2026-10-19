/**
 * Tests for RevenueAnalyticsService
 * Closes #1141
 */

import { RevenueAnalyticsService, type SubscriptionRecord } from "../domain/RevenueAnalyticsService";

describe("RevenueAnalyticsService", () => {
  const mockPool = {
    query: jest.fn(),
  } as any;

  const service = new RevenueAnalyticsService(mockPool);

  const makeSub = (overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
    id: "sub-1",
    userId: "user-1",
    planId: "plan-1",
    amount: 100,
    currency: "USD",
    billingCycle: "monthly",
    status: "active",
    startedAt: new Date("2026-01-01"),
    canceledAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  });

  describe("computeMrr", () => {
    it("computes MRR for monthly subscriptions", () => {
      const subs = [makeSub({ amount: 100 }), makeSub({ amount: 50, id: "sub-2" })];
      expect(service.computeMrr(subs)).toBe(150);
    });

    it("normalizes annual subscriptions to monthly", () => {
      const subs = [makeSub({ amount: 1200, billingCycle: "annual" })];
      expect(service.computeMrr(subs)).toBe(100);
    });

    it("normalizes quarterly subscriptions to monthly", () => {
      const subs = [makeSub({ amount: 300, billingCycle: "quarterly" })];
      expect(service.computeMrr(subs)).toBe(100);
    });

    it("excludes canceled subscriptions", () => {
      const subs = [makeSub({ amount: 100 }), makeSub({ amount: 50, status: "canceled" })];
      expect(service.computeMrr(subs)).toBe(100);
    });

    it("includes trialing subscriptions", () => {
      const subs = [makeSub({ amount: 100, status: "trialing" })];
      expect(service.computeMrr(subs)).toBe(100);
    });

    it("returns 0 for empty array", () => {
      expect(service.computeMrr([])).toBe(0);
    });
  });

  describe("computeArr", () => {
    it("computes ARR from MRR", () => {
      expect(service.computeArr(1000)).toBe(12000);
    });

    it("returns 0 for 0 MRR", () => {
      expect(service.computeArr(0)).toBe(0);
    });
  });

  describe("computeChurnRate", () => {
    it("computes customer churn rate", () => {
      const result = service.computeChurnRate(100, 5, 10000, 500);
      expect(result.customerChurnRate).toBe(0.05);
      expect(result.revenueChurnRate).toBe(0.05);
    });

    it("returns 0 when no customers at start", () => {
      const result = service.computeChurnRate(0, 5, 0, 500);
      expect(result.customerChurnRate).toBe(0);
      expect(result.revenueChurnRate).toBe(0);
    });
  });

  describe("buildRevenueReport", () => {
    const entries = [
      { id: "sale", merchantId: "m1", type: "revenue" as const, amount: 100, currency: "USD", occurredAt: new Date("2026-02-02") },
      { id: "refund", merchantId: "m1", type: "refund" as const, amount: -20, currency: "USD", occurredAt: new Date("2026-02-03") },
      { id: "credit", merchantId: "m1", type: "adjustment" as const, amount: -5, currency: "USD", occurredAt: new Date("2026-02-04") },
      { id: "outside", merchantId: "m2", type: "revenue" as const, amount: 999, currency: "USD", occurredAt: new Date("2026-01-01") },
    ];

    it("reports revenue, refunds and adjustments on separate lines", () => {
      const report = service.buildRevenueReport(entries);
      expect(report.lines.revenue.map((entry) => entry.id)).toEqual(["sale", "outside"]);
      expect(report.lines.refund.map((entry) => entry.id)).toEqual(["refund"]);
      expect(report.lines.adjustment.map((entry) => entry.id)).toEqual(["credit"]);
      expect(report.totals).toEqual({ revenue: 1099, refunds: 20, adjustments: -5, netRevenue: 1074 });
    });

    it("filters inclusively by period and merchant", () => {
      const report = service.buildRevenueReport(entries, {
        merchantId: "m1",
        from: new Date("2026-02-03"),
        to: new Date("2026-02-04T23:59:59Z"),
      });
      expect(report.totals).toEqual({ revenue: 0, refunds: 20, adjustments: -5, netRevenue: -25 });
    });
  });
});
