import type { DataRetentionService, RetentionEnforcementReport } from './dataRetentionService';

const DEFAULT_INTERVAL_MS = 86_400_000;

/**
 * Periodically enforces data retention policies. Overlapping runs are skipped
 * and failures are logged so the schedule keeps running.
 */
export class RetentionEnforcementJob {
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onReport?: (report: RetentionEnforcementReport) => void;

  constructor(
    private service: DataRetentionService,
    opts?: { intervalMs?: number; onReport?: (report: RetentionEnforcementReport) => void }
  ) {
    this.intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.onReport = opts?.onReport;
  }

  start(): void {
    if (this.timer) return;
    void this.run();
    this.timer = setInterval(() => void this.run(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isScheduled(): boolean {
    return this.timer !== null;
  }

  async run(): Promise<RetentionEnforcementReport | null> {
    if (this.service.isRunning()) return null;
    try {
      const report = await this.service.enforce();
      if (report.failedPolicies.length > 0) {
        console.error(
          `[RetentionEnforcementJob] Policies failed: ${report.failedPolicies.join(', ')}`
        );
      }
      this.onReport?.(report);
      return report;
    } catch (err) {
      console.error('[RetentionEnforcementJob] Enforcement failed:', err);
      return null;
    }
  }
}
