import { FraudRule, FraudTransaction, FraudContext, RuleResult } from './FraudRule';

/** Flags transactions originating from VPN or proxy IPs. */
export class VpnProxyRule implements FraudRule {
  readonly name = 'vpn_proxy_detection';
  readonly weight = 1.1;
  readonly category = 'vpn-proxy' as const;
  enabled = true;

  evaluate(_transaction: FraudTransaction, context: FraudContext): RuleResult {
    if (!context.vpnDetected) {
      return { score: 0, reasons: [], triggered: false };
    }

    return {
      score: 22,
      reasons: ['Connection originates from a known VPN or proxy network'],
      triggered: true,
    };
  }
}
