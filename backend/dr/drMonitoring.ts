import { disasterRecoveryService, RPO_SECONDS } from './DisasterRecoveryService';
import { logger } from '../services/shared/logging';

export class DisasterRecoveryMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs: number;

  constructor(checkIntervalMs = 5 * 60 * 1000) { // Default 5 minutes
    this.checkIntervalMs = checkIntervalMs;
  }

  start() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.checkHealth(), this.checkIntervalMs);
    logger.info('Disaster Recovery Monitor started.');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Disaster Recovery Monitor stopped.');
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const backups = await disasterRecoveryService.listBackups();
      
      if (backups.length === 0) {
        this.triggerAlert('CRITICAL_RPO_BREACH', 'No backups found. RPO is severely breached.');
        return false;
      }

      const mostRecent = backups[0];
      const verification = await disasterRecoveryService.verifyBackup(mostRecent.id);

      if (!verification.valid) {
        this.triggerAlert('BACKUP_CORRUPTION', `Most recent backup (${mostRecent.id}) is corrupted: ${verification.errors.join(', ')}`);
        return false;
      }

      const ageMs = Date.now() - mostRecent.createdAt;
      if (ageMs > RPO_SECONDS * 1000) {
        this.triggerAlert('RPO_BREACH', `Most recent backup is ${Math.round(ageMs / 1000)}s old, exceeding RPO of ${RPO_SECONDS}s.`);
        return false;
      }

      logger.info(`DR Health Check passed. Backup age: ${Math.round(ageMs / 1000)}s.`);
      return true;
    } catch (error) {
      logger.error('Failed to run DR health check', { error });
      this.triggerAlert('MONITORING_FAILURE', 'Failed to run DR health check.');
      return false;
    }
  }

  private triggerAlert(type: string, message: string) {
    // Integrate with log-based alerting
    logger.error(`[DR ALERT: ${type}] ${message}`, { alertType: 'DR' });
  }
}

export const drMonitor = new DisasterRecoveryMonitor();
