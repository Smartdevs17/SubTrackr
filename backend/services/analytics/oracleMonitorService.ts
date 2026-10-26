interface OracleFeedHealth {
  feedId: string;
  token: string;
  quote: string;
  lastPrice: number;
  lastTimestamp: number;
  stalenessSecs: number;
  maxStalenessSecs: number;
  circuitTripped: boolean;
  consecutiveFaults: number;
  healthy: boolean;
}

interface OracleAlert {
  type: 'stale_price' | 'circuit_open' | 'deviation' | 'no_price';
  feedId: string;
  token: string;
  quote: string;
  timestamp: number;
  message: string;
}

export class OracleMonitorService {
  private feedHealth = new Map<string, OracleFeedHealth>();
  private alerts: OracleAlert[] = [];
  private checkIntervalMs: number;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly maxAlerts = 1000;

  constructor(checkIntervalMs = 60_000) {
    this.checkIntervalMs = checkIntervalMs;
  }

  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => this.runHealthCheck(), this.checkIntervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  registerFeed(
    feedId: string,
    token: string,
    quote: string,
    maxStalenessSecs: number,
  ): void {
    this.feedHealth.set(feedId, {
      feedId,
      token,
      quote,
      lastPrice: 0,
      lastTimestamp: 0,
      stalenessSecs: 0,
      maxStalenessSecs,
      circuitTripped: false,
      consecutiveFaults: 0,
      healthy: true,
    });
  }

  unregisterFeed(feedId: string): void {
    this.feedHealth.delete(feedId);
  }

  reportPrice(feedId: string, price: number, timestamp: number): void {
    const feed = this.feedHealth.get(feedId);
    if (!feed) return;

    const now = Date.now() / 1000;
    feed.lastPrice = price;
    feed.lastTimestamp = timestamp;
    feed.stalenessSecs = Math.max(0, now - timestamp);
    feed.healthy = feed.stalenessSecs <= feed.maxStalenessSecs && !feed.circuitTripped;
  }

  reportCircuitBreaker(feedId: string, tripped: boolean, faults: number): void {
    const feed = this.feedHealth.get(feedId);
    if (!feed) return;

    if (tripped && !feed.circuitTripped) {
      this.addAlert({
        type: 'circuit_open',
        feedId,
        token: feed.token,
        quote: feed.quote,
        timestamp: Date.now(),
        message: `Circuit breaker tripped for ${feed.token}/${feed.quote} after ${faults} consecutive faults`,
      });
    }

    feed.circuitTripped = tripped;
    feed.consecutiveFaults = faults;
    feed.healthy = feed.stalenessSecs <= feed.maxStalenessSecs && !feed.circuitTripped;
  }

  getHealth(): OracleFeedHealth[] {
    return Array.from(this.feedHealth.values());
  }

  getAlerts(): OracleAlert[] {
    return this.alerts;
  }

  getUnhealthyFeeds(): OracleFeedHealth[] {
    return Array.from(this.feedHealth.values()).filter((f) => !f.healthy);
  }

  private addAlert(alert: OracleAlert): void {
    this.alerts.push(alert);
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(-this.maxAlerts);
    }
  }

  private runHealthCheck(): void {
    const now = Date.now() / 1000;
    for (const feed of this.feedHealth.values()) {
      feed.stalenessSecs = Math.max(0, now - feed.lastTimestamp);

      if (feed.lastPrice === 0 && feed.lastTimestamp === 0) {
        this.addAlert({
          type: 'no_price',
          feedId: feed.feedId,
          token: feed.token,
          quote: feed.quote,
          timestamp: Date.now(),
          message: `No price reported yet for ${feed.token}/${feed.quote}`,
        });
      }

      if (feed.stalenessSecs > feed.maxStalenessSecs) {
        this.addAlert({
          type: 'stale_price',
          feedId: feed.feedId,
          token: feed.token,
          quote: feed.quote,
          timestamp: Date.now(),
          message: `Stale price for ${feed.token}/${feed.quote}: ${feed.stalenessSecs}s old (max ${feed.maxStalenessSecs}s)`,
        });
      }

      feed.healthy = feed.stalenessSecs <= feed.maxStalenessSecs && !feed.circuitTripped;
    }
  }
}

export const oracleMonitorService = new OracleMonitorService();
