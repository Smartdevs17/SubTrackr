/**
 * Chaos Experiment: Failure Injection
 * Injects failures into subscription billing and wallet operations.
 */

import type { ChaosResult } from './network-partition';

export type FaultType = 'error' | 'latency' | 'none';

export interface FaultConfig {
  type: FaultType;
  probability: number;
  latencyMs?: number;
}

/** Wraps any async function with configurable fault injection */
export function withFaultInjection<T>(
  fn: () => Promise<T>,
  fault: FaultConfig,
  random: () => number = Math.random
): () => Promise<T> {
  return async () => {
    if (random() < fault.probability) {
      if (fault.type === 'error') {
        throw new Error('Injected fault: operation failed');
      }
      if (fault.type === 'latency' && fault.latencyMs) {
        await new Promise((r) => setTimeout(r, fault.latencyMs));
      }
    }
    return fn();
  };
}

/** Simulates a billing charge */
async function billingCharge(subscriptionId: string): Promise<{ txHash: string }> {
  return { txHash: `0xabc_${subscriptionId}` };
}

export async function runFailureInjectionExperiment(): Promise<ChaosResult> {
  const start = Date.now();
  const results: boolean[] = [];
  const deterministicFaultSamples = [0.1, 0.7, 0.8, 0.2, 0.6, 0.9, 0.4, 0.95, 0.05, 0.75];

  // Run 10 billing attempts with 30 % error injection
  for (let i = 0; i < 10; i++) {
    const faultedCharge = withFaultInjection(
      () => billingCharge(`sub_${i}`),
      {
        type: 'error',
        probability: 0.3,
      },
      () => deterministicFaultSamples[i % deterministicFaultSamples.length]
    );
    try {
      await faultedCharge();
      results.push(true);
    } catch {
      results.push(false);
    }
  }

  const successRate = results.filter(Boolean).length / results.length;
  // Expect at least 50 % success (fault rate is 30 %, so ~70 % expected)
  const passed = successRate >= 0.5;

  return {
    experiment: 'failure-injection',
    passed,
    duration: Date.now() - start,
    recovery: `success-rate=${(successRate * 100).toFixed(0)}%`,
    error: passed ? undefined : `Success rate too low: ${(successRate * 100).toFixed(0)}%`,
  };
}
