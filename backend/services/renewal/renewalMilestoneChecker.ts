// Issue 560: Renewal milestone checker cron job

import type { RenewalMilestone, RenewalRecord } from '../../../src/types/renewal';
import { renewalService } from './renewalService';

export interface MilestoneCheckResult {
  renewalId: string;
  subscriptionId: string;
  milestones: RenewalMilestone[];
  autoRenewed: boolean;
}

/**
 * Checks all active renewals for pending milestones and auto-renewals.
 * Intended to run on a periodic cron schedule (e.g. daily).
 */
export class RenewalMilestoneChecker {
  private notifyCallback?: (renewal: RenewalRecord, milestone: RenewalMilestone) => Promise<void>;

  onMilestoneTriggered(
    cb: (renewal: RenewalRecord, milestone: RenewalMilestone) => Promise<void>
  ): void {
    this.notifyCallback = cb;
  }

  async run(): Promise<MilestoneCheckResult[]> {
    const results: MilestoneCheckResult[] = [];

    // Process auto-renewals first
    const autoRenewed = renewalService.processAutoRenewals();
    const autoRenewedIds = new Set(autoRenewed.map((r) => r.id));

    // Check milestones for all active renewals
    const allRenewals = renewalService.listRenewals();
    for (const renewal of allRenewals) {
      if (['won', 'lost', 'auto_renewed', 'signed'].includes(renewal.status)) continue;

      const pending = renewalService.getPendingMilestones(renewal.id);
      const triggered: RenewalMilestone[] = [];

      for (const milestone of pending) {
        renewalService.recordMilestone(renewal.id, milestone);
        triggered.push(milestone);

        if (this.notifyCallback) {
          try {
            await this.notifyCallback(renewal, milestone);
            renewalService.markMilestoneNotified(renewal.id, milestone);
          } catch (err) {
            console.error(`Failed to notify milestone ${milestone} for renewal ${renewal.id}:`, err);
          }
        }
      }

      if (triggered.length > 0 || autoRenewedIds.has(renewal.id)) {
        results.push({
          renewalId: renewal.id,
          subscriptionId: renewal.subscriptionId,
          milestones: triggered,
          autoRenewed: autoRenewedIds.has(renewal.id),
        });
      }
    }

    return results;
  }
}

export const renewalMilestoneChecker = new RenewalMilestoneChecker();
