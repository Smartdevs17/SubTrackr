import type { ChaosResult } from './network-partition';

export interface GeoRegionState {
  region: string;
  available: boolean;
  latencyMs: number;
}

export interface GeoPartitionScenario {
  primary: GeoRegionState;
  replicas: GeoRegionState[];
}

const DEFAULT_SCENARIO: GeoPartitionScenario = {
  primary: { region: 'us-east-1', available: true, latencyMs: 5 },
  replicas: [
    { region: 'eu-west-1', available: true, latencyMs: 80 },
    { region: 'ap-southeast-1', available: true, latencyMs: 150 },
  ],
};

export async function simulateGeoRequest<T>(
  region: string,
  fn: () => Promise<T>,
  scenario: GeoPartitionScenario = DEFAULT_SCENARIO
): Promise<T> {
  const allRegions = [scenario.primary, ...scenario.replicas];
  const regionState = allRegions.find((r) => r.region === region);

  if (!regionState) throw new Error(`Unknown region: ${region}`);
  if (!regionState.available) throw new Error(`Region unavailable: ${region}`);

  if (regionState.latencyMs > 0) {
    await new Promise((r) => setTimeout(r, regionState.latencyMs));
  }

  return fn();
}

export async function simulateRegionFailover<T>(
  fn: () => Promise<T>,
  scenario: GeoPartitionScenario
): Promise<{ result: T | null; failoverRegion: string; failoverDurationMs: number }> {
  const start = Date.now();

  if (!scenario.primary.available) {
    for (const replica of scenario.replicas) {
      if (!replica.available) continue;
      const replicaStart = Date.now();
      try {
        const result = await simulateGeoRequest(replica.region, fn, scenario);
        return {
          result,
          failoverRegion: replica.region,
          failoverDurationMs: Date.now() - replicaStart,
        };
      } catch {
        continue;
      }
    }
    throw new Error('All regions unavailable');
  }

  const result = await fn();
  return {
    result,
    failoverRegion: scenario.primary.region,
    failoverDurationMs: Date.now() - start,
  };
}

export async function runGeoPartitionExperiment(): Promise<ChaosResult> {
  const start = Date.now();

  const scenario: GeoPartitionScenario = {
    primary: { region: 'us-east-1', available: false, latencyMs: 0 },
    replicas: [
      { region: 'eu-west-1', available: true, latencyMs: 80 },
      { region: 'ap-southeast-1', available: false, latencyMs: 0 },
    ],
  };

  try {
    const { failoverRegion, failoverDurationMs } = await simulateRegionFailover(
      async () => ({ data: 'recovered' }),
      scenario
    );

    const passed = failoverRegion === 'eu-west-1' && failoverDurationMs < 500;

    return {
      experiment: 'geo-partition',
      passed,
      duration: Date.now() - start,
      recovery: `failover-to-${failoverRegion}`,
      error: passed ? undefined : `Failover took ${failoverDurationMs}ms or went to wrong region`,
    };
  } catch (err) {
    return {
      experiment: 'geo-partition',
      passed: false,
      duration: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
