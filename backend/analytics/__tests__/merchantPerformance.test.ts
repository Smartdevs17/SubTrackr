import { MerchantPerformanceService } from "../domain/MerchantPerformanceService";

describe("MerchantPerformanceService", () => {
  const service = new MerchantPerformanceService();
  const entries = [
    { id: "1", merchantId: "m1", type: "revenue" as const, amount: 100, currency: "USD", occurredAt: new Date("2026-03-01") },
    { id: "2", merchantId: "m2", type: "revenue" as const, amount: 900, currency: "USD", occurredAt: new Date("2026-03-01") },
  ];
  const subscriptions = [
    { merchantId: "m1", status: "active" as const },
    { merchantId: "m1", status: "canceled" as const },
    { merchantId: "m2", status: "past_due" as const },
  ];

  it("scopes every performance metric to the requested merchant", () => {
    expect(service.getMetrics("m1", entries, subscriptions)).toMatchObject({
      merchantId: "m1",
      grossRevenue: 100,
      netRevenue: 100,
      activeSubscriptions: 1,
      pastDueSubscriptions: 0,
      churnRate: 50,
    });
  });

  it("exports metrics as CSV and JSON", () => {
    const metrics = service.getMetrics("m1", entries, subscriptions);
    expect(service.export(metrics, "csv")).toContain('"merchant_id","m1"');
    expect(JSON.parse(service.export(metrics, "json"))).toMatchObject({ merchantId: "m1" });
  });
});
