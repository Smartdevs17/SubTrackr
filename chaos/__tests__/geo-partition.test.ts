import {
  simulateGeoRequest,
  simulateRegionFailover,
  runGeoPartitionExperiment,
} from '../experiments/geo-partition';

describe('Geo Partition Experiment', () => {
  it('simulateGeoRequest succeeds for available region', async () => {
    const result = await simulateGeoRequest('us-east-1', () => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('simulateGeoRequest fails for unavailable region', async () => {
    await expect(
      simulateGeoRequest('us-east-1', () => Promise.resolve('ok'), {
        primary: { region: 'us-east-1', available: false, latencyMs: 0 },
        replicas: [],
      })
    ).rejects.toThrow('Region unavailable');
  });

  it('simulateRegionFailover fails over to replica', async () => {
    const result = await simulateRegionFailover(() => Promise.resolve({ data: 'ok' }), {
      primary: { region: 'us-east-1', available: false, latencyMs: 0 },
      replicas: [{ region: 'eu-west-1', available: true, latencyMs: 10 }],
    });
    expect(result.failoverRegion).toBe('eu-west-1');
    expect(result.result).toEqual({ data: 'ok' });
  });

  it('simulateRegionFailover throws when all regions down', async () => {
    await expect(
      simulateRegionFailover(() => Promise.resolve('ok'), {
        primary: { region: 'us-east-1', available: false, latencyMs: 0 },
        replicas: [{ region: 'eu-west-1', available: false, latencyMs: 0 }],
      })
    ).rejects.toThrow('All regions unavailable');
  });

  it('runGeoPartitionExperiment passes', async () => {
    const result = await runGeoPartitionExperiment();
    expect(result.experiment).toBe('geo-partition');
    expect(result.passed).toBe(true);
    expect(result.recovery).toBe('failover-to-eu-west-1');
  });
});
