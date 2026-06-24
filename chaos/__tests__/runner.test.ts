import { runAllExperiments, summarize } from '../runner';

describe('Chaos Runner', () => {
  it('runs all experiments and all pass', async () => {
    const results = await runAllExperiments();
    expect(results).toHaveLength(3);
    const failed = results.filter((r) => !r.passed);
    expect(failed).toHaveLength(0);
  });

  it('summarize prints without throwing', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    summarize([
      { experiment: 'test', passed: true, duration: 10, recovery: 'retry' },
      { experiment: 'test2', passed: false, duration: 5, error: 'oops' },
    ]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
