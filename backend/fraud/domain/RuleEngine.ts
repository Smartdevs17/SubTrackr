/**
 * RuleEngine
 *
 * Orchestrates the full fraud evaluation pipeline:
 *   1. Accepts a transaction + context
 *   2. Delegates scoring to the Scorer
 *   3. Supports A/B testing via 50/50 traffic split between rule set A and B
 *   4. Returns a ScorerResult with the final action and per-rule breakdown
 *
 * SIGHUP hot-reload:
 *   In a Node.js process, send SIGHUP to trigger `registry.loadFromDirectory()`
 *   so new rule files are picked up without restarting.
 */

import { FraudTransaction, FraudContext } from './rules/FraudRule';
import { RuleRegistry } from './RuleRegistry';
import { Scorer, ScorerResult } from './Scorer';

// ── Built-in rules ────────────────────────────────────────────────────────────
import { VelocityRule } from './rules/velocityRule';
import { GeoAnomalyRule } from './rules/geoAnomalyRule';
import { DeviceFingerprintRule } from './rules/deviceFingerprintRule';
import { AmountThresholdRule } from './rules/amountThresholdRule';
import { NewAccountRule } from './rules/newAccountRule';
import { VpnProxyRule } from './rules/vpnProxyRule';
import { ChargebackRule } from './rules/chargebackRule';
import { UsageAnomalyRule } from './rules/usageAnomalyRule';

// ── A/B test configuration ────────────────────────────────────────────────────

export interface ABTestConfig {
  enabled: boolean;
  /** Rule names to include only in set A. */
  rulesA: string[];
  /** Rule names to include only in set B. */
  rulesB: string[];
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class RuleEngine {
  private registry: RuleRegistry;
  private scorer: Scorer;
  private abConfig: ABTestConfig | null = null;
  private rulesDirectory: string | null = null;

  constructor(
    registry?: RuleRegistry,
    flagThreshold?: number,
    blockThreshold?: number,
  ) {
    this.registry = registry ?? new RuleRegistry();
    this.scorer = new Scorer(this.registry, flagThreshold, blockThreshold);
    this.registerBuiltins();
    this.attachSighupReload();
  }

  // ── Built-in rule registration ─────────────────────────────────────────────

  private registerBuiltins(): void {
    [
      new VelocityRule(),
      new GeoAnomalyRule(),
      new DeviceFingerprintRule(),
      new AmountThresholdRule(),
      new NewAccountRule(),
      new VpnProxyRule(),
      new ChargebackRule(),
      new UsageAnomalyRule(),
    ].forEach((rule) => this.registry.register(rule));
  }

  // ── SIGHUP hot-reload ──────────────────────────────────────────────────────

  setRulesDirectory(dirPath: string): void {
    this.rulesDirectory = dirPath;
  }

  private attachSighupReload(): void {
    if (typeof process === 'undefined') return;
    process.on('SIGHUP', () => {
      if (this.rulesDirectory) {
        console.info('[RuleEngine] SIGHUP received — reloading rules from', this.rulesDirectory);
        void this.registry.loadFromDirectory(this.rulesDirectory);
      }
    });
  }

  // ── A/B testing ────────────────────────────────────────────────────────────

  configureABTest(config: ABTestConfig): void {
    this.abConfig = config;
  }

  /** Determine A/B group deterministically from subscriber ID. */
  private resolveABGroup(subscriberId: string): 'A' | 'B' {
    const sum = subscriberId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return sum % 2 === 0 ? 'A' : 'B';
  }

  // ── Evaluation ─────────────────────────────────────────────────────────────

  evaluate(transaction: FraudTransaction, context: FraudContext): ScorerResult {
    // Apply A/B rule set restrictions if configured
    if (this.abConfig?.enabled) {
      const group = this.resolveABGroup(transaction.subscriberId);
      const abContext: FraudContext = { ...context, abGroup: group };
      const exclusions = group === 'A' ? this.abConfig.rulesB : this.abConfig.rulesA;

      // Temporarily disable the other group's rules
      for (const name of exclusions) {
        this.registry.disable(name);
      }

      const result = this.scorer.score(transaction, abContext);

      // Re-enable them
      for (const name of exclusions) {
        this.registry.enable(name);
      }

      return result;
    }

    return this.scorer.score(transaction, context);
  }

  // ── Rule management delegation ─────────────────────────────────────────────

  enableRule(name: string): boolean {
    return this.registry.enable(name);
  }

  disableRule(name: string): boolean {
    return this.registry.disable(name);
  }

  listRules() {
    return this.registry.getAll().map((r) => ({
      name: r.name,
      category: r.category,
      weight: r.weight,
      enabled: r.enabled,
    }));
  }

  getStats() {
    return this.registry.getStats();
  }

  getRegistry(): RuleRegistry {
    return this.registry;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const defaultEngine = new RuleEngine();
