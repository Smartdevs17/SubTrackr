/**
 * Prometheus Metrics Exporter — SubTrackr
 *
 * Issue #1285: Build metrics exporter for Prometheus
 *
 * Aggregates all individual metric exporters (build, queue, replication,
 * connection pool, RPC, anomaly, lock) into a single unified `/metrics`
 * endpoint that satisfies the Prometheus text exposition format
 * (text/plain; version=0.0.4).
 *
 * Architecture:
 *  - Each sub-exporter is registered via `register()` with a stable name.
 *  - `collect()` invokes all registered collectors and concatenates their
 *    Prometheus text blocks, separated by a blank line for readability.
 *  - Collectors are called with a timeout so a slow sub-exporter cannot
 *    stall the entire scrape. Timed-out collectors emit an error counter.
 *  - The exporter tracks its own scrape duration and error counters so
 *    Prometheus-level alerting on collection failures is possible.
 *  - `createUnifiedMetricsHandler()` returns an HTTP request handler
 *    compatible with the existing handler contract used by the other
 *    exporters in this module.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single metrics collector. Returns a Prometheus text block. */
export type MetricsCollector = () => string | Promise<string>;

export interface CollectorRegistration {
  name: string;
  collector: MetricsCollector;
  /** Timeout for this collector in ms. Defaults to `DEFAULT_COLLECTOR_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export interface CollectionResult {
  name: string;
  text: string;
  durationMs: number;
  error?: string;
}

export interface ScrapeResult {
  body: string;
  durationMs: number;
  collectionResults: CollectionResult[];
  errors: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_COLLECTOR_TIMEOUT_MS = 5_000;
const SCRAPE_TIMESTAMP_LABEL = 'subtrackr_metrics_scrape';

// ---------------------------------------------------------------------------
// PrometheusMetricsExporter
// ---------------------------------------------------------------------------

export class PrometheusMetricsExporter {
  private readonly registrations: CollectorRegistration[] = [];
  private scrapeTotal = 0;
  private scrapeErrorTotal = 0;
  private lastScrapeDurationMs = 0;
  private lastScrapeTimestamp = 0;

  /**
   * Register a named collector. Collectors are invoked in registration order.
   * Registering the same name twice is allowed (both will run); use unique
   * names for clarity.
   */
  register(registration: CollectorRegistration): this {
    this.registrations.push(registration);
    return this;
  }

  /**
   * Unregister a collector by name. Removes the first match.
   */
  unregister(name: string): boolean {
    const idx = this.registrations.findIndex((r) => r.name === name);
    if (idx === -1) return false;
    this.registrations.splice(idx, 1);
    return true;
  }

  /** List registered collector names. */
  registeredNames(): string[] {
    return this.registrations.map((r) => r.name);
  }

