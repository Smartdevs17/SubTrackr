/**
 * Payment expiry sweeper – periodically expires overdue payment intents
 * and cancels the linked subscriptions (reason: `payment_expired`).
 *
 * Started by the API server; the interval comes from
 * `PAYMENT_EXPIRY_SWEEP_INTERVAL_MS` (default 60s).
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1716
 */

import { paymentExpiryService } from '../domain/paymentExpiryService';
import { logger } from '../../shared/logging';

export interface PaymentExpirySweeperOptions {
  /** Sweep interval in ms. Defaults to `PAYMENT_EXPIRY_SWEEP_INTERVAL_MS` (60s). */
  intervalMs?: number;
}

export class PaymentExpirySweeper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly options: PaymentExpirySweeperOptions = {}) {}

  start(): void {
    if (this.timer) return;

    const intervalMs =
      this.options.intervalMs ??
      Number(process.env.PAYMENT_EXPIRY_SWEEP_INTERVAL_MS ?? 60_000);

    this.timer = setInterval(() => {
      void this.sweep();
    }, intervalMs);
    this.timer.unref?.();

    logger.info('Payment expiry sweeper started', { intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Run a single sweep immediately. Re-entrant sweeps are skipped. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      const results = await paymentExpiryService.expireOverdue();
      if (results.length > 0) {
        logger.info('Expired overdue payment intents', {
          count: results.length,
          cancelled: results.filter((r) => r.subscriptionCancelled).length,
        });
      }
      return results.length;
    } catch (err) {
      logger.warn('Payment expiry sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    } finally {
      this.running = false;
    }
  }
}

/**
 * Start a payment expiry sweeper (singleton-safe: call once at server boot).
 */
export function startPaymentExpirySweeper(
  options: PaymentExpirySweeperOptions = {},
): PaymentExpirySweeper {
  const sweeper = new PaymentExpirySweeper(options);
  sweeper.start();
  return sweeper;
}
