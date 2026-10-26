/**
 * Read Replica Router — SubTrackr
 *
 * Routes read queries to replicas with automatic failover and health monitoring.
 */

export interface ReplicaConfig {
  healthCheckIntervalMs: number;
  maxReplicaLagMs: number;
  connectionTimeoutMs: number;
  retryAttempts: number;
}

export interface ReplicaHealth {
  id: string;
  url: string;
  healthy: boolean;
  lastChecked: number;
  responseTimeMs: number;
  replicationLagMs: number;
  failoverCount: number;
}

export interface ReadRouteOptions {
  preferLowLag?: boolean;
  requireHealthy?: boolean;
  excludeReplica?: string;
}

export interface QueryRoute {
  replicaId: string;
  url: string;
  estimatedLatencyMs: number;
}

export class ReadReplicaRouter {
  private primary: ReplicaHealth;
  private replicas: Map<string, ReplicaHealth> = new Map();
  private config: ReplicaConfig;
  private healthTimer?: ReturnType<typeof setInterval>;
  private roundRobinIndex = 0;

  constructor(
    primaryUrl: string,
    replicaUrls: string[] = [],
    config: Partial<ReplicaConfig> = {},
  ) {
    this.config = {
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 10000,
      maxReplicaLagMs: config.maxReplicaLagMs ?? 5000,
      connectionTimeoutMs: config.connectionTimeoutMs ?? 3000,
      retryAttempts: config.retryAttempts ?? 2,
    };

    this.primary = {
      id: 'primary',
      url: primaryUrl,
      healthy: true,
      lastChecked: Date.now(),
      responseTimeMs: 0,
      replicationLagMs: 0,
      failoverCount: 0,
    };

    for (const url of replicaUrls) {
      const id = `replica-${this.replicas.size + 1}`;
      this.replicas.set(id, {
        id,
        url,
        healthy: true,
        lastChecked: 0,
        responseTimeMs: 0,
        replicationLagMs: 0,
        failoverCount: 0,
      });
    }
  }

  routeRead(options: ReadRouteOptions = {}): QueryRoute {
    const healthyReplicas = Array.from(this.replicas.values()).filter((r) => {
      if (!r.healthy && options.requireHealthy !== false) return false;
      if (r.id === options.excludeReplica) return false;
      if (r.replicationLagMs > this.config.maxReplicaLagMs) return false;
      return true;
    });

    if (healthyReplicas.length === 0) {
      return {
        replicaId: this.primary.id,
        url: this.primary.url,
        estimatedLatencyMs: this.primary.responseTimeMs,
      };
    }

    if (options.preferLowLag) {
      healthyReplicas.sort((a, b) => a.replicationLagMs - b.replicationLagMs);
      const best = healthyReplicas[0];
      return {
        replicaId: best.id,
        url: best.url,
        estimatedLatencyMs: best.responseTimeMs,
      };
    }

    const replica = healthyReplicas[this.roundRobinIndex % healthyReplicas.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % healthyReplicas.length;

    return {
      replicaId: replica.id,
      url: replica.url,
      estimatedLatencyMs: replica.responseTimeMs,
    };
  }

  addReplica(url: string): ReplicaHealth {
    const id = `replica-${this.replicas.size + 1}`;
    const replica: ReplicaHealth = {
      id,
      url,
      healthy: true,
      lastChecked: Date.now(),
      responseTimeMs: 0,
      replicationLagMs: 0,
      failoverCount: 0,
    };
    this.replicas.set(id, replica);
    return replica;
  }

  removeReplica(id: string): boolean {
    return this.replicas.delete(id);
  }

  reportHealth(id: string, data: Partial<ReplicaHealth>): void {
    if (id === 'primary') {
      Object.assign(this.primary, data, { lastChecked: Date.now() });
    } else {
      const replica = this.replicas.get(id);
      if (replica) {
        Object.assign(replica, data, { lastChecked: Date.now() });
      }
    }
  }

  markUnhealthy(id: string): void {
    if (id === 'primary') {
      this.primary.healthy = false;
    } else {
      const replica = this.replicas.get(id);
      if (replica) {
        replica.healthy = false;
        replica.failoverCount++;
      }
    }
  }

  startHealthChecks(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      this.checkAllHealth();
    }, this.config.healthCheckIntervalMs);
  }

  stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
  }

  private checkAllHealth(): void {
    const now = Date.now();
    for (const replica of this.replicas.values()) {
      if (now - replica.lastChecked > this.config.healthCheckIntervalMs * 3) {
        replica.healthy = false;
      }
    }
  }

  getHealth(): ReplicaHealth[] {
    return [this.primary, ...Array.from(this.replicas.values())];
  }

  getHealthyCount(): number {
    let count = 0;
    if (this.primary.healthy) count++;
    for (const replica of this.replicas.values()) {
      if (replica.healthy) count++;
    }
    return count;
  }

  stop(): void {
    this.stopHealthChecks();
  }
}
