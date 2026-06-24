/**
 * Scorer
 *
 * Computes a weighted total fraud score from individual rule results and maps
 * it to a FraudAction.  The threshold is configurable per merchant.
 */

import { FraudRule, FraudTransaction, FraudContext, RuleResult } from './rules/FraudRule';
import { RuleRegistry } from './RuleRegistry';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FraudAction = 'approve' | 'flag' | 'block';

export interface ScoredRule {
  ruleName: string;
  category: string;
  rawScore: number;
  weightedScore: number;
  reasons: string[];
  triggered: boolean;
}

export interface ScorerResult {
  totalScore: number;
  action: FraudAction;
  reason: string;
  scoredRules: ScoredRule[];
  /** Wall-clock time in ms taken to evaluate all rules. */
  evaluationMs: number;
}

// ── Default thresholds ────────────────────────────────────────────────────────

const DEFAULT_FLAG_THRESHOLD = 50;
const DEFAULT_BLOCK_THRESHOLD = 80;

// ── Scorer ────────────────────────────────────────────────────────────────────

export class Scorer {
  private registry: RuleRegistry;
  private flagThreshold: number;
  private blockThreshold: number;

  constructor(
    registry: RuleRegistry,
    flagThreshold = DEFAULT_FLAG_THRESHOLD,
    blockThreshold = DEFAULT_BLOCK_THRESHOLD,
  ) {
    this.registry = registry;
    this.flagThreshold = flagThreshold;
    this.blockThreshold = blockThreshold;
  }

  /**
   * Run all enabled rules against a transaction and produce an aggregate score.
   * Rules that throw exceptions are skipped with a warning — they never abort
   * the evaluation.
   */
  score(transaction: FraudTransaction, context: FraudContext): ScorerResult {
    const start = Date.now();
    const enabledRules = this.registry.getEnabled();

    // Pass-through mode: no rules enabled
    if (enabledRules.length === 0) {
      console.warn(
        `[Scorer] No rules enabled for transaction ${transaction.id} — pass-through (approve)`,
      );
      return {
        totalScore: 0,
        action: 'approve',
        reason: 'Pass-through: no rules enabled',
        scoredRules: [],
        evaluationMs: Date.now() - start,
      };
    }

    const scoredRules: ScoredRule[] = [];
    let weightedSum = 0;
    let totalWeight = 0;

    for (const rule of enabledRules) {
      this.registry.recordEvaluation(rule.name);
      let result: RuleResult;

      try {
        result = rule.evaluate(transaction, context);
      } catch (err) {
        console.warn(`[Scorer] Rule "${rule.name}" threw an exception — skipping:`, err);
        continue;
      }

      const weightedScore = result.score * rule.weight;
      weightedSum += weightedScore;
      totalWeight += rule.weight;

      if (result.triggered) {
        this.registry.recordHit(rule.name, result.score);
      }

      scoredRules.push({
        ruleName: rule.name,
        category: rule.category,
        rawScore: result.score,
        weightedScore,
        reasons: result.reasons,
        triggered: result.triggered,
      });
    }

    // Normalise to 0–100 scale
    const falsePositivePenalty = Math.min((transaction.falsePositiveCount ?? 0) * 40, 60);
    const rawTotal = totalWeight > 0 ? (weightedSum / totalWeight) * 1.5 : 0;
    const totalScore = Math.max(0, Math.min(100, Math.round(rawTotal - falsePositivePenalty)));

    const action = this.determineAction(totalScore);
    const reason = this.buildReason(scoredRules);

    return {
      totalScore,
      action,
      reason,
      scoredRules,
      evaluationMs: Date.now() - start,
    };
  }

  private determineAction(score: number): FraudAction {
    if (score >= this.blockThreshold) return 'block';
    if (score >= this.flagThreshold) return 'flag';
    return 'approve';
  }

  private buildReason(rules: ScoredRule[]): string {
    const triggered = rules.filter((r) => r.triggered).sort((a, b) => b.weightedScore - a.weightedScore);
    if (triggered.length === 0) return 'No fraud signals detected';
    return triggered[0].reasons[0] ?? triggered[0].ruleName;
  }
}
