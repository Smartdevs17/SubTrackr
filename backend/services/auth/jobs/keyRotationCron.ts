import { apiKeyRotationService } from '../domain/ApiKeyRotationService';
import { logger } from '../../shared/logging';

export class KeyRotationCron {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(intervalMs: number = 60 * 60 * 1000): void {
    if (this.running) return;
    this.running = true;
    logger.info('Key rotation cron started', { intervalMs });
    this.intervalId = setInterval(() => this.execute(), intervalMs);
    this.execute();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    logger.info('Key rotation cron stopped');
  }

  private async execute(): Promise<void> {
    try {
      const dueKeys = await apiKeyRotationService.getKeysDueForRotation();
      if (dueKeys.length === 0) {
        logger.debug('No API keys due for rotation');
        return;
      }

      logger.info('Rotating due API keys', { count: dueKeys.length });

      for (const key of dueKeys) {
        try {
          await apiKeyRotationService.rotateKey(key.id);
          logger.info('Auto-rotated API key', { keyId: key.id, merchantId: key.merchantId });
        } catch (err) {
          logger.error('Failed to auto-rotate API key', {
            keyId: key.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      logger.error('Key rotation cron execution failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const keyRotationCron = new KeyRotationCron();
