import { chargebackService } from '../domain/chargebackService';

/**
 * Auto-submits representment for chargebacks that have all evidence populated
 * and are within 5 days of their deadline.
 */
export async function runAutoSubmitWorker(merchantId: string): Promise<void> {
  const now = Date.now();
  const SUBMIT_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

  const chargebacks = chargebackService.listByMerchant(merchantId);

  for (const cb of chargebacks) {
    if (cb.status !== 'under_review') continue;

    const deadline = new Date(cb.representmentDeadline).getTime();
    const remaining = deadline - now;
    if (remaining <= 0 || remaining > SUBMIT_WINDOW_MS) continue;

    const allEvidenceReady = cb.evidenceItems.every((e) => e.autoPopulated || e.fileUrl);
    if (!allEvidenceReady) continue;

    try {
      const result = await chargebackService.submitRepresentment(cb.id);
      console.log(`[auto_submit_worker] Submitted ${cb.id}: ref=${result.referenceId}`);
    } catch (err) {
      console.error(`[auto_submit_worker] Failed to submit ${cb.id}:`, err);
    }
  }
}
