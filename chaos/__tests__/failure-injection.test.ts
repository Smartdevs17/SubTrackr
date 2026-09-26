import {
  injectFailure,
  runFailureInjectionExperiment,
} from '../experiments/failure-injection';

describe('Failure Injection Experiment', () => {
  it('injects failure into marked steps', async () => {
    const result = await injectFailure([
      { name: 'charge', inject: true },
      { name: 'notify', inject: false },
    ]);
    expect(result.ok).toBe(false);
    expect(result.failedSteps).toEqual(['charge']);
  });

  it('succeeds when no steps are marked', async () => {
    const result = await injectFailure([{ name: 'charge', inject: false }]);
    expect(result.ok).toBe(true);
    expect(result.failedSteps).toEqual([]);
  });

  it('runFailureInjectionExperiment passes', async () => {
    const result = await runFailureInjectionExperiment();
    expect(result.experiment).toBe('failure-injection');
    expect(result.passed).toBe(true);
    expect(result.recovery).toBe('failure-contained-and-recovered');
  });
});
