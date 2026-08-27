/**
 * FraudRule interface — the contract every pluggable rule must implement.
 *
 * Rules are independent modules; each returns a score 0–100 and a list of
 * human-readable reasons.  The RuleEngine aggregates scores via weighted sum.
 */

// ── Supporting types ──────────────────────────────────────────────────────────

/** Matches the existing FraudSignalType in src/types/fraud.ts */
export type FraudRuleCategory =
  | 'velocity'
  | 'usage-anomaly'
  | 'chargeback'
  | 'pattern-shift'
  | 'device-mismatch'
  | 'geolocation-anomaly'
  | 'amount-threshold'
  | 'new-account'
  | 'vpn-proxy';

/** The transaction/subscription record passed to each rule for evaluation. */
export interface FraudTransaction {
  id: string;
  subscriberId: string;
  merchantId: string;
  amount: number;
  currency: string;
  createdAt: string;
  homeCountry?: string;
  currentCountry?: string;
  deviceFingerprint?: string;
  trustedDeviceFingerprint?: string;
  chargebacks: number;
  expectedUsage: number;
  observedUsage: number;
  lastSeenAt?: string;
  falsePositiveCount?: number;
}

/** Context passed alongside the transaction — peer data for velocity checks etc. */
export interface FraudContext {
  /** All transactions for the same subscriber (for velocity comparisons). */
  subscriberHistory: FraudTransaction[];
  /** Configurable threshold for this merchant. */
  merchantThreshold: number;
  /** Whether VPN/proxy IP detection is available. */
  vpnDetected?: boolean;
  /** Account age in days. */
  accountAgeDays?: number;
  /** A/B test group — 'A' or 'B'. */
  abGroup?: 'A' | 'B';
}

/** Result returned by a single rule. */
export interface RuleResult {
  /** Score contribution 0–100. */
  score: number;
  /** Human-readable explanations for the score. */
  reasons: string[];
  /** Whether this rule fired at all. */
  triggered: boolean;
}

// ── Rule interface ────────────────────────────────────────────────────────────

export interface FraudRule {
  /** Unique rule identifier (used in registry and statistics). */
  readonly name: string;
  /** Relative weight when computing the weighted total. */
  readonly weight: number;
  /** Category used for grouping / analytics. */
  readonly category: FraudRuleCategory;
  /** Whether the rule is currently enabled. */
  enabled: boolean;

  /**
   * Evaluate the transaction and return a scored result.
   * Must never throw — errors are caught by the engine and logged.
   */
  evaluate(transaction: FraudTransaction, context: FraudContext): RuleResult;
}
