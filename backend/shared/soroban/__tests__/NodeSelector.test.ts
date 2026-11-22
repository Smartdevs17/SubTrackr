/**
 * Tests for NodeSelector — Issue #612
 */

import { NodeReputationService } from '../NodeReputationService';
import { NodeSelector } from '../NodeSelector';
import type { SorobanNodeConfig } from '../../../config/sorobanNodeRegistry';

const nodes: SorobanNodeConfig[] = [
  { id: 'node-a', name: 'A', endpoint: 'https://a.example.com', network: 'testnet' },
  { id: 'node-b', name: 'B', endpoint: 'https://b.example.com', network: 'testnet' },
  { id: 'node-c', name: 'C', endpoint: 'https://c.example.com', network: 'testnet' },
];

describe('NodeSelector', () => {
  let reputation: NodeReputationService;
  let selector: NodeSelector;
  let now: number;

  beforeEach(() => {
    now = 2_000_000;
    reputation = new NodeReputationService(undefined, undefined, undefined, () => now);
    for (const node of nodes) {
      reputation.registerNode(node.id);
    }
    selector = new NodeSelector(reputation, { next: () => 0.1 });
  });

  afterEach(() => {
    reputation.destroy();
  });

  function boostNode(nodeId: string, count: number, latencyMs: number): void {
    for (let i = 0; i < count; i++) {
      reputation.recordOutcome({
        nodeId,
        success: true,
        responseTimeMs: latencyMs,
        blockHeight: 1000 + i,
        timestamp: now + i,
      });
    }
  }

  it('returns fallback chain ordered by score: primary → secondary → tertiary', () => {
    boostNode('node-a', 20, 50);
    boostNode('node-b', 10, 100);
    boostNode('node-c', 5, 200);

    const chain = selector.getFallbackChain(nodes)!;
    expect(chain.primary).toBe('node-a');
    expect(chain.secondary).toBe('node-b');
    expect(chain.tertiary).toBe('node-c');
  });

  it('selects primary as highest-scored node', () => {
    boostNode('node-b', 20, 50);
    boostNode('node-a', 5, 200);
    const primary = selector.selectPrimary(nodes);
    expect(primary!.id).toBe('node-b');
  });

  it('performs weighted random selection favoring higher scores', () => {
    boostNode('node-a', 30, 30);
    boostNode('node-b', 3, 300);
    // With random=0.1, should pick node-a (highest weight)
    const selected = selector.selectWeightedRandom(nodes);
    expect(selected!.id).toBe('node-a');
  });

  it('excludes dead nodes from selection', () => {
    for (let i = 0; i < 5; i++) {
      reputation.recordOutcome({
        nodeId: 'node-a',
        success: false,
        responseTimeMs: 100,
        timestamp: now + i,
      });
    }
    const chain = selector.getFallbackChain(nodes)!;
    expect(chain.primary).not.toBe('node-a');
  });

  it('executes through fallback chain until success', async () => {
    boostNode('node-c', 10, 50);
    const attempts: string[] = [];

    const result = await selector.executeWithFallback(nodes, async (node) => {
      attempts.push(node.id);
      if (node.id !== 'node-c') throw new Error('fail');
      return 'ok';
    });

    expect(result.result).toBe('ok');
    expect(result.nodeId).toBe('node-c');
    expect(attempts.length).toBeGreaterThanOrEqual(1);
  });

  it('throws when circuit breaker is open', async () => {
    for (const node of nodes) {
      for (let i = 0; i < 5; i++) {
        reputation.recordOutcome({
          nodeId: node.id,
          success: false,
          responseTimeMs: 100,
          timestamp: now + i,
        });
      }
    }
    await expect(
      selector.executeWithFallback(nodes, async () => 'x'),
    ).rejects.toThrow(/circuit breaker/i);
  });

  it('returns null when no alive nodes', () => {
    for (const node of nodes) {
      for (let i = 0; i < 5; i++) {
        reputation.recordOutcome({
          nodeId: node.id,
          success: false,
          responseTimeMs: 100,
          timestamp: now + i,
        });
      }
    }
    expect(selector.selectWeightedRandom(nodes)).toBeNull();
    expect(selector.getFallbackChain(nodes)).toBeNull();
  });
});
