import {
  ProrationPreview,
  CreditMemo,
  getPeriodDays,
  getRemainingDays,
  previewProration as clientPreviewProration,
  calculateMidCycleProration,
  generateCreditMemo as clientGenerateCreditMemo,
  applyCreditMemo as clientApplyCreditMemo,
} from '../../../src/utils/proration';
import type { Subscription } from '../../../src/types/subscription';

export interface ProrationConfiguration {
  planId: string;
  method: 'daily' | 'hourly' | 'none';
  allowMidCycleChanges: boolean;
  maxChangesPerCycle: number;
  creditExpirationDays: number;
  prorationPrecision: number;
}

export interface ProrationAnalytics {
  totalProrations: number;
  totalCreditsIssued: number;
  totalChargesApplied: number;
  netProrationAmount: number;
  averageProrationAmount: number;
  prorationCount: number;
  creditsUsedCount: number;
  chargesCount: number;
  disputesCount: number;
  disputesResolved: number;
  averageResolutionDays: number;
}

export interface ProrationDispute {
  id: string;
  subscriptionId: string;
  prorationId: string;
  amount: number;
  reason: string;
  status: 'pending' | 'investigating' | 'resolved' | 'rejected';
  createdAt: Date;
  resolvedAt?: Date;
  resolution?: string;
}

export interface MidCycleChangeRequest {
  subscriptionId: string;
  oldPrice: number;
  newPrice: number;
  effectiveDate: 'immediate' | 'end_of_period' | Date;
  reason?: string;
  requestedBy: string;
}

const DEFAULT_CONFIG: ProrationConfiguration = {
  planId: 'default',
  method: 'daily',
  allowMidCycleChanges: true,
  maxChangesPerCycle: 3,
  creditExpirationDays: 90,
  prorationPrecision: 2,
};

export class ProrationService {
  private configurations = new Map<string, ProrationConfiguration>();
  private disputes: ProrationDispute[] = [];
  private prorationHistory: Array<{
    subscriptionId: string;
    preview: ProrationPreview;
    timestamp: Date;
    applied: boolean;
  }> = [];

  configurePlan(planId: string, config: Partial<ProrationConfiguration>): ProrationConfiguration {
    const existing = this.configurations.get(planId);
    const merged: ProrationConfiguration = {
      ...DEFAULT_CONFIG,
      ...existing,
      ...config,
      planId,
    };
    this.configurations.set(planId, merged);
    return merged;
  }

  getConfiguration(planId: string): ProrationConfiguration {
    return this.configurations.get(planId) ?? DEFAULT_CONFIG;
  }

  calculateProration(
    subscription: Subscription,
    newPrice: number,
    effectiveDate: 'immediate' | 'end_of_period' | Date,
    planId?: string
  ): ProrationPreview {
    const config = this.getConfiguration(planId ?? subscription.id);

    if (config.method === 'none') {
      return {
        amount: 0,
        isCredit: false,
        remainingDays: 0,
        periodDays: 0,
        oldDailyRate: 0,
        newDailyRate: 0,
        description: 'Proration disabled for this plan',
        effectiveDate: 'end_of_period',
      };
    }

    let effectiveType: 'immediate' | 'end_of_period' = 'immediate';
    if (effectiveDate === 'end_of_period') {
      effectiveType = 'end_of_period';
    } else if (effectiveDate instanceof Date) {
      const now = new Date();
      const nextBilling = new Date(subscription.nextBillingDate);
      if (effectiveDate.getTime() > now.getTime() && effectiveDate.getTime() <= nextBilling.getTime()) {
        effectiveType = 'immediate';
      } else {
        effectiveType = 'end_of_period';
      }
    }

    const preview =
      effectiveDate instanceof Date || effectiveType === 'immediate'
        ? calculateMidCycleProration(subscription, newPrice, effectiveDate)
        : clientPreviewProration(subscription, newPrice, effectiveType);

    if (config.method === 'hourly') {
      const hoursRemaining = preview.remainingDays * 24;
      const hoursInPeriod = preview.periodDays * 24;
      const amount = effectiveType === 'end_of_period'
        ? 0
        : ((newPrice - subscription.price) * hoursRemaining) / hoursInPeriod;

      const roundedAmount = Math.round(Math.abs(amount) * Math.pow(10, config.prorationPrecision))
        / Math.pow(10, config.prorationPrecision);

      return {
        ...preview,
        amount: roundedAmount,
        isCredit: amount < 0,
        description: amount < 0
          ? `Prorated credit of ${roundedAmount} for plan downgrade (${hoursRemaining} hours remaining)`
          : amount > 0
            ? `Prorated charge of ${roundedAmount} for plan upgrade (${hoursRemaining} hours remaining)`
            : 'No proration required',
      };
    }

    return preview;
  }

