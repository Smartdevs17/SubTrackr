/**
 * network-partition.ts — Network partition chaos experiment.
 *
 * Simulates a network partition between services and verifies that the system
 * degrades gracefully (timeouts / circuit breakers) and recovers when the
 * partition heals.
 *
 * This module is also the canonical home of the shared `ChaosResult` type used
 * across every experiment.
 */

export interface ChaosResult {
  experiment: string;
  passed: boolean;
  duration: number;
  recovery?: string;
  error?: string;
}

/** Simulated service node participating in the partition. */
export interface PartitionNode<T = unknown> {
  name: string;
  /** Whether the node is reachable from the orchestrator. */
  reachable: boolean;
  /** Payload the node would return when reachable. */
  value: T;
}

/**
 * Simulates a network partition by making the nodes listed in `partitioned`
 * unreachable. Returns a result set of `{{ name, ok, value }}` per node.
 */
export async function simulateNetworkPartition<T>(
  nodes: PartitionNode<T>[],
  partitionHealed = false
): Promise<{ name: string; ok: boolean; value: T | null; error?: string }[]> {
  // Simulate a transient packet-loss window before resolving.
  await new Promise((resolve) => setTimeout(resolve, 5));

  return nodes.map((node) => {
    const isPartitioned = !partitionHealed ? !node.reachable : node.reachable;
    if (!isPartitioned) {
      return { name: node.name, ok: false, value: null, error: `${node.name} unreachable` };
    }
    return { name: node.name, ok: true, value: node.value };
  });
}

/**
 * Runs the network-partition chaos experiment: a wire dependency is partitioned
 * and must fail closed (error), then the partition heals and it must recover.
 */
export async function runNetworkPartitionExperiment(): Promise<ChaosResult> {
  const start = Date.now();

  const nodes: PartitionNode<string>[] = [
    { name: 'api-gateway', reachable: true, value: 'ok' },
    { name: 'billing-worker', reachable: false, value: 'ok' },
    { name: 'notification-service', reachable: true, value: 'ok' },
  ];

  const duringPartition = await simulateNetworkPartition(nodes);
  const degraded = duringPartition.filter((r) => !r.ok);
  const degradesGracefully = degraded.length === 1 && degraded[0].name === 'billing-worker';

  const afterHeal = await simulateNetworkPartition(nodes, true);
  const recovered = afterHeal.every((r) => r.ok);

  const passed = degradesGracefully && recovered;

  return {
    experiment: 'network-partition',
    passed,
    duration: Date.now() - start,
    recovery: passed ? 'partition-healed' : undefined,
    error: passed
      ? undefined
      : `degraded=${degradesGracefully}, recovered=${recovered}`,
  };
}
