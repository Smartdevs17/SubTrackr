/**
 * PCI DSS — Network Security (Requirement 1: Install and maintain firewall)
 *
 * Defines network segmentation rules to isolate the cardholder data
 * environment (CDE) from other network zones.
 */

export interface NetworkSecurityRule {
  id: string;
  name: string;
  sourceZone: string;
  destZone: string;
  allowedPorts: number[];
  protocol: 'tcp' | 'udp' | 'any';
  description: string;
  enabled: boolean;
}

export const PCI_NETWORK_SECURITY_CONTROLS: NetworkSecurityRule[] = [
  {
    id: 'cde-isolation-inbound',
    name: 'CDE Inbound — Payment Processor Only',
    sourceZone: 'dmz',
    destZone: 'cde',
    allowedPorts: [443],
    protocol: 'tcp',
    description: 'Only HTTPS traffic from DMZ to CDE is permitted',
    enabled: true,
  },
  {
    id: 'cde-isolation-outbound',
    name: 'CDE Outbound — Payment Gateway Only',
    sourceZone: 'cde',
    destZone: 'external',
    allowedPorts: [443],
    protocol: 'tcp',
    description: 'CDE can only reach external payment gateways over HTTPS',
    enabled: true,
  },
  {
    id: 'cde-block-internal',
    name: 'Block Internal Access to CDE',
    sourceZone: 'internal',
    destZone: 'cde',
    allowedPorts: [],
    protocol: 'any',
    description: 'Internal corporate network cannot directly access CDE',
    enabled: true,
  },
  {
    id: 'cde-block-public',
    name: 'Block Public Access to CDE',
    sourceZone: 'public',
    destZone: 'cde',
    allowedPorts: [],
    protocol: 'any',
    description: 'No direct public internet access to CDE',
    enabled: true,
  },
  {
    id: 'dmz-to-internal-https',
    name: 'DMZ to Internal HTTPS',
    sourceZone: 'dmz',
    destZone: 'internal',
    allowedPorts: [443, 8443],
    protocol: 'tcp',
    description: 'DMZ can reach internal services over TLS only',
    enabled: true,
  },
];

export class NetworkSecurityService {
  private rules: Map<string, NetworkSecurityRule> = new Map();

  constructor() {
    for (const rule of PCI_NETWORK_SECURITY_CONTROLS) {
      this.rules.set(rule.id, { ...rule });
    }
  }

  /**
   * Check if a connection between zones is allowed.
   */
  isConnectionAllowed(
    sourceZone: string,
    destZone: string,
    port: number,
    protocol: 'tcp' | 'udp' | 'any' = 'tcp',
  ): { allowed: boolean; matchedRule?: NetworkSecurityRule } {
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (rule.sourceZone !== sourceZone || rule.destZone !== destZone) continue;
      if (rule.protocol !== 'any' && rule.protocol !== protocol) continue;
      if (rule.allowedPorts.length === 0) {
        // Explicit deny rule
        return { allowed: false, matchedRule: rule };
      }
      if (rule.allowedPorts.includes(port)) {
        return { allowed: true, matchedRule: rule };
      }
    }
    // Default deny if no matching rule
    return { allowed: false };
  }

  enableRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    rule.enabled = true;
    return true;
  }

  disableRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;
    rule.enabled = false;
    return true;
  }

  getRules(): NetworkSecurityRule[] {
    return [...this.rules.values()];
  }

  getEnabledRules(): NetworkSecurityRule[] {
    return [...this.rules.values()].filter((r) => r.enabled);
  }

  /**
   * Verify all CDE isolation rules are enabled.
   */
  verifyCdeIsolation(): { compliant: boolean; disabledRules: string[] } {
    const cdeRules = [...this.rules.values()].filter(
      (r) => r.sourceZone === 'cde' || r.destZone === 'cde',
    );
    const disabled = cdeRules.filter((r) => !r.enabled).map((r) => r.id);
    return { compliant: disabled.length === 0, disabledRules: disabled };
  }
}
