import type {
  SplitConfiguration,
  SplitExecution,
  SplitTier,
  Partner,
  PartnerEarnings,
  PayoutRecord,
  SplitType,
} from '../types/partner';
import { PartnerStatus, PartnerPayoutSchedule } from '../types/partner';

export interface SplitResult {
  splits: Array<{ partnerId: string; amount: number; percentage: number }>;
  platformRevenue: number;
  totalSplit: number;
}

export interface SplitValidationResult {
  isValid: boolean;
  errors: string[];
}

export class SplitEngine {
  static calculateSplit(config: SplitConfiguration, grossAmount: number): SplitResult {
    if (grossAmount <= 0) {
      return { splits: [], platformRevenue: grossAmount, totalSplit: 0 };
    }

    switch (config.splitType) {
      case 'percentage':
        return this.calculatePercentageSplit(config, grossAmount);
      case 'fixed_amount':
        return this.calculateFixedAmountSplit(config, grossAmount);
      case 'tiered_waterfall':
        return this.calculateTieredWaterfall(config, grossAmount);
      default:
        return { splits: [], platformRevenue: grossAmount, totalSplit: 0 };
    }
  }

  private static calculatePercentageSplit(
    config: SplitConfiguration,
    grossAmount: number
  ): SplitResult {
    const percentage = config.percentage ?? 0;
    const clampedPercentage = Math.min(100, Math.max(0, percentage));
    const partnerAmount = grossAmount * (clampedPercentage / 100);
    const platformRevenue = grossAmount - partnerAmount;

    return {
      splits: [
        {
          partnerId: config.partnerId,
          amount: partnerAmount,
          percentage: clampedPercentage,
        },
      ],
      platformRevenue,
      totalSplit: partnerAmount,
    };
  }

  private static calculateFixedAmountSplit(
    config: SplitConfiguration,
    grossAmount: number
  ): SplitResult {
    const fixedAmount = Math.min(config.fixedAmount ?? 0, grossAmount);
    const platformRevenue = grossAmount - fixedAmount;

    return {
      splits: [
        {
          partnerId: config.partnerId,
          amount: fixedAmount,
          percentage: grossAmount > 0 ? (fixedAmount / grossAmount) * 100 : 0,
        },
      ],
      platformRevenue,
      totalSplit: fixedAmount,
    };
  }

  private static calculateTieredWaterfall(
    config: SplitConfiguration,
    grossAmount: number
  ): SplitResult {
    const tiers = config.tiers ?? [];
    if (tiers.length === 0) {
      return { splits: [], platformRevenue: grossAmount, totalSplit: 0 };
    }

    const sortedTiers = [...tiers].sort((a, b) => a.threshold - b.threshold);
    let remaining = grossAmount;
    const splits: Array<{ partnerId: string; amount: number; percentage: number }> = [];

    for (const tier of sortedTiers) {
      if (remaining <= 0) break;

      const tierAmount = Math.min(tier.fixedAmount ?? remaining * (tier.splitPercentage / 100), remaining);
      if (tierAmount <= 0) continue;

      splits.push({
        partnerId: config.partnerId,
        amount: tierAmount,
        percentage: tier.splitPercentage,
      });
      remaining -= tierAmount;
    }

    const totalSplit = splits.reduce((sum, s) => sum + s.amount, 0);
    return {
      splits,
      platformRevenue: grossAmount - totalSplit,
      totalSplit,
    };
  }

  static executeWaterfall(
    configurations: SplitConfiguration[],
    grossAmount: number
  ): SplitResult {
    const sorted = [...configurations].sort((a, b) => {
      const priorityA = a.tiers?.[0]?.priority ?? 0;
      const priorityB = b.tiers?.[0]?.priority ?? 0;
      return priorityA - priorityB;
    });

    let remaining = grossAmount;
    const allSplits: Array<{ partnerId: string; amount: number; percentage: number }> = [];

    for (const config of sorted) {
      if (remaining <= 0) break;
      const result = this.calculateSplit(config, remaining);
      allSplits.push(...result.splits);
      remaining -= result.totalSplit;
    }

    const totalSplit = allSplits.reduce((sum, s) => sum + s.amount, 0);
    return {
      splits: allSplits,
      platformRevenue: grossAmount - totalSplit,
      totalSplit,
    };
  }

