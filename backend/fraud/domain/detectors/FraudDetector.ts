/**
 * FraudDetector: the plug-in contract for the fraud pipeline.
 *
 * Unlike the synchronous FraudRule, a detector may be asynchronous (for
 * example a call to an IP-reputation service or the ML service) and the
 * pipeline enforces a per-detector timeout and isolates failures.
 */

import { FraudContext, FraudRuleCategory, FraudTransaction, RuleResult } from '../rules/FraudRule';

export type DetectorResult = RuleResult;

export interface FraudDetector {
  /** Unique id used for registration, metrics and logs. */
  readonly id: string;
  readonly category: FraudRuleCategory;
  /** Relative weight in the aggregate score. Must be > 0. */
  readonly weight: number;
  /** Optional override of the pipeline's default timeout, in ms. */
  readonly timeoutMs?: number;
  enabled: boolean;

  detect(
    transaction: FraudTransaction,
    context: FraudContext,
  ): DetectorResult | Promise<DetectorResult>;
}

export type DetectorOutcome = 'ok' | 'error' | 'timeout' | 'invalid';

/** Observability hook: one call per detector run. Wire to logs/metrics. */
export interface DetectorObserver {
  onDetectorRun(event: {
    detectorId: string;
    transactionId: string;
    outcome: DetectorOutcome;
    durationMs: number;
    score?: number;
    error?: unknown;
  }): void;
}
