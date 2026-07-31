import { FraudRule, FraudTransaction, FraudContext, RuleResult } from './FraudRule';

export class ChargebackRule implements FraudRule {
  readonly name = 'chargeback_history';
  readonly weight = 1.3;
  readonly category = 'chargeback' as const;
  enabled = true;

  evaluate(transaction: FraudTransaction, _context: FraudContext): RuleResult {
    const { chargebacks } = transaction;

    if (chargebacks === 0) {
      return { score: 0, reasons: [], triggered: false };
    }

    const score = Math.min(18 + chargebacks * 12, 45);

    return {
      score,
      reasons: [
        `Subscriber has ${chargebacks} chargeback(s) — predicts dispute exposure`,
      ],
      triggered: true,
    };
  }
}
