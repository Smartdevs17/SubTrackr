import { CronJob } from 'cron';
import type { Pool } from 'pg';
import { AlertingService, type NotificationService } from '../domain/alertingService';

/**
 * Threshold Evaluator Cron Job
 * Runs every 5 minutes to evaluate usage thresholds and send alerts.
 */
export class ThresholdEvaluatorJob {
  private job: CronJob | null = null;
  private alertingService: AlertingService;

  constructor(
    private pool: Pool,
    notificationService: NotificationService
  ) {
    this.alertingService = new AlertingService(pool, notificationService);
  }

  start(): void {
    if (this.job) return;

    // Run every 5 minutes: 0, 5, 10, 15, ...
    this.job = new CronJob('*/5 * * * *', async () => {
      try {
        console.log('[ThresholdEvaluatorJob] Starting evaluation cycle');
        await this.alertingService.evaluateAllThresholds();
        console.log('[ThresholdEvaluatorJob] Evaluation cycle complete');
      } catch (error) {
        console.error('[ThresholdEvaluatorJob] Error:', error);
      }
    });

    this.job.start();
    console.log('[ThresholdEvaluatorJob] Started (runs every 5 minutes)');
  }

  stop(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
      console.log('[ThresholdEvaluatorJob] Stopped');
    }
  }
}
