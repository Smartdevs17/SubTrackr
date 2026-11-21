import { FraudRule } from '../rules/FraudRule';
import { FraudDetector } from './FraudDetector';

/** Wraps an existing FraudRule so it can run in the DetectorPipeline. */
export function ruleToDetector(rule: FraudRule): FraudDetector {
  return {
    id: rule.name,
    category: rule.category,
    get weight() {
      return rule.weight;
    },
    get enabled() {
      return rule.enabled;
    },
    set enabled(value: boolean) {
      rule.enabled = value;
    },
    detect: (tx, ctx) => rule.evaluate(tx, ctx),
  };
}
