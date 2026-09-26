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
});
