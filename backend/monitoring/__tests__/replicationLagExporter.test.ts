import type { DatabaseConfig } from '../../config/database';
import type { Pool } from '../shared/db/connectionPool';
import type { ReplicaLagState, ReplicaQueryStats } from '../shared/db/readWriteRouter';
import { formatReplicationPrometheus } from '../replicationLagExporter';

function makePoolStats(total: number, idle: number, waiting: number): Pool {
  return {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
    totalCount: total,
    idleCount: idle,
    waitingCount: waiting,
  } as unknown as Pool;
}

describe('replicationLagExporter', () => {
  it('formats lag, pool, and query latency metrics', () => {
    const config: DatabaseConfig = {
      primary: {
        host: 'primary',
        port: 5432,
        database: 'subtrackr',
        user: 'postgres',
        password: '',
        max: 20,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 30_000,
        statementTimeout: 30_000,
        ssl: false,
      },
      replicas: [{ name: 'replica-1', host: 'r1', port: 6433 }],
      replicaPoolSize: 25,
      replicationLagP99AlarmMs: 1_000,
      replicationLagFailoverMs: 5_000,
      staleReadDefaultSeconds: 30,
      lagPollIntervalMs: 5_000,
    };

    const lagStates: ReplicaLagState[] = [
      { name: 'replica-1', lagMs: 250, lagP99Ms: 400, available: true, lastCheckedAt: Date.now() },
    ];
    const queryStats: ReplicaQueryStats[] = [
      {
        name: 'replica-1',
        queryCount: 42,
        totalLatencyMs: 840,
        lastLatencyMs: 20,
        errors: 1,
      },
    ];

    const replicaPools = new Map([['replica-1', makePoolStats(25, 10, 2)]]);

    const mockPool = {
      getReplicaPools: () => replicaPools,
    };

    const output = formatReplicationPrometheus(
      { lagStates, queryStats, config },
      mockPool as never,
    );

    expect(output).toContain('subtrackr_replication_lag_ms{replica="replica-1"} 250');
    expect(output).toContain('subtrackr_replication_lag_p99_ms{replica="replica-1"} 400');
    expect(output).toContain('subtrackr_replication_lag_failover_ms 5000');
    expect(output).toContain('subtrackr_replica_available{replica="replica-1"} 1');
    expect(output).toContain('subtrackr_replica_pool_idle{replica="replica-1"} 10');
    expect(output).toContain('subtrackr_replica_query_latency_ms{replica="replica-1"} 20');
    expect(output).toContain('subtrackr_replica_query_total{replica="replica-1"} 42');
    expect(output).toContain('subtrackr_replica_query_errors_total{replica="replica-1"} 1');
  });

  it('handles unavailable replica with -1 lag', () => {
    const config = {
      replicationLagP99AlarmMs: 1_000,
      replicationLagFailoverMs: 5_000,
    } as DatabaseConfig;

    const lagStates: ReplicaLagState[] = [
      { name: 'replica-2', lagMs: Infinity, lagP99Ms: 0, available: false, lastCheckedAt: 0 },
    ];

    const output = formatReplicationPrometheus(
      { lagStates, queryStats: [], config },
      { getReplicaPools: () => new Map() } as never,
    );

    expect(output).toContain('subtrackr_replica_available{replica="replica-2"} 0');
  });
});
