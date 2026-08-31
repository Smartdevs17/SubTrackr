/**
 * Elasticsearch read/write node router with automatic failover.
 *
 * Writes always target the primary node. Reads round-robin across healthy
 * replicas and fall back to primary when replicas are unavailable.
 */

import type { ElasticsearchConfig, ElasticsearchNode } from './config';
import { loadElasticsearchConfig } from './config';

export type ElasticsearchRouteKind = 'read' | 'write';

export interface ElasticsearchRouteResult {
  node: ElasticsearchNode | null;
  /** in-process | primary | replica:<name> | failover-primary */
  route: string;
  failedOver: boolean;
}

export class ElasticsearchReplicaRouter {
  private readonly config: ElasticsearchConfig;
  private readonly failed = new Set<string>();
  private replicaIndex = 0;

  constructor(config: ElasticsearchConfig = loadElasticsearchConfig()) {
    this.config = config;
  }

  getConfig(): ElasticsearchConfig {
    return this.config;
  }

  getPrimary(): ElasticsearchNode | null {
    return this.config.nodes?.find((n) => n.role === 'primary') ?? null;
  }

  getReplicas(): ElasticsearchNode[] {
    return this.config.nodes?.filter((n) => n.role === 'replica') ?? [];
  }

  getHealthyReplicas(): ElasticsearchNode[] {
    return this.getReplicas().filter((n) => !this.failed.has(n.name));
  }

  markFailed(name: string): void {
    this.failed.add(name);
  }

  markHealthy(name: string): void {
    this.failed.delete(name);
  }

  /**
   * Select a node for the operation. Returns null when no remote nodes are
   * configured (callers should use the in-process index).
   */
  route(kind: ElasticsearchRouteKind): ElasticsearchRouteResult {
    const nodes = this.config.nodes ?? [];
    const readWriteSplitting = this.config.readWriteSplitting ?? true;
    const automaticFailover = this.config.automaticFailover ?? true;

    if (nodes.length === 0) {
      return { node: null, route: 'in-process', failedOver: false };
    }

    if (kind === 'write' || !readWriteSplitting) {
      const primary = this.getPrimary();
      return {
        node: primary,
        route: primary ? 'primary' : 'in-process',
        failedOver: false,
      };
    }

    const healthy = this.getHealthyReplicas();
    if (healthy.length > 0) {
      const selected = healthy[this.replicaIndex % healthy.length]!;
      this.replicaIndex = (this.replicaIndex + 1) % healthy.length;
      return {
        node: selected,
        route: `replica:${selected.name}`,
        failedOver: false,
      };
    }

    if (automaticFailover) {
      const primary = this.getPrimary();
      return {
        node: primary,
        route: primary ? 'failover-primary' : 'in-process',
        failedOver: true,
      };
    }

    return { node: null, route: 'in-process', failedOver: true };
  }

  /** Rotate remote node URLs (connection string rotation for ES). */
  rotateNodes(nodes: ElasticsearchNode[]): ElasticsearchReplicaRouter {
    return new ElasticsearchReplicaRouter({
      ...this.config,
      nodes: [...nodes],
    });
  }
}

export function createElasticsearchReplicaRouter(
  env: NodeJS.ProcessEnv = process.env,
): ElasticsearchReplicaRouter {
  return new ElasticsearchReplicaRouter(loadElasticsearchConfig(env));
}
