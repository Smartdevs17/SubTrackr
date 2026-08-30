import { runNetworkPartitionExperiment } from './experiments/network-partition';
import { runServiceDegradationExperiment } from './experiments/service-degradation';
import { runFailureInjectionExperiment } from './experiments/failure-injection';
import { runGeoPartitionExperiment } from './experiments/geo-partition';
import { runBackupConsistencyExperiment } from './experiments/backup-consistency';
import type { ChaosResult } from './experiments/network-partition';

export async function runAllExperiments(): Promise<ChaosResult[]> {
  const results = await Promise.all([
    runNetworkPartitionExperiment(),
    runServiceDegradationExperiment(),
    runFailureInjectionExperiment(),
    runGeoPartitionExperiment(),
    runBackupConsistencyExperiment(),
  ]);
  return results;
}

export function summarize(results: ChaosResult[]): void {
  const passed = results.filter((r) => r.passed).length;
  console.log(`\nChaos Engineering Results: ${passed}/${results.length} passed\n`);
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    console.log(`${status}  ${r.experiment} (${r.duration}ms)`);
    if (r.recovery) console.log(`     recovery: ${r.recovery}`);
    if (r.error) console.log(`     error: ${r.error}`);
  }
}
