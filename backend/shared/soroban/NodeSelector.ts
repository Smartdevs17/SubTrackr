/**
 * NodeSelector — weighted random RPC node selection with fallback chains.
 * Issue #612
 */

import type { SorobanNodeConfig } from '../../config/sorobanNodeRegistry';
import { nodeReputationService, type NodeReputationService } from './NodeReputationService';
import type { NodeSelectionResult, NodeReputationScore } from './types';

export interface RandomSource {
  /** Returns a float in [0, 1) */
  next(): number;
}

const defaultRandom: RandomSource = {
  next: () => Math.random(),
};

export class NodeSelector {
  constructor(
    private readonly reputation: NodeReputationService,
    private readonly random: RandomSource = defaultRandom,
  ) {}

  /**
   * Select a node using weighted random selection.
   * Higher reputation score = higher probability of selection.
   */
  selectWeightedRandom(candidates: SorobanNodeConfig[]): SorobanNodeConfig | null {
    const alive = this.filterAlive(candidates);
    if (alive.length === 0) return null;

    const scores = alive.map((node) => ({
      node,
      score: this.reputation.getScore(node.id).score,
    }));

    const totalWeight = scores.reduce((sum, s) => sum + s.score, 0);
    if (totalWeight <= 0) {
      return alive[Math.floor(this.random.next() * alive.length)];
    }

    let roll = this.random.next() * totalWeight;
    for (const entry of scores) {
      roll -= entry.score;
      if (roll <= 0) return entry.node;
    }
    return scores[scores.length - 1].node;
  }

  /**
   * Build a fallback chain: primary (highest score) → secondary → tertiary.
   */
  getFallbackChain(candidates: SorobanNodeConfig[]): NodeSelectionResult | null {
    const alive = this.filterAlive(candidates);
    if (alive.length === 0) return null;

    const ranked = this.rankByScore(alive);
    return {
      primary: ranked[0].nodeId,
      secondary: ranked[1]?.nodeId ?? null,
      tertiary: ranked[2]?.nodeId ?? null,
    };
  }

  /**
   * Select the highest-scored alive node (deterministic primary).
   */
  selectPrimary(candidates: SorobanNodeConfig[]): SorobanNodeConfig | null {
    const alive = this.filterAlive(candidates);
    if (alive.length === 0) return null;
    const ranked = this.rankByScore(alive);
    const top = ranked[0];
    return alive.find((n) => n.id === top.nodeId) ?? null;
  }

  /**
   * Execute a transaction attempt through the fallback chain.
   * Tries primary → secondary → tertiary until one succeeds or all fail.
   */
  async executeWithFallback<T>(
    candidates: SorobanNodeConfig[],
    executor: (node: SorobanNodeConfig) => Promise<T>,
  ): Promise<{ result: T; nodeId: string }> {
    if (this.reputation.isCircuitOpen()) {
      throw new Error('Soroban RPC circuit breaker is open — all nodes dead');
    }

    const chain = this.getFallbackChain(candidates);
    if (!chain) {
      throw new Error('No alive Soroban RPC nodes available');
    }

    const orderedIds = [chain.primary, chain.secondary, chain.tertiary].filter(
      (id): id is string => id !== null,
    );

    let lastError: Error | undefined;
    for (const nodeId of orderedIds) {
      const node = candidates.find((n) => n.id === nodeId);
      if (!node) continue;
      const start = Date.now();
      try {
        const result = await executor(node);
        this.reputation.recordOutcome({
          nodeId,
          success: true,
          responseTimeMs: Date.now() - start,
          timestamp: Date.now(),
        });
        return { result, nodeId };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.reputation.recordOutcome({
          nodeId,
          success: false,
          responseTimeMs: Date.now() - start,
          timestamp: Date.now(),
        });
      }
    }

    throw lastError ?? new Error('All fallback nodes failed');
  }

  private filterAlive(candidates: SorobanNodeConfig[]): SorobanNodeConfig[] {
    return candidates.filter((node) => {
      const metrics = this.reputation.getMetrics(node.id);
      return !metrics?.isDead;
    });
  }

  private rankByScore(candidates: SorobanNodeConfig[]): NodeReputationScore[] {
    return candidates
      .map((node) => this.reputation.getScore(node.id))
      .sort((a, b) => b.score - a.score);
  }
}

export const nodeSelector = new NodeSelector(nodeReputationService);
