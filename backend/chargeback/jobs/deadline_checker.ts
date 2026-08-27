import { chargebackService } from '../domain/chargebackService';

const D3_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/**
 * Runs on a schedule (e.g., daily cron).
 * Flags chargebacks approaching representment deadline and escalates at D-3.
 */
export async function runDeadlineChecker(merchantId: string): Promise<void> {
  const now = Date.now();
  const chargebacks = chargebackService.listByMerchant(merchantId);

  for (const cb of chargebacks) {
    if (cb.status !== 'received' && cb.status !== 'under_review') continue;

    const deadline = new Date(cb.representmentDeadline).getTime();
    const remaining = deadline - now;

    if (remaining <= 0) {
      console.warn(`[deadline_checker] EXPIRED: chargeback ${cb.id} past deadline`);
      continue;
    }

    if (remaining <= D3_THRESHOLD_MS) {
      console.warn(
        `[deadline_checker] ESCALATION: chargeback ${cb.id} due in ${Math.ceil(remaining / 86400000)}d — requires immediate action`
      );
      // In production: trigger push notification + email alert to merchant
    }
  }
}
