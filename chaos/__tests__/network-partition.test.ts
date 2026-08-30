import {
  simulateNetworkPartition,
  runNetworkPartitionExperiment,
  PartitionNode,
} from '../experiments/network-partition';

describe('Network Partition Experiment', () => {
  it('reports unreachable nodes during partition', async () => {
    const nodes: PartitionNode[] = [
      { name: 'a', reachable: true, value: 'ok' },
      { name: 'b', reachable: false, value: 'ok' },
    ];
    const result = await simulateNetworkPartition(nodes);
    expect(result.find((r) => r.name === 'b')?.ok).toBe(false);
    expect(result.find((r) => r.name === 'a')?.ok).toBe(true);
  });

  it('recovers once partition heals', async () => {
    const nodes: PartitionNode[] = [
      { name: 'a', reachable: false, value: 'ok' },
    ];
    const recovered = await simulateNetworkPartition(nodes, true);
    expect(recovered[0].ok).toBe(true);
  });

  it('runNetworkPartitionExperiment passes', async () => {
    const result = await runNetworkPartitionExperiment();
    expect(result.experiment).toBe('network-partition');
    expect(result.passed).toBe(true);
    expect(result.recovery).toBe('partition-healed');
  });
});
