/**
 * Chaos Experiment: Service Degradation
 * Simulates slow / degraded downstream services (wallet RPC, notification service).
 */

import type { ChaosResult } from './network-partition';

export interface ServiceHealth {
  healthy: boolean;
  latencyMs: number;
  errorRate: number;
}

/** Circuit-breaker state */
interface CircuitBreaker {
  failures: number;
  open: boolean;
  openedAt: number;
}

const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_MS = 100; // short for tests

const breaker: CircuitBreaker = { failures: 0, open: false, openedAt: 0 };

export function resetBreaker(): void {
  breaker.failures = 0;
  breaker.open = false;
  breaker.openedAt = 0;
}

export async function callWithCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  if (breaker.open) {
    if (Date.now() - breaker.openedAt > RESET_TIMEOUT_MS) {
      breaker.open = false; // half-open: allow one probe
    } else {
      throw new Error('Circuit open: service unavailable');
    }
  }
  try {
    const result = await fn();
    breaker.failures = 0;
    return result;
  } catch (err) {
    breaker.failures += 1;
    if (breaker.failures >= FAILURE_THRESHOLD) {
      breaker.open = true;
      breaker.openedAt = Date.now();
    }
    throw err;
  }
}

/** Degraded service: always throws */
async function degradedService(): Promise<string> {
  throw new Error('Service degraded: timeout');
}

export async function runServiceDegradationExperiment(): Promise<ChaosResult> {
  const start = Date.now();
  resetBreaker();

  let circuitOpened = false;
  for (let i = 0; i < FAILURE_THRESHOLD + 1; i++) {
    try {
      await callWithCircuitBreaker(degradedService);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Circuit open')) {
        circuitOpened = true;
        break;
      }
    }
  }

  return {
    experiment: 'service-degradation',
    passed: circuitOpened,
    duration: Date.now() - start,
    recovery: circuitOpened ? 'circuit-breaker-opened' : undefined,
    error: circuitOpened ? undefined : 'Circuit breaker did not open',
  };
}
