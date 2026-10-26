/**
 * budget_checker cron
 *
 * Periodically scans active campaigns for budget exhaustion (max redemptions
 * or max discount amount reached) and flags them so they stop auto-applying.
 */
import { Campaign, CampaignStatus } from '../../../src/types/campaign';

export interface BudgetCheckResult {
  campaignId: string;
  exhausted: boolean;
  reason?: 'max_redemptions' | 'max_discount_amount';
}

export function checkCampaignBudget(campaign: Campaign): BudgetCheckResult {
  if (campaign.maxRedemptions != null && (campaign.currentRedemptions ?? 0) >= campaign.maxRedemptions) {
    return { campaignId: campaign.id, exhausted: true, reason: 'max_redemptions' };
  }
  const maxDiscount = campaign.promotionRule?.maxDiscountAmount;
  if (maxDiscount != null && (campaign.analytics?.totalDiscountGiven ?? 0) >= maxDiscount) {
    return { campaignId: campaign.id, exhausted: true, reason: 'max_discount_amount' };
  }
  return { campaignId: campaign.id, exhausted: false };
}

export class BudgetChecker {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly getCampaigns: () => Campaign[],
    private readonly onExhausted: (campaign: Campaign, result: BudgetCheckResult) => void,
    private readonly intervalMs = 5 * 60 * 1000
  ) {}

  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => this.runOnce(), this.intervalMs);
    if (this.intervalHandle.unref) this.intervalHandle.unref();
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  runOnce(): BudgetCheckResult[] {
    const results: BudgetCheckResult[] = [];
    for (const campaign of this.getCampaigns()) {
      if (campaign.status !== CampaignStatus.ACTIVE) continue;
      const result = checkCampaignBudget(campaign);
      results.push(result);
      if (result.exhausted) this.onExhausted(campaign, result);
    }
    return results;
  }
}
