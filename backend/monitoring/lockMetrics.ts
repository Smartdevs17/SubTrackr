import { advisoryLockService } from '../services/shared/locking';

export function collectLockMetrics(): Record<string, number> {
  const metrics = advisoryLockService.getMetrics();
  const now = Date.now();

  const avgAcquisitionTime =
    metrics.lockAcquisitionTime.length > 0
      ? metrics.lockAcquisitionTime.reduce((a, b) => a + b, 0) / metrics.lockAcquisitionTime.length
      : 0;

  return {
    lock_avg_acquisition_ms: avgAcquisitionTime,
    lock_contention_total: metrics.contentionCount,
    lock_timeout_total: metrics.timeoutCount,
    lock_last_recorded_at: now,
  };
}

export const lockMetricsExporter = {
  getMetrics: collectLockMetrics,
  resetMetrics: () => advisoryLockService.resetMetrics(),
};
