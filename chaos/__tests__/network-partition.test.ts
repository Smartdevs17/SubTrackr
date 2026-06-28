import {
  simulateNetworkCall,
  withRetry,
  runNetworkPartitionExperiment,
} from '../experiments/network-partition';

describe('Network Partition Experiment', () => {
  it('simulateNetworkCall resolves when failure rate is 0', async () => {
    await expect(simulateNetworkCall(0)).resolves.toEqual({ data: 'ok' });
  });

  it('simulateNetworkCall rejects when failure rate is 1', async () => {
    await expect(simulateNetworkCall(1)).rejects.toThrow('Network partition');
  });

  it('withRetry succeeds after transient failures', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'ok';
    };
    await expect(withRetry(fn, 5, 0)).resolves.toBe('ok');
    expect(calls).toBe(3);
  });

  it('withRetry throws after exhausting attempts', async () => {
    await expect(withRetry(() => Promise.reject(new Error('fail')), 3, 0)).rejects.toThrow('fail');
  });

  it('runNetworkPartitionExperiment passes', async () => {
    const result = await runNetworkPartitionExperiment();
    expect(result.experiment).toBe('network-partition');
    expect(result.passed).toBe(true);
    expect(result.recovery).toBe('exponential-backoff-retry');
  });
});
