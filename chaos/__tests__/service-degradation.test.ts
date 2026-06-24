import {
  callWithCircuitBreaker,
  resetBreaker,
  runServiceDegradationExperiment,
} from '../experiments/service-degradation';

describe('Service Degradation Experiment', () => {
  beforeEach(() => resetBreaker());

  it('passes through when service is healthy', async () => {
    await expect(callWithCircuitBreaker(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('opens circuit after repeated failures', async () => {
    const failing = () => Promise.reject(new Error('down'));
    // Exhaust threshold
    for (let i = 0; i < 3; i++) {
      await callWithCircuitBreaker(failing).catch(() => {});
    }
    await expect(callWithCircuitBreaker(failing)).rejects.toThrow('Circuit open');
  });

  it('runServiceDegradationExperiment passes', async () => {
    const result = await runServiceDegradationExperiment();
    expect(result.experiment).toBe('service-degradation');
    expect(result.passed).toBe(true);
    expect(result.recovery).toBe('circuit-breaker-opened');
  });
});
