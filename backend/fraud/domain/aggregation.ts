/**
 * Shared score aggregation used by both the synchronous Scorer and the
 * asynchronous DetectorPipeline, so the two can never drift apart.
 */

export type FraudAction = 'approve' | 'flag' | 'block';

export interface WeightedResult {
  rawScore: number;
  weight: number;
}

export interface Thresholds {
  flag: number;
  block: number;
}

export const DEFAULT_FLAG_THRESHOLD = 50;
export const DEFAULT_BLOCK_THRESHOLD = 80;

/** Weighted average scaled by 1.5, minus the false-positive penalty, clamped to 0–100. */
export function aggregateScore(results: WeightedResult[], falsePositiveCount = 0): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const r of results) {
    weightedSum += r.rawScore * r.weight;
    totalWeight += r.weight;
  }
  const penalty = Math.min(falsePositiveCount * 40, 60);
  const rawTotal = totalWeight > 0 ? (weightedSum / totalWeight) * 1.5 : 0;
  return Math.max(0, Math.min(100, Math.round(rawTotal - penalty)));
}

export function determineAction(score: number, t: Thresholds): FraudAction {
  if (score >= t.block) return 'block';
  if (score >= t.flag) return 'flag';
  return 'approve';
}
