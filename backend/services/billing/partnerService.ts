import type { SplitConfiguration, SplitExecution, PartnerPayoutSchedule } from '../../src/types/partner';
import { SplitEngine, type SplitResult } from '../../src/services/partnerService';

export interface PartnerSplitExecutionInput {
  splitConfiguration: SplitConfiguration;
  transactionId: string;
  grossAmount: number;
}

export interface PayoutSchedulingResult {
  shouldProcess: boolean;
  nextScheduledDate: Date;
  reason: string;
}

export class BackendPartnerService {
  static executeSplitAtSettlement(input: PartnerSplitExecutionInput): SplitExecution {
    const { splitConfiguration, transactionId, grossAmount } = input;

    const result: SplitResult = SplitEngine.calculateSplit(splitConfiguration, grossAmount);

    return {
      id: `exec-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      splitConfigurationId: splitConfiguration.id,
      subscriptionId: splitConfiguration.subscriptionId,
      transactionId,
      grossAmount,
      splits: result.splits.map((s) => ({
        partnerId: s.partnerId,
        amount: s.amount,
        percentage: s.percentage,
      })),
      platformRevenue: result.platformRevenue,
      executedAt: new Date(),
      status: 'completed',
    };
  }

  static shouldSchedulePayout(
    config: SplitConfiguration,
    lastPayoutDate: Date | null
  ): PayoutSchedulingResult {
    const now = new Date();

    if (!config.isActive) {
      return {
        shouldProcess: false,
        nextScheduledDate: now,
        reason: 'Configuration is not active',
      };
    }

    switch (config.payoutSchedule) {
      case 'instant':
        return {
          shouldProcess: true,
          nextScheduledDate: now,
          reason: 'Instant payouts are processed immediately',
        };

      case 'daily': {
        if (!lastPayoutDate) {
          return {
            shouldProcess: true,
            nextScheduledDate: now,
            reason: 'No previous payout found',
          };
        }
        const diffMs = now.getTime() - lastPayoutDate.getTime();
        const oneDayMs = 24 * 60 * 60 * 1000;
        if (diffMs >= oneDayMs) {
          return {
            shouldProcess: true,
            nextScheduledDate: new Date(lastPayoutDate.getTime() + oneDayMs),
            reason: 'Daily threshold reached',
          };
        }
        return {
          shouldProcess: false,
          nextScheduledDate: new Date(lastPayoutDate.getTime() + oneDayMs),
          reason: 'Daily threshold not yet reached',
        };
      }

      case 'weekly': {
        if (!lastPayoutDate) {
          return {
            shouldProcess: true,
            nextScheduledDate: now,
            reason: 'No previous payout found',
          };
        }
        const diffMs = now.getTime() - lastPayoutDate.getTime();
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
        if (diffMs >= oneWeekMs) {
          return {
            shouldProcess: true,
            nextScheduledDate: new Date(lastPayoutDate.getTime() + oneWeekMs),
            reason: 'Weekly threshold reached',
          };
        }
        return {
          shouldProcess: false,
          nextScheduledDate: new Date(lastPayoutDate.getTime() + oneWeekMs),
          reason: 'Weekly threshold not yet reached',
        };
      }

      case 'threshold': {
        const threshold = config.minPayoutThreshold ?? 0;
        if (threshold <= 0) {
          return {
            shouldProcess: true,
            nextScheduledDate: now,
            reason: 'No minimum threshold set',
          };
        }
        return {
          shouldProcess: false,
          nextScheduledDate: now,
          reason: `Pending balance must meet minimum threshold of ${threshold}`,
        };
      }

      default:
        return {
          shouldProcess: false,
          nextScheduledDate: now,
          reason: 'Unknown payout schedule',
        };
    }
  }

  static aggregatePendingPayouts(
    configurations: SplitConfiguration[],
    grossAmount: number
  ): Map<string, number> {
    const pendingByPartner = new Map<string, number>();

    for (const config of configurations) {
      if (!config.isActive) continue;

      const result = SplitEngine.calculateSplit(config, grossAmount);
      for (const split of result.splits) {
        const current = pendingByPartner.get(split.partnerId) ?? 0;
        pendingByPartner.set(split.partnerId, current + split.amount);
      }
    }

    return pendingByPartner;
  }
}
