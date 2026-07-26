import { FraudRule, FraudTransaction, FraudContext, RuleResult } from './FraudRule';

export class GeoAnomalyRule implements FraudRule {
  readonly name = 'geographic_anomaly';
  readonly weight = 1.0;
  readonly category = 'geolocation-anomaly' as const;
  enabled = true;

  evaluate(transaction: FraudTransaction, _context: FraudContext): RuleResult {
    const { homeCountry, currentCountry } = transaction;

    if (!homeCountry || !currentCountry || homeCountry === currentCountry) {
      return { score: 0, reasons: [], triggered: false };
    }

    return {
      score: 24,
      reasons: [
        `Activity from ${currentCountry} differs from the normal ${homeCountry} profile`,
      ],
      triggered: true,
    };
  }
}
