import {
  isServiceHealthy,
  simulateServiceDegradation,
  runServiceDegradationExperiment,
} from '../experiments/service-degradation';

describe('Service Degradation Experiment', () => {
  it('flags a service healthy below threshold', () => {
    expect(isServiceHealthy({ name: 's', errorRate: 0.02 })).toBe(true);
    expect(isServiceHealthy({ name: 's', errorRate: 0.9 })).toBe(false);
  });

  it('opens circuit and engages fallback when degraded', async () => {
    const state = await simulateServiceDegradation(false);
    expect(state.circuitOpen).toBe(true);
    expect(state.fallback).toBe(true);
  });

  it('closes circuit when healthy', async () => {
    const state = await simulateServiceDegradation(true);
    expect(state.circuitOpen).toBe(false);
  });

  it('runServiceDegradationExperiment passes', async () => {
    const result = await runServiceDegradationExperiment();
    expect(result.experiment).toBe('service-degradation');
    expect(result.passed).toBe(true);
    expect(result.recovery).toBe('circuit-recovered');
  });
});
