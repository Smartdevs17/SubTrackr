import { FraudRule, FraudTransaction, FraudContext, RuleResult } from './FraudRule';

/** Flags transactions where the amount is unusually high for the merchant. */
export class AmountThresholdRule implements FraudRule {
  readonly name = 'amount_threshold';
  readonly weight = 0.8;
  readonly category = 'amount-threshold' as const;
  enabled = true;

  /** Default threshold in the transaction's native currency. */
  private readonly defaultThreshold: number;

  constructor(defaultThreshold = 500) {
    this.defaultThreshold = defaultThreshold;
  }

  evaluate(transaction: FraudTransaction, context: FraudContext): RuleResult {
    const threshold = context.merchantThreshold ?? this.defaultThreshold;
    if (transaction.amount <= threshold) {
      return { score: 0, reasons: [], triggered: false };
    }

    const ratio = transaction.amount / threshold;
    let score = 0;
    const reasons: string[] = [];

    if (ratio >= 5) {
      score = 30;
      reasons.push(
        `Transaction amount ${transaction.amount} is ${ratio.toFixed(1)}x above threshold (${threshold})`,
      );
    } else if (ratio >= 2) {
      score = 18;
      reasons.push(`Transaction amount ${transaction.amount} exceeds threshold (${threshold})`);
    } else {
      score = 8;
      reasons.push(`Transaction amount ${transaction.amount} slightly above threshold (${threshold})`);
    }

    return { score, reasons, triggered: true };
  }
}