  executeMidCycleChange(
    subscription: Subscription,
    newPrice: number,
    effectiveDate: 'immediate' | 'end_of_period' | Date,
    planId?: string
  ): { preview: ProrationPreview; creditMemo?: CreditMemo } {
    const config = this.getConfiguration(planId ?? subscription.id);

    if (!config.allowMidCycleChanges) {
      throw new Error('Mid-cycle changes are not allowed for this plan');
    }

    const recentChanges = this.prorationHistory.filter(
      (h) =>
        h.subscriptionId === subscription.id &&
        h.applied &&
        h.timestamp.getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000
    );

    if (recentChanges.length >= config.maxChangesPerCycle) {
      throw new Error(`Maximum ${config.maxChangesPerCycle} plan changes per cycle reached`);
    }

    const preview = this.calculateProration(subscription, newPrice, effectiveDate, planId);

    let creditMemo: CreditMemo | undefined;
    if (preview.isCredit && preview.amount > 0) {
      creditMemo = clientGenerateCreditMemo(subscription.id, preview.amount, preview.description);
    }

    this.prorationHistory.push({
      subscriptionId: subscription.id,
      preview,
      timestamp: new Date(),
      applied: true,
    });

    return { preview, creditMemo };
  }

  createDispute(
    subscriptionId: string,
    prorationId: string,
    amount: number,
    reason: string
  ): ProrationDispute {
    const dispute: ProrationDispute = {
      id: `disp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      subscriptionId,
      prorationId,
      amount,
      reason,
      status: 'pending',
      createdAt: new Date(),
    };
    this.disputes.push(dispute);
    return dispute;
  }

  resolveDispute(disputeId: string, resolution: string, approved: boolean): ProrationDispute | null {
    const dispute = this.disputes.find((d) => d.id === disputeId);
    if (!dispute) return null;

    dispute.status = approved ? 'resolved' : 'rejected';
    dispute.resolvedAt = new Date();
    dispute.resolution = resolution;
    return dispute;
  }

  getDisputes(subscriptionId?: string): ProrationDispute[] {
    if (subscriptionId) {
      return this.disputes.filter((d) => d.subscriptionId === subscriptionId);
    }
    return [...this.disputes];
  }

  getAnalytics(subscriptionId?: string): ProrationAnalytics {
    const history = subscriptionId
      ? this.prorationHistory.filter((h) => h.subscriptionId === subscriptionId)
      : this.prorationHistory;

    const disputes = subscriptionId
      ? this.disputes.filter((d) => d.subscriptionId === subscriptionId)
      : this.disputes;

    const totalCredits = history
      .filter((h) => h.preview.isCredit)
      .reduce((sum, h) => sum + h.preview.amount, 0);

    const totalCharges = history
      .filter((h) => !h.preview.isCredit && h.preview.amount > 0)
      .reduce((sum, h) => sum + h.preview.amount, 0);

    const allProrationAmounts = history.map((h) => h.preview.amount).filter((a) => a > 0);
    const averageAmount = allProrationAmounts.length > 0
      ? allProrationAmounts.reduce((s, a) => s + a, 0) / allProrationAmounts.length
      : 0;

    const resolvedDisputes = disputes.filter((d) => d.status === 'resolved' || d.status === 'rejected');
    const avgResolutionDays = resolvedDisputes.length > 0
      ? resolvedDisputes.reduce((sum, d) => {
          const days = d.resolvedAt
            ? (d.resolvedAt.getTime() - d.createdAt.getTime()) / (1000 * 60 * 60 * 24)
            : 0;
          return sum + days;
        }, 0) / resolvedDisputes.length
      : 0;

    return {
      totalProrations: history.length,
      totalCreditsIssued: totalCredits,
      totalChargesApplied: totalCharges,
      netProrationAmount: totalCharges - totalCredits,
      averageProrationAmount: Math.round(averageAmount * 100) / 100,
      prorationCount: history.length,
      creditsUsedCount: history.filter((h) => h.preview.isCredit).length,
      chargesCount: history.filter((h) => !h.preview.isCredit).length,
      disputesCount: disputes.length,
      disputesResolved: resolvedDisputes.length,
      averageResolutionDays: Math.round(avgResolutionDays * 10) / 10,
    };
  }

  getHistory(subscriptionId?: string) {
    if (subscriptionId) {
      return this.prorationHistory.filter((h) => h.subscriptionId === subscriptionId);
    }
    return [...this.prorationHistory];
  }
}

export const prorationService = new ProrationService();
