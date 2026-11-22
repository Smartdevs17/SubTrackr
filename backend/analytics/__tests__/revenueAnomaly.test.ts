import { RevenueAnomalyService } from "../domain/RevenueAnomalyService";

describe("RevenueAnomalyService", () => {
  const notifier = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new RevenueAnomalyService(notifier);

  beforeEach(() => notifier.send.mockClear());

  it("uses the configured percentage threshold", () => {
    expect(service.detect("m1", 100, 119, { thresholdPercent: 20, channels: [] })).toBeNull();
    expect(service.detect("m1", 100, 80, { thresholdPercent: 20, channels: [] })).toMatchObject({
      direction: "decrease",
      changePercent: -20,
    });
  });

  it("delivers an anomaly once to every configured channel", async () => {
    const anomaly = await service.evaluateAndAlert("m1", 100, 150, {
      thresholdPercent: 25,
      channels: ["email", "webhook", "email"],
    });
    expect(anomaly).not.toBeNull();
    expect(notifier.send).toHaveBeenCalledTimes(2);
    expect(notifier.send).toHaveBeenCalledWith("email", anomaly);
    expect(notifier.send).toHaveBeenCalledWith("webhook", anomaly);
  });

  it("does not alert when disabled or when no baseline exists", async () => {
    expect(await service.evaluateAndAlert("m1", 0, 100, { thresholdPercent: 1, channels: ["email"] })).toBeNull();
    expect(await service.evaluateAndAlert("m1", 100, 200, { thresholdPercent: 1, channels: ["email"], enabled: false })).toBeNull();
    expect(notifier.send).not.toHaveBeenCalled();
  });
});
