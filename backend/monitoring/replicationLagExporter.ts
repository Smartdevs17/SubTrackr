/**
 * Replication Lag Prometheus Exporter
 *
 * Exposes replication lag, replica pool utilisation, and per-replica query
 * latency metrics for Prometheus scraping.
 */

import type { DatabaseConfig } from '../config/database';
import type { ReadWritePool, ReplicaLagState, ReplicaQueryStats } from '../shared/db/readWriteRouter';

export interface ReplicationMetricsSnapshot {
  lagStates: ReplicaLagState[];
  queryStats: ReplicaQueryStats[];
  config: DatabaseConfig;
}

export function collectReplicationMetrics(pool: ReadWritePool): ReplicationMetricsSnapshot {
  return {
    lagStates: pool.getLagStates(),
    queryStats: pool.getQueryStats(),
    config: pool.getConfig(),
  };
}

/**
 * Render Prometheus text format for replication monitoring.
 *
 * Metrics:
 *   subtrackr_replication_lag_ms{replica="..."}
 *   subtrackr_replication_lag_p99_ms{replica="..."}
 *   subtrackr_replication_lag_p99_alarm_ms (constant threshold)
 *   subtrackr_replica_available{replica="..."}
 *   subtrackr_replica_pool_total{replica="..."}
 *   subtrackr_replica_pool_idle{replica="..."}
 *   subtrackr_replica_pool_waiting{replica="..."}
 *   subtrackr_replica_query_latency_ms{replica="..."}
 *   subtrackr_replica_query_total{replica="..."}
 *   subtrackr_replica_query_errors_total{replica="..."}
 */
export function formatReplicationPrometheus(snapshot: ReplicationMetricsSnapshot, pool: ReadWritePool): string {
  const lines: string[] = [];
  const { config, lagStates, queryStats } = snapshot;
  const replicaPools = pool.getReplicaPools();

  lines.push('# HELP subtrackr_replication_lag_ms Replication lag in milliseconds per replica');
  lines.push('# TYPE subtrackr_replication_lag_ms gauge');
  for (const state of lagStates) {
    const lag = Number.isFinite(state.lagMs) ? Math.round(state.lagMs) : -1;
    lines.push(`subtrackr_replication_lag_ms{replica="${state.name}"} ${lag}`);
  }

  lines.push('# HELP subtrackr_replication_lag_p99_ms Rolling P99 replication lag in milliseconds');
  lines.push('# TYPE subtrackr_replication_lag_p99_ms gauge');
  for (const state of lagStates) {
    const p99 = Number.isFinite(state.lagP99Ms) ? Math.round(state.lagP99Ms) : -1;
    lines.push(`subtrackr_replication_lag_p99_ms{replica="${state.name}"} ${p99}`);
  }

  lines.push('# HELP subtrackr_replication_lag_p99_alarm_ms P99 replication lag alarm threshold');
  lines.push('# TYPE subtrackr_replication_lag_p99_alarm_ms gauge');
  lines.push(`subtrackr_replication_lag_p99_alarm_ms ${config.replicationLagP99AlarmMs}`);

  lines.push('# HELP subtrackr_replication_lag_failover_ms Lag threshold for primary failback');
  lines.push('# TYPE subtrackr_replication_lag_failover_ms gauge');
  lines.push(`subtrackr_replication_lag_failover_ms ${config.replicationLagFailoverMs}`);

  lines.push('# HELP subtrackr_replica_available Whether the replica is reachable (1=yes, 0=no)');
  lines.push('# TYPE subtrackr_replica_available gauge');
  for (const state of lagStates) {
    lines.push(`subtrackr_replica_available{replica="${state.name}"} ${state.available ? 1 : 0}`);
  }

  lines.push('# HELP subtrackr_replica_pool_total Total connections in the replica pool');
  lines.push('# TYPE subtrackr_replica_pool_total gauge');
  lines.push('# HELP subtrackr_replica_pool_idle Idle connections in the replica pool');
  lines.push('# TYPE subtrackr_replica_pool_idle gauge');
  lines.push('# HELP subtrackr_replica_pool_waiting Clients waiting for a replica connection');
  lines.push('# TYPE subtrackr_replica_pool_waiting gauge');

  for (const [name, replicaPool] of replicaPools) {
    lines.push(`subtrackr_replica_pool_total{replica="${name}"} ${replicaPool.totalCount}`);
    lines.push(`subtrackr_replica_pool_idle{replica="${name}"} ${replicaPool.idleCount}`);
    lines.push(`subtrackr_replica_pool_waiting{replica="${name}"} ${replicaPool.waitingCount}`);
  }

  lines.push('# HELP subtrackr_replica_query_latency_ms Last query latency on replica in ms');
  lines.push('# TYPE subtrackr_replica_query_latency_ms gauge');
  lines.push('# HELP subtrackr_replica_query_total Total queries routed to replica');
  lines.push('# TYPE subtrackr_replica_query_total counter');
  lines.push('# HELP subtrackr_replica_query_errors_total Total failed replica queries');
  lines.push('# TYPE subtrackr_replica_query_errors_total counter');

  for (const stats of queryStats) {
    lines.push(
      `subtrackr_replica_query_latency_ms{replica="${stats.name}"} ${Math.round(stats.lastLatencyMs)}`,
    );
    lines.push(`subtrackr_replica_query_total{replica="${stats.name}"} ${stats.queryCount}`);
    lines.push(`subtrackr_replica_query_errors_total{replica="${stats.name}"} ${stats.errors}`);
  }

  return lines.join('\n');
}

export function createReplicationMetricsHandler(pool: ReadWritePool) {
  return function handleReplicationMetrics(
    _req: unknown,
    res: { setHeader(name: string, value: string): void; end(body: string): void },
  ): void {
    const snapshot = collectReplicationMetrics(pool);
    const body = formatReplicationPrometheus(snapshot, pool);
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(body);
  };
}
