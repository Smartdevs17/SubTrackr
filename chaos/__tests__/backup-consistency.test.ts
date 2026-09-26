import {
  simulateCrossServiceBackup,
  injectBackupInconsistency,
  runBackupConsistencyExperiment,
} from '../experiments/backup-consistency';

describe('Backup Consistency Experiment', () => {
  it('detects consistent cross-service backup', () => {
    const result = simulateCrossServiceBackup(
      { shared_count: '100', app_key: 'val' },
      { shared_count: '100', contract_key: 'val' }
    );
    expect(result.consistent).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('detects inconsistent shared keys', () => {
    const result = simulateCrossServiceBackup(
      { shared_count: '100', app_key: 'val' },
      { shared_count: '200', contract_key: 'val' }
    );
    expect(result.consistent).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].key).toBe('shared_count');
  });

  it('ignores non-shared keys', () => {
    const result = simulateCrossServiceBackup({ app_only: 'a' }, { contract_only: 'b' });
    expect(result.consistent).toBe(true);
  });

  it('injects inconsistency for testing', () => {
    const result = injectBackupInconsistency(
      { shared_x: '1' },
      { shared_x: '1' },
      'shared_x',
      '10',
      '20'
    );
    expect(result.appData.shared_x).toBe('10');
    expect(result.contractData.shared_x).toBe('20');
  });

  it('runBackupConsistencyExperiment passes', async () => {
    const result = await runBackupConsistencyExperiment();
    expect(result.experiment).toBe('backup-consistency');
    expect(result.passed).toBe(true);
    expect(result.recovery).toBe('inconsistency-detected');
  });
});
