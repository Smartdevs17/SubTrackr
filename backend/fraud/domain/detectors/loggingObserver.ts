import { DetectorObserver } from './FraudDetector';

/** Logs failed detector runs at warn level and slow/ok runs at debug level. */
export function createLoggingObserver(
  logger: Pick<Console, 'warn' | 'debug'> = console,
): DetectorObserver {
  return {
    onDetectorRun(e) {
      if (e.outcome === 'ok') {
        logger.debug('[fraud] detector ok', {
          detector: e.detectorId,
          tx: e.transactionId,
          ms: e.durationMs,
          score: e.score,
        });
      } else {
        logger.warn('[fraud] detector failed', {
          detector: e.detectorId,
          tx: e.transactionId,
          outcome: e.outcome,
          ms: e.durationMs,
          error: e.error instanceof Error ? e.error.message : e.error,
        });
      }
    },
  };
}
