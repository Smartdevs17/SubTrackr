import { FraudRule, FraudTransaction, FraudContext, RuleResult } from './FraudRule';

export class DeviceFingerprintRule implements FraudRule {
  readonly name = 'device_fingerprint_mismatch';
  readonly weight = 1.0;
  readonly category = 'device-mismatch' as const;
  enabled = true;

  evaluate(transaction: FraudTransaction, _context: FraudContext): RuleResult {
    const { deviceFingerprint, trustedDeviceFingerprint } = transaction;

    if (
      !deviceFingerprint ||
      !trustedDeviceFingerprint ||
      deviceFingerprint === trustedDeviceFingerprint
    ) {
      return { score: 0, reasons: [], triggered: false };
    }

    return {
      score: 20,
      reasons: ['Device fingerprint does not match the trusted profile'],
      triggered: true,
    };
  }
}
