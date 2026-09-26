import { FraudRule, FraudTransaction, FraudContext, RuleResult } from './FraudRule';

export class UsageAnomalyRule implements FraudRule {
  readonly name = 'usage_anomaly';
  readonly weight = 1.0;
  readonly category = 'usage-anomaly' as const;
  enabled = true;

  evaluate(transaction: FraudTransaction, _context: FraudContext): RuleResult {
    const { expectedUsage, observedUsage } = transaction;

    if (expectedUsage <= 0) {
      return { score: 0, reasons: [], triggered: false };
    }

    const ratio = observedUsage / expectedUsage;

    if (ratio < 2) {
      return { score: 0, reasons: [], triggered: false };
    }

    let score = 0;
    const reasons: string[] = [];

    if (ratio >= 3) {
      score = 32;
      reasons.push(`Observed usage is ${ratio.toFixed(1)}x the expected baseline (>3x threshold)`);
    } else {
      score = 22;
      reasons.push(`Observed usage is ${ratio.toFixed(1)}x the expected baseline (>2x threshold)`);
    }

    return { score, reasons, triggered: true };
  }
}
