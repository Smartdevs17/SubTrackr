import {
  withFaultInjection,
  runFailureInjectionExperiment,
} from '../experiments/failure-injection';

describe('Failure Injection Experiment', () => {
  it('withFaultInjection never throws when probability is 0', async () => {
    const fn = withFaultInjection(() => Promise.resolve('ok'), { type: 'error', probability: 0 });
    await expect(fn()).resolves.toBe('ok');
  });

  it('withFaultInjection always throws when probability is 1', async () => {
    const fn = withFaultInjection(() => Promise.resolve('ok'), { type: 'error', probability: 1 });
    await expect(fn()).rejects.toThrow('Injected fault');
  });

  it('withFaultInjection adds latency when type is latency', async () => {
    const fn = withFaultInjection(() => Promise.resolve('ok'), {
      type: 'latency',
      probability: 1,
      latencyMs: 20,
    });
    const start = Date.now();
    await fn();
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('runFailureInjectionExperiment passes', async () => {
    const result = await runFailureInjectionExperiment();
    expect(result.experiment).toBe('failure-injection');
    expect(result.passed).toBe(true);
  });
});
