export type RevenueAlertChannel = "in_app" | "email" | "push" | "sms" | "webhook";

export interface RevenueAnomalyConfig {
  /** Minimum absolute percentage change that triggers an alert. */
  thresholdPercent: number;
  channels: RevenueAlertChannel[];
  enabled?: boolean;
}

export interface RevenueAnomaly {
  merchantId: string;
  previousRevenue: number;
  currentRevenue: number;
  changePercent: number;
  direction: "increase" | "decrease";
  detectedAt: string;
}

export interface RevenueAnomalyNotifier {
  send(channel: RevenueAlertChannel, anomaly: RevenueAnomaly): Promise<void>;
}

export class RevenueAnomalyService {
  constructor(private readonly notifier: RevenueAnomalyNotifier) {}

  detect(
    merchantId: string,
    previousRevenue: number,
    currentRevenue: number,
    config: RevenueAnomalyConfig,
  ): RevenueAnomaly | null {
    if (!Number.isFinite(config.thresholdPercent) || config.thresholdPercent < 0) {
      throw new RangeError("Revenue anomaly threshold must be a non-negative number");
    }
    if (config.enabled === false || previousRevenue === 0) return null;

    const changePercent = ((currentRevenue - previousRevenue) / Math.abs(previousRevenue)) * 100;
    if (Math.abs(changePercent) < config.thresholdPercent) return null;

    return {
      merchantId,
      previousRevenue,
      currentRevenue,
      changePercent: Math.round(changePercent * 100) / 100,
      direction: changePercent >= 0 ? "increase" : "decrease",
      detectedAt: new Date().toISOString(),
    };
  }

  async evaluateAndAlert(
    merchantId: string,
    previousRevenue: number,
    currentRevenue: number,
    config: RevenueAnomalyConfig,
  ): Promise<RevenueAnomaly | null> {
    const anomaly = this.detect(merchantId, previousRevenue, currentRevenue, config);
    if (!anomaly) return null;

    await Promise.all([...new Set(config.channels)].map((channel) => this.notifier.send(channel, anomaly)));
    return anomaly;
  }
}
