import { FraudRule, FraudTransaction, FraudContext, RuleResult } from './FraudRule';

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export class VelocityRule implements FraudRule {
  readonly name = 'velocity_check';
  readonly weight = 1.2;
  readonly category = 'velocity' as const;
  enabled = true;

  evaluate(transaction: FraudTransaction, context: FraudContext): RuleResult {
    const txTime = new Date(transaction.createdAt).getTime();
    const recent = context.subscriberHistory.filter((t) => {
      const tTime = new Date(t.createdAt).getTime();
      return Math.abs(txTime - tTime) <= WINDOW_MS && t.id !== transaction.id;
    });

    if (recent.length === 0) {
      return { score: 0, reasons: [], triggered: false };
    }

    let score = 0;
    const reasons: string[] = [];

    if (recent.length >= 4) {
      score = 35;
      reasons.push(`${recent.length + 1} subscriptions created within 24 hours (high velocity)`);
    } else if (recent.length >= 2) {
      score = 20;
      reasons.push(`${recent.length + 1} subscriptions created within 24 hours`);
    } else {
      score = 10;
      reasons.push('2 subscriptions created within 24 hours');
    }

    return { score, reasons, triggered: true };
  }
}
