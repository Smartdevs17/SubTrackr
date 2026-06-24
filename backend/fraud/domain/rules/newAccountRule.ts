import { FraudRule, FraudTransaction, FraudContext, RuleResult } from './FraudRule';

/** Flags high-value transactions from very new accounts. */
export class NewAccountRule implements FraudRule {
  readonly name = 'new_account';
  readonly weight = 0.9;
  readonly category = 'new-account' as const;
  enabled = true;

  private readonly newAccountThresholdDays: number;
  private readonly minAmountToFlag: number;

  constructor(newAccountThresholdDays = 7, minAmountToFlag = 50) {
    this.newAccountThresholdDays = newAccountThresholdDays;
    this.minAmountToFlag = minAmountToFlag;
  }

  evaluate(transaction: FraudTransaction, context: FraudContext): RuleResult {
    const ageDays = context.accountAgeDays;
    if (ageDays === undefined || ageDays >= this.newAccountThresholdDays) {
      return { score: 0, reasons: [], triggered: false };
    }

    if (transaction.amount < this.minAmountToFlag) {
      return { score: 0, reasons: [], triggered: false };
    }

    const score = ageDays <= 1 ? 25 : ageDays <= 3 ? 18 : 10;

    return {
      score,
      reasons: [
        `Account is only ${ageDays} day(s) old with a ${transaction.currency} ${transaction.amount} charge`,
      ],
      triggered: true,
    };
  }
}
