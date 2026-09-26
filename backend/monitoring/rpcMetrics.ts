export interface RpcMetricsData {
  endpoint: string;
  latencyMs: number;
  errorCount: number;
  successCount: number;
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  lastFailureTime: number | null;
}

class RpcMetricsRegistry {
  private metrics: Map<string, RpcMetricsData> = new Map();

  private getOrInit(endpoint: string): RpcMetricsData {
    if (!this.metrics.has(endpoint)) {
      this.metrics.set(endpoint, {
        endpoint,
        latencyMs: 0,
        errorCount: 0,
        successCount: 0,
        circuitState: 'CLOSED',
        lastFailureTime: null,
      });
    }
    return this.metrics.get(endpoint)!;
  }

  recordLatency(endpoint: string, latencyMs: number) {
    const data = this.getOrInit(endpoint);
    // Simple Exponential Moving Average
    data.latencyMs = data.latencyMs === 0 ? latencyMs : data.latencyMs * 0.8 + latencyMs * 0.2;
    data.successCount++;
  }

  recordError(endpoint: string) {
    const data = this.getOrInit(endpoint);
    data.errorCount++;
    data.lastFailureTime = Date.now();
  }

  updateCircuitState(endpoint: string, state: 'CLOSED' | 'OPEN' | 'HALF_OPEN') {
    const data = this.getOrInit(endpoint);
    data.circuitState = state;
  }

  getHealthStatus(): RpcMetricsData[] {
    return Array.from(this.metrics.values());
  }
}

export const rpcMetrics = new RpcMetricsRegistry();