  static validateSplitConfig(config: Partial<SplitConfiguration>): SplitValidationResult {
    const errors: string[] = [];

    if (!config.splitType) {
      errors.push('Split type is required');
    }

    if (!config.partnerId) {
      errors.push('Partner ID is required');
    }

    if (!config.subscriptionId) {
      errors.push('Subscription ID is required');
    }

    if (config.splitType === 'percentage') {
      if (config.percentage === undefined || config.percentage === null) {
        errors.push('Percentage is required for percentage splits');
      } else if (config.percentage < 0 || config.percentage > 100) {
        errors.push('Percentage must be between 0 and 100');
      }
    }

    if (config.splitType === 'fixed_amount') {
      if (config.fixedAmount === undefined || config.fixedAmount === null) {
        errors.push('Fixed amount is required for fixed amount splits');
      } else if (config.fixedAmount < 0) {
        errors.push('Fixed amount must be non-negative');
      }
    }

    if (config.splitType === 'tiered_waterfall') {
      if (!config.tiers || config.tiers.length === 0) {
        errors.push('At least one tier is required for tiered waterfall splits');
      } else {
        const totalPercentage = config.tiers.reduce((sum, t) => sum + t.splitPercentage, 0);
        if (totalPercentage > 100) {
          errors.push('Total tier percentage cannot exceed 100');
        }
        const hasDuplicatePriorities = new Set(config.tiers.map((t) => t.priority)).size !== config.tiers.length;
        if (hasDuplicatePriorities) {
          errors.push('Tier priorities must be unique');
        }
      }
    }

    if (config.payoutSchedule && !Object.values(PartnerPayoutSchedule).includes(config.payoutSchedule)) {
      errors.push('Invalid payout schedule');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

export class PartnerService {
  static calculatePartnerEarnings(
    payouts: PayoutRecord[],
    partnerId: string,
    startDate?: Date,
    endDate?: Date
  ): PartnerEarnings {
    const start = startDate ?? new Date(0);
    const end = endDate ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const filtered = payouts.filter((p) => {
      if (p.partnerId !== partnerId) return false;
      const createdAt = new Date(p.createdAt);
      return createdAt >= start && createdAt <= end;
    });

    const totalEarnings = filtered.reduce((sum, p) => sum + p.netAmount, 0);
    const pendingPayouts = payouts
      .filter((p) => p.partnerId === partnerId && p.status === 'pending')
      .reduce((sum, p) => sum + p.netAmount, 0);
    const completedPayouts = filtered
      .filter((p) => p.status === 'completed')
      .reduce((sum, p) => sum + p.netAmount, 0);

    const bySubscription: Record<string, number> = {};
    filtered.forEach((p) => {
      bySubscription[p.subscriptionId] = (bySubscription[p.subscriptionId] || 0) + p.netAmount;
    });

    return {
      partnerId,
      totalEarnings,
      pendingPayouts,
      completedPayouts,
      currency: filtered[0]?.currency ?? 'USD',
      periodStart: start,
      periodEnd: end,
      bySubscription,
    };
  }

  static shouldProcessPayout(
    config: SplitConfiguration,
    lastPayoutDate: Date | null,
    now: Date
  ): boolean {
    if (!config.isActive) return false;

    switch (config.payoutSchedule) {
      case 'instant':
        return true;
      case 'daily': {
        if (!lastPayoutDate) return true;
        const diff = now.getTime() - lastPayoutDate.getTime();
        return diff >= 24 * 60 * 60 * 1000;
      }
      case 'weekly': {
        if (!lastPayoutDate) return true;
        const diff = now.getTime() - lastPayoutDate.getTime();
        return diff >= 7 * 24 * 60 * 60 * 1000;
      }
      case 'threshold': {
        const threshold = config.minPayoutThreshold ?? 0;
        // Threshold check should be done at call site with actual pending balance
        return true;
      }
      default:
        return false;
    }
  }

  static mergeTierConfigs(
    existing: SplitTier[],
    incoming: SplitTier[]
  ): SplitTier[] {
    const byId = new Map(existing.map((t) => [t.id, t]));
    for (const tier of incoming) {
      byId.set(tier.id, tier);
    }
    return Array.from(byId.values()).sort((a, b) => a.priority - b.priority);
  }
}
