/**
 * Connection-pool Prometheus metrics and leak detection.
 *
 * Issue #600: surface multiplexed-pool health (active/idle/waiting, checked-out
 * clients, and leaked-connection counts) so abandoned connections are visible
 * and alertable. Mirrors the lightweight scrape style of viewFreshnessMetric.
 */

import type {
  ServerlessConnectionPool,
  CheckoutRecord,
} from '../shared/db/serverlessPool';

/** Running totals that persist across scrapes for counter-type metrics. */
interface LeakCounters {
  leakedTotal: number;
}

/**
 * Render the pool stats as Prometheus exposition text. Counters
 * (`*_total`) accumulate; gauges reflect the instantaneous pool state.
 */
export function renderPoolMetrics(pool: ServerlessConnectionPool): string {
  const s = pool.stats();
  const lines = [
    '# HELP subtrackr_db_pool_connections Pooled connections to the DB proxy by state.',
    '# TYPE subtrackr_db_pool_connections gauge',
    `subtrackr_db_pool_connections{state="total"} ${s.total}`,
    `subtrackr_db_pool_connections{state="idle"} ${s.idle}`,
    `subtrackr_db_pool_connections{state="waiting"} ${s.waiting}`,
    `subtrackr_db_pool_connections{state="checked_out"} ${s.checkedOut}`,
    '# HELP subtrackr_db_pool_leaked_total Connections force-closed after exceeding the leak threshold.',
    '# TYPE subtrackr_db_pool_leaked_total counter',
    `subtrackr_db_pool_leaked_total ${s.leakedTotal}`,
  ];
  return lines.join('\n') + '\n';
}

/**
 * Build an HTTP `/metrics` handler for the serverless pool. Generic request /
 * response shape so it mounts in any Node.js HTTP server.
 */
export function createPoolMetricsHandler(pool: ServerlessConnectionPool) {
  return function handleMetrics(
    _req: unknown,
    res: { setHeader(name: string, value: string): void; end(body: string): void },
  ): void {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(renderPoolMetrics(pool));
  };
}

/**
 * Attach structured leak logging/alerting to a pool. Each force-closed
 * abandoned connection is logged with its age and origin, and an optional
 * `onLeak` sink (e.g. CloudWatch metric, PagerDuty) is invoked.
 */
export function installLeakDetection(
  pool: ServerlessConnectionPool,
  onLeak?: (info: { origin: string; ageMs: number }) => void,
): LeakCounters {
  const counters: LeakCounters = { leakedTotal: 0 };
  pool.setLeakHandler((record: CheckoutRecord, ageMs: number) => {
    counters.leakedTotal += 1;
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'db_connection_leak',
        origin: record.origin,
        ageMs,
        message: 'Abandoned database connection force-closed',
      }),
    );
    onLeak?.({ origin: record.origin, ageMs });
  });
  return counters;
}
