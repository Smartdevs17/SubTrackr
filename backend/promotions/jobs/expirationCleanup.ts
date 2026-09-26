/**
 * expiration_cleanup cron
 *
 * Periodically deactivates expired coupon codes and completes campaigns
 * whose schedule has ended, so they stop being offered at checkout.
 */
import { Campaign, CampaignStatus } from '../../../src/types/campaign';

export interface ExpirationCleanupResult {
  campaignId: string;
  deactivatedCouponCodes: string[];
  campaignCompleted: boolean;
}

export function cleanupExpiredCoupons(campaign: Campaign, now: Date = new Date()): ExpirationCleanupResult {
  const deactivatedCouponCodes: string[] = [];

  const updatedCoupons = campaign.couponCodes?.map((coupon) => {
    if (coupon.isActive && coupon.expiresAt && new Date(coupon.expiresAt) < now) {
      deactivatedCouponCodes.push(coupon.code);
      return { ...coupon, isActive: false };
    }
    return coupon;
  });

  const scheduleEnded = Boolean(campaign.schedule?.endDate && new Date(campaign.schedule.endDate) < now);
  const campaignCompleted = scheduleEnded && campaign.status === CampaignStatus.ACTIVE;

  return { campaignId: campaign.id, deactivatedCouponCodes, campaignCompleted };
}

export class ExpirationCleanupCron {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly getCampaigns: () => Campaign[],
    private readonly applyCleanup: (campaign: Campaign, result: ExpirationCleanupResult) => void,
    private readonly intervalMs = 60 * 60 * 1000
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

  runOnce(): ExpirationCleanupResult[] {
    const results: ExpirationCleanupResult[] = [];
    for (const campaign of this.getCampaigns()) {
      const result = cleanupExpiredCoupons(campaign);
      results.push(result);
      if (result.deactivatedCouponCodes.length > 0 || result.campaignCompleted) {
        this.applyCleanup(campaign, result);
      }
    }
    return results;
  }
}
