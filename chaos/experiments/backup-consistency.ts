import type { ChaosResult } from './network-partition';

export interface ConsistencyCheckResult {
  serviceA: string[];
  serviceB: string[];
  mismatches: { key: string; aValue: string | null; bValue: string | null }[];
  consistent: boolean;
}

export function simulateCrossServiceBackup(
  appData: Record<string, string>,
  contractData: Record<string, string>
): ConsistencyCheckResult {
  const mismatches: { key: string; aValue: string | null; bValue: string | null }[] = [];
  const serviceA = Object.keys(appData);
  const serviceB = Object.keys(contractData);

  const allKeys = new Set([...serviceA, ...serviceB]);
  for (const key of allKeys) {
    const aVal = appData[key] ?? null;
    const bVal = contractData[key] ?? null;

    if (key.startsWith('shared_') && aVal !== bVal) {
      mismatches.push({ key, aValue: aVal, bValue: bVal });
    }
  }

  return {
    serviceA,
    serviceB,
    mismatches,
    consistent: mismatches.length === 0,
  };
}

export function injectBackupInconsistency(
  appData: Record<string, string>,
  contractData: Record<string, string>,
  inconsistencyKey: string,
  appValue: string,
  contractValue: string
): { appData: Record<string, string>; contractData: Record<string, string> } {
  return {
    appData: { ...appData, [inconsistencyKey]: appValue },
    contractData: { ...contractData, [inconsistencyKey]: contractValue },
  };
}

export async function runBackupConsistencyExperiment(): Promise<ChaosResult> {
  const start = Date.now();

  const appData: Record<string, string> = {
    shared_user_count: '150',
    shared_subscription_count: '300',
    app_config: 'enabled',
  };

  const contractData: Record<string, string> = {
    shared_user_count: '150',
    shared_subscription_count: '300',
    contract_state: 'active',
  };

  const cleanCheck = simulateCrossServiceBackup(appData, contractData);
  if (!cleanCheck.consistent) {
    return {
      experiment: 'backup-consistency',
      passed: false,
      duration: Date.now() - start,
      error: 'Clean data reported as inconsistent',
    };
  }

  const corrupted = injectBackupInconsistency(
    appData,
    contractData,
    'shared_user_count',
    '150',
    '200'
  );

  const corruptedCheck = simulateCrossServiceBackup(corrupted.appData, corrupted.contractData);

  const passed = !corruptedCheck.consistent && corruptedCheck.mismatches.length === 1;

  return {
    experiment: 'backup-consistency',
    passed,
    duration: Date.now() - start,
    recovery: passed ? 'inconsistency-detected' : undefined,
    error: passed
      ? undefined
      : `Expected 1 mismatch, got ${corruptedCheck.mismatches.length}, consistent=${corruptedCheck.consistent}`,
  };
}
