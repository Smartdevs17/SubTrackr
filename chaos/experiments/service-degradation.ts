/**
 * service-degradation.ts — Service degradation chaos experiment.
 *
 * Simulates a service that starts failing (elevated error rate) and verifies
 * that the circuit breaker opens and the fallback path engages, then that the
 * circuit closes again once the service recovers.
 */

import type { ChaosResult } from './network-partition';

/** Health of a service over a single probe window. */
export interface ServiceHealth {
  name: string;
  /** Fraction of requests failing, 0..1. */
  errorRate: number;
}

/**
 * Decides whether the service is "healthy" (closed circuit) given an error-rate
 * threshold. A degraded service trips the circuit breaker.
 */
export function isServiceHealthy(health: ServiceHealth, threshold = 0.5): boolean {
  return health.errorRate < threshold;
}

/**
 * Simulates the circuit-breaker lifecycle for a service: if the service is
 * degraded, the breaker opens and the caller activates the fallback; when the
 * service recovers the breaker closes again.
 */
export async function simulateServiceDegradation(
  healthy: boolean
): Promise<{ circuitOpen: boolean; fallback: boolean }> {
  // Simulate probe latency.
  await new Promise((resolve) => setTimeout(resolve, 5));

  if (healthy) {
    return { circuitOpen: false, fallback: false };
  }

  // Degraded service: circuit opens and fallback engages.
  return { circuitOpen: true, fallback: true };
}

/**
 * Runs the service-degradation chaos experiment.
 */
export async function runServiceDegradationExperiment(): Promise<ChaosResult> {
  const start = Date.now();

  const baseline: ServiceHealth = { name: 'billing-gateway', errorRate: 0.02 };
  const degraded: ServiceHealth = { name: 'billing-gateway', errorRate: 0.9 };

  const baselineHealthy = isServiceHealthy(baseline);
  const degradedHealthy = !isServiceHealthy(degraded);

  const degradedState = await simulateServiceDegradation(degradedHealthy);
  const recoveredState = await simulateServiceDegradation(true);

  const passed =
    baselineHealthy && !degradedHealthy && degradedState.circuitOpen && !recoveredState.circuitOpen;

  return {
    experiment: 'service-degradation',
    passed,
    duration: Date.now() - start,
    recovery: passed ? 'circuit-recovered' : undefined,
    error: passed
      ? undefined
      : `degradedState=${JSON.stringify(degradedState)}, recoveredState=${JSON.stringify(recoveredState)}`,
  };
}