  /**
   * Run all registered collectors and return a unified Prometheus text body.
   */
  async collect(): Promise<ScrapeResult> {
    const scrapeStart = Date.now();
    this.scrapeTotal++;

    const blocks: string[] = [];
    const collectionResults: CollectionResult[] = [];
    let errors = 0;

    for (const reg of this.registrations) {
      const start = Date.now();
      const timeoutMs = reg.timeoutMs ?? DEFAULT_COLLECTOR_TIMEOUT_MS;

      let text = '';
      let error: string | undefined;

      try {
        text = await Promise.race([
          Promise.resolve(reg.collector()),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`collector timeout after ${timeoutMs}ms`)), timeoutMs),
          ),
        ]);
      } catch (err) {
        errors++;
        this.scrapeErrorTotal++;
        error = err instanceof Error ? err.message : String(err);
        // Emit an error counter metric for this collector so scrape failures
        // are visible in Prometheus without crashing the scrape.
        text = [
          `# HELP subtrackr_collector_error Collector failed during scrape (1=error)`,
          `# TYPE subtrackr_collector_error gauge`,
          `subtrackr_collector_error{collector="${sanitizeLabel(reg.name)}"} 1`,
        ].join('\n');
      }

      const durationMs = Date.now() - start;
      collectionResults.push({ name: reg.name, text, durationMs, error });

      if (text.trim()) {
        blocks.push(text.trim());
      }
    }

    // Append exporter self-metrics at the end of every scrape
    const scrapeDurationMs = Date.now() - scrapeStart;
    this.lastScrapeDurationMs = scrapeDurationMs;
    this.lastScrapeTimestamp = Date.now();

    blocks.push(this.renderSelfMetrics());

    const body = blocks.join('\n\n') + '\n';
    return { body, durationMs: scrapeDurationMs, collectionResults, errors };
  }

  /** Prometheus-formatted self-metrics about the exporter. */
  renderSelfMetrics(): string {
    const lines = [
      '# HELP subtrackr_metrics_scrape_total Total number of Prometheus scrapes',
      '# TYPE subtrackr_metrics_scrape_total counter',
      `${SCRAPE_TIMESTAMP_LABEL}_total ${this.scrapeTotal}`,

      '# HELP subtrackr_metrics_scrape_error_total Scrapes with at least one collector error',
      '# TYPE subtrackr_metrics_scrape_error_total counter',
      `${SCRAPE_TIMESTAMP_LABEL}_error_total ${this.scrapeErrorTotal}`,

      '# HELP subtrackr_metrics_scrape_duration_ms Duration of the last scrape in ms',
      '# TYPE subtrackr_metrics_scrape_duration_ms gauge',
      `${SCRAPE_TIMESTAMP_LABEL}_duration_ms ${this.lastScrapeDurationMs}`,

      '# HELP subtrackr_metrics_collectors_registered Number of registered collectors',
      '# TYPE subtrackr_metrics_collectors_registered gauge',
      `subtrackr_metrics_collectors_registered ${this.registrations.length}`,

      '# HELP subtrackr_metrics_last_scrape_timestamp_ms Unix timestamp of the last scrape in ms',
      '# TYPE subtrackr_metrics_last_scrape_timestamp_ms gauge',
      `subtrackr_metrics_last_scrape_timestamp_ms ${this.lastScrapeTimestamp}`,
    ];
    return lines.join('\n');
  }

  /** Cumulative error counter across all scrapes. */
  getScrapeErrorTotal(): number {
    return this.scrapeErrorTotal;
  }

  /** Total number of scrapes completed. */
  getScrapeTotal(): number {
    return this.scrapeTotal;
  }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

export interface MetricsHttpResponse {
  setHeader(name: string, value: string): void;
  statusCode?: number;
  end(body: string): void;
}

/**
 * Build an Express-compatible (or raw Node.js HTTP) `/metrics` handler backed
 * by the given `PrometheusMetricsExporter`.
 *
 * On success:   200 text/plain; version=0.0.4
 * On failure:   500 with error message
 */
export function createUnifiedMetricsHandler(exporter: PrometheusMetricsExporter) {
  return async function handleUnifiedMetrics(
    _req: unknown,
    res: MetricsHttpResponse,
  ): Promise<void> {
    try {
      const result = await exporter.collect();
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.setHeader('X-Metrics-Scrape-Duration-Ms', String(result.durationMs));
      if (result.errors > 0) {
        res.setHeader('X-Metrics-Collector-Errors', String(result.errors));
      }
      res.end(result.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'metrics collection failed';
      if (res.statusCode !== undefined) {
        res.statusCode = 500;
      }
      res.end(`# ERROR: ${message}\n`);
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape a Prometheus label value. */
function sanitizeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// ---------------------------------------------------------------------------
// Default singleton exporter
// ---------------------------------------------------------------------------

/**
 * The default shared `PrometheusMetricsExporter` instance. Individual exporter
 * modules may import this and register themselves during service initialisation.
 *
 * @example
 * import { defaultExporter } from '../monitoring/prometheusMetricsExporter';
 * defaultExporter.register({ name: 'queue', collector: () => formatQueuePrometheus(snapshot) });
 */
export const defaultExporter = new PrometheusMetricsExporter();
