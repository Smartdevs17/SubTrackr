/**
 * Anomaly-score metrics exporter (#615).
 *
 * Tracks the latest behavioral anomaly score per API key and exposes both the
 * repo's flat `Record<string, number>` metric shape (see lockMetrics.ts) and a
 * Prometheus text-exposition rendering with a per-key gauge.
 */

export interface AnomalyMetricSample {
  key: string;
  score: number;
  at: number;
}

export class AnomalyMetrics {
  private latest = new Map<string, AnomalyMetricSample>();
  private highConfidenceTotal = 0;
  private readonly highConfidenceThreshold: number;

  constructor(highConfidenceThreshold = 0.95) {
    this.highConfidenceThreshold = highConfidenceThreshold;
  }

  record(key: string, score: number, at: number = Date.now()): void {
    this.latest.set(key, { key, score, at });
    if (score >= this.highConfidenceThreshold) this.highConfidenceTotal += 1;
  }

  scoreFor(key: string): number | undefined {
    return this.latest.get(key)?.score;
  }

  /** Flat metrics for the generic exporter (mirrors lockMetrics.ts shape). */
  getMetrics(): Record<string, number> {
    let max = 0;
    for (const s of this.latest.values()) max = Math.max(max, s.score);
    return {
      anomaly_keys_tracked: this.latest.size,
      anomaly_score_max: max,
      anomaly_high_confidence_total: this.highConfidenceTotal,
    };
  }

  /** Prometheus text exposition with a per-key gauge. */
  toPrometheus(): string {
    const lines = [
      "# HELP rate_limit_anomaly_score Behavioral anomaly score per API key (0-1).",
      "# TYPE rate_limit_anomaly_score gauge",
    ];
    for (const s of this.latest.values()) {
      lines.push(`rate_limit_anomaly_score{key="${escapeLabel(s.key)}"} ${s.score}`);
    }
    lines.push("# HELP rate_limit_anomaly_high_confidence_total High-confidence anomalies seen.");
    lines.push("# TYPE rate_limit_anomaly_high_confidence_total counter");
    lines.push(`rate_limit_anomaly_high_confidence_total ${this.highConfidenceTotal}`);
    return lines.join("\n") + "\n";
  }

  reset(): void {
    this.latest.clear();
    this.highConfidenceTotal = 0;
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export const anomalyMetrics = new AnomalyMetrics();

export const anomalyMetricsExporter = {
  getMetrics: () => anomalyMetrics.getMetrics(),
  resetMetrics: () => anomalyMetrics.reset(),
};
