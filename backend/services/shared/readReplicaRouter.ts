/**
 * Database Read Replica Router with Failover — SubTrackr
 *
 * Manages connections to primary and read replica databases
 * with automatic failover and health checking.
 */

export interface ReplicaConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  maxConnections: number;
  connectionTimeoutMs: number;
  healthCheckIntervalMs: number;
  maxReplicationLagMs: number;
  weight: number;
}

export interface ReplicaHealth {
  host: string;
  healthy: boolean;
  latencyMs: number;
  replicationLagMs: number;
  activeConnections: number;
  lastCheckedAt: number;
  consecutiveFailures: number;
}

export interface ReadRouteOptions {
  preferHealthy: boolean;
  maxLagMs: number;
  excludeHosts: string[];
  forcePrimary: boolean;
}

export interface QueryRoute {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  isPrimary: boolean;
}

export class ReadReplicaRouter {
  private primary: ReplicaConfig;
  private replicas: ReplicaConfig[] = [];
  private healthMap = new Map<string, ReplicaHealth>();
  private connectionCounts = new Map<string, number>();

  constructor(primary: ReplicaConfig, replicas: ReplicaConfig[] = []) {
    this.primary = primary;
    this.replicas = replicas;

    for (const replica of replicas) {
      this.healthMap.set(replica.host, {
        host: replica.host,
        healthy: true,
        latencyMs: 0,
        replicationLagMs: 0,
        activeConnections: 0,
        lastCheckedAt: 0,
        consecutiveFailures: 0,
      });
      this.connectionCounts.set(replica.host, 0);
    }
  }

  routeRead(options: ReadRouteOptions = { preferHealthy: true, maxLagMs: 5000, excludeHosts: [], forcePrimary: false }): QueryRoute {
    if (options.forcePrimary) {
      return this.toQueryRoute(this.primary, true);
    }

    const healthyReplicas = this.replicas.filter((r) => {
      if (options.excludeHosts.includes(r.host)) return false;
      if (!options.preferHealthy) return true;
      const health = this.healthMap.get(r.host);
      return health?.healthy ?? false;
    });

    const lagFiltered = healthyReplicas.filter((r) => {
      const health = this.healthMap.get(r.host);
      if (!health) return true;
      return health.replicationLagMs <= options.maxLagMs;
    });

    const candidates = lagFiltered.length > 0 ? lagFiltered : healthyReplicas;

    if (candidates.length === 0) {
      return this.toQueryRoute(this.primary, true);
    }

    const totalWeight = candidates.reduce((sum, r) => sum + r.weight, 0);
    let random = Math.random() * totalWeight;

    for (const replica of candidates) {
      random -= replica.weight;
      if (random <= 0) {
        return this.toQueryRoute(replica, false);
      }
    }

    return this.toQueryRoute(candidates[0], false);
  }

  private toQueryRoute(config: ReplicaConfig, isPrimary: boolean): QueryRoute {
    return {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      isPrimary,
    };
  }

  reportSuccess(host: string): void {
    const health = this.healthMap.get(host);
    if (health) {
      health.consecutiveFailures = 0;
      health.healthy = true;
      health.lastCheckedAt = Date.now();
    }
  }

  reportFailure(host: string): void {
    const health = this.healthMap.get(host);
    if (health) {
      health.consecutiveFailures += 1;
      health.lastCheckedAt = Date.now();
      if (health.consecutiveFailures >= 3) {
        health.healthy = false;
      }
    }
  }

  updateReplicationLag(host: string, lagMs: number): void {
    const health = this.healthMap.get(host);
    if (health) {
      health.replicationLagMs = lagMs;
      health.lastCheckedAt = Date.now();
    }
  }

  updateLatency(host: string, latencyMs: number): void {
    const health = this.healthMap.get(host);
    if (health) {
      health.latencyMs = latencyMs;
    }
  }

  incrementConnections(host: string): void {
    const count = this.connectionCounts.get(host) ?? 0;
    this.connectionCounts.set(host, count + 1);
    const health = this.healthMap.get(host);
    if (health) health.activeConnections = count + 1;
  }

  decrementConnections(host: string): void {
    const count = this.connectionCounts.get(host) ?? 0;
    this.connectionCounts.set(host, Math.max(0, count - 1));
    const health = this.healthMap.get(host);
    if (health) health.activeConnections = Math.max(0, count - 1);
  }

  getHealthReports(): ReplicaHealth[] {
    return Array.from(this.healthMap.values());
  }

  getHealthyReplicaCount(): number {
    return Array.from(this.healthMap.values()).filter((h) => h.healthy).length;
  }

  addReplica(config: ReplicaConfig): void {
    this.replicas.push(config);
    this.healthMap.set(config.host, {
      host: config.host,
      healthy: true,
      latencyMs: 0,
      replicationLagMs: 0,
      activeConnections: 0,
      lastCheckedAt: Date.now(),
      consecutiveFailures: 0,
    });
    this.connectionCounts.set(config.host, 0);
  }

  removeReplica(host: string): boolean {
    const index = this.replicas.findIndex((r) => r.host === host);
    if (index === -1) return false;
    this.replicas.splice(index, 1);
    this.healthMap.delete(host);
    this.connectionCounts.delete(host);
    return true;
  }

  getPrimary(): ReplicaConfig {
    return { ...this.primary };
  }

  getReplicas(): ReplicaConfig[] {
    return [...this.replicas];
  }
}
