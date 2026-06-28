/**
 * Chaos Experiment: Network Partition
 * Simulates network failures and validates graceful degradation.
 */

export interface ChaosResult {
  experiment: string;
  passed: boolean;
  duration: number;
  error?: string;
  recovery?: string;
}

/** Simulates a network call that can be injected with failure */
export async function simulateNetworkCall(
  failureRate: number,
  latencyMs = 0
): Promise<{ data: string }> {
  if (latencyMs > 0) {
    await new Promise((r) => setTimeout(r, latencyMs));
  }
  if (Math.random() < failureRate) {
    throw new Error('Network partition: connection refused');
  }
  return { data: 'ok' };
}

/** Retry with exponential back-off — the standard recovery mechanism */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 10
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

export async function runNetworkPartitionExperiment(): Promise<ChaosResult> {
  const start = Date.now();
  try {
    // Fail the first 3 attempts, succeed on the 4th — deterministic partition scenario
    let attempt = 0;
    await withRetry(
      () => {
        attempt++;
        if (attempt < 4) return simulateNetworkCall(1); // force failure
        return simulateNetworkCall(0); // succeed
      },
      5,
      5
    );
    return {
      experiment: 'network-partition',
      passed: true,
      duration: Date.now() - start,
      recovery: 'exponential-backoff-retry',
    };
  } catch (err) {
    return {
      experiment: 'network-partition',
      passed: false,
      duration: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
